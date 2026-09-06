// ============================================================
// billing_sync.gs — Reconciliação de assinatura (v156)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// O CASO QUE ORIGINOU ESTE ARQUIVO
//
// A tela /app/billing mostrava "Trimestral R$ 47,00 — Ativa",
// e o Perfil da mesma pessoa mostrava "Bloqueada". Os dois
// estavam lendo fontes diferentes:
//
//   getBillingDetalhe  -> consulta a Stripe AO VIVO, por e-mail
//   resto do app       -> le a aba `assinaturas`
//
// A assinatura nova (paga em 01/09) nunca chegou na planilha
// porque o webhook do Stripe nao esta entregando. A linha
// continuou com o estado antigo, bloqueado, e o app seguiu a
// linha: audio, meditacao e tudo mais travados para quem pagou.
//
// getStripePortal falhava pelo mesmo motivo: ele le o SUB_ID da
// planilha, que ainda era o id antigo da Cakto — dai o
// "Nenhuma assinatura Stripe ativa encontrada" mesmo com a
// assinatura existindo na Stripe.
//
// Esta rota resolve o problema pela raiz do ponto de vista do
// usuario: pergunta ao PROVEDOR qual e a verdade e reescreve a
// planilha com ela. Nao e um "liberar acesso": se o provedor
// disser que nao esta paga, ela bloqueia igual.
// ============================================================

function _bsNorm_(e) { return String(e || '').toLowerCase().trim(); }

// Todos os e-mails pelos quais esta pessoa pode estar registrada
// no provedor. Quem troca de e-mail no app continua com o antigo
// no Stripe/Cakto — procurar so pelo atual perderia a assinatura.
function _bsEmailsPossiveis_(emailAtual) {
  var lista = [_bsNorm_(emailAtual)];
  try {
    var aba = getSpreadsheet_().getSheetByName(EC_ABA_ALIAS);
    if (aba && aba.getLastRow() > 1) {
      var d = aba.getDataRange().getValues();
      var iA = d[0].indexOf('email_antigo'), iN = d[0].indexOf('email_atual');
      if (iA >= 0 && iN >= 0) {
        for (var i = 1; i < d.length; i++) {
          var antigo = _bsNorm_(d[i][iA]), atual = _bsNorm_(d[i][iN]);
          if (atual === lista[0] && antigo && lista.indexOf(antigo) < 0) lista.push(antigo);
        }
      }
    }
  } catch (e) {}
  return lista;
}

// Procura na Stripe por qualquer um dos e-mails, devolvendo a
// assinatura mais "viva" que encontrar.
function _bsAcharStripe_(emails) {
  if (!stripeConfigurado_()) return null;
  var ordem = ['active', 'trialing', 'past_due', 'unpaid', 'paused'];

  for (var i = 0; i < emails.length; i++) {
    try {
      var cli = _stripeCall_('get', '/v1/customers?email=' + encodeURIComponent(emails[i]) + '&limit=5');
      if (!cli || cli._error || !cli.data || !cli.data.length) continue;

      for (var c = 0; c < cli.data.length; c++) {
        var subs = _stripeCall_('get', '/v1/subscriptions?customer=' +
          encodeURIComponent(cli.data[c].id) +
          '&status=all&limit=10&expand[]=data.items.data.price&expand[]=data.default_payment_method');
        if (!subs || subs._error || !subs.data || !subs.data.length) continue;

        var viva = subs.data.filter(function (s) { return ordem.indexOf(s.status) >= 0; })
                            .sort(function (a, b) {
                              return ordem.indexOf(a.status) - ordem.indexOf(b.status);
                            })[0];
        if (viva) return { sub: viva, customer: cli.data[c], emailUsado: emails[i] };
      }
    } catch (e) {}
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// ROTA (auth): billingSincronizar
// O botao "Sincronizar" da tela de assinatura.
// ─────────────────────────────────────────────────────────────
function billingSincronizar(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  var email = _bsNorm_(user.email);
  try { if (typeof _resolverEmailAtual_ === 'function') email = _resolverEmailAtual_(email); } catch (e) {}

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) {
    return { ok: false, error: 'Já existe uma sincronização em andamento. Tente em alguns segundos.' };
  }

  try {
    var emails = _bsEmailsPossiveis_(email);
    var linha  = null;
    try { linha = _getAssinaturaRow_(email); } catch (e) {}

    var antes = {
      status:  linha ? String(linha[_ASS_.APP_STATUS] || '') : '',
      subId:   linha ? String(linha[_ASS_.SUB_ID] || '') : '',
      acesso:  _bsTemAcesso_(email)
    };

    var passos = [];
    passos.push('Consultei ' + emails.length +
                (emails.length === 1 ? ' e-mail seu' : ' e-mails seus') + ' no provedor.');

    // ── 1) Stripe manda, quando existe ────────────────────────
    var achado = _bsAcharStripe_(emails);
    if (achado) {
      var s = achado.sub;
      passos.push('Encontrei sua assinatura na Stripe (' + _blLabelStatus_(s.status) + ').');
      if (achado.emailUsado !== email) {
        passos.push('Ela estava no e-mail antigo (' + _bsMascara_(achado.emailUsado) + '). Religado ao seu e-mail atual.');
      }

      // Reescreve assinaturas + compradores + acesso com a verdade da Stripe
      _stripeSyncAssinatura_(email, s, false);

      var novoStatus = _stripeMapStatus_(s.status);
      var liberou = [AS.TRIAL, AS.ACTIVE, AS.GRACE, AS.GRACE_FINAL].indexOf(novoStatus) >= 0;

      logAction(email, 'BILLING_SYNC', 'assinatura', s.id,
                antes.status + ' -> ' + novoStatus + ' | ' + achado.emailUsado);

      return _bsResposta_(email, antes, novoStatus, liberou, passos, 'stripe', s.status);
    }

    passos.push('Não encontrei assinatura ativa na Stripe.');

    // ── 2) Cakto, para quem ainda não migrou ──────────────────
    if (typeof getAssinaturaDetalhe === 'function') {
      var det = null;
      try { det = getAssinaturaDetalhe(token); } catch (e) {}
      var d = (det && det.data) || null;
      if (d && d.status) {
        passos.push('Encontrei sua assinatura na Cakto (' + _blLabelStatus_(d.status) + ').');
        var mapa = { active: AS.ACTIVE, trial: AS.TRIAL, paused: AS.PAUSED,
                     canceled: AS.CANCELLED, cancelled: AS.CANCELLED };
        var st = mapa[String(d.status)] || String(d.status);
        var lib = [AS.TRIAL, AS.ACTIVE, AS.GRACE, AS.GRACE_FINAL].indexOf(st) >= 0;

        _upsertAssinatura_(email, { cakto_status: d.status, app_status: st, provider: 'cakto' });
        _syncAcesso_(email, st);

        logAction(email, 'BILLING_SYNC', 'assinatura', '', antes.status + ' -> ' + st + ' | cakto');
        return _bsResposta_(email, antes, st, lib, passos, 'cakto', d.status);
      }
    }

    // ── 3) Nada em lugar nenhum ───────────────────────────────
    // Aqui NAO liberamos nada. Sincronizar e conferir a verdade,
    // nao dar acesso a quem o provedor nao confirma.
    passos.push('Também não encontrei assinatura na Cakto.');
    logAction(email, 'BILLING_SYNC_VAZIO', 'assinatura', '', antes.status);

    return {
      ok: true,
      mudou: false,
      liberado: antes.acesso,
      titulo: 'Não encontrei assinatura ativa',
      mensagem: 'Conferimos no provedor de pagamento e não localizamos uma assinatura ' +
                'no seu e-mail. Se você pagou com o e-mail de outra pessoa, fale com a ' +
                'gente no WhatsApp que a gente religa manualmente.',
      passos: passos,
      provedor: 'nenhum'
    };

  } catch (e) {
    logAction(_bsNorm_(user.email), 'BILLING_SYNC_ERRO', 'assinatura', '', e.message);
    return { ok: false, error: 'Não consegui sincronizar agora. Tente de novo em instantes.' };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function _bsResposta_(email, antes, novoStatus, liberou, passos, provedor, statusBruto) {
  var mudouStatus = antes.status !== novoStatus;
  var destravou   = liberou && !antes.acesso;

  var titulo, mensagem;
  if (destravou) {
    titulo = 'Pronto, seu acesso foi liberado';
    mensagem = 'O erro era nosso: seu pagamento estava confirmado no provedor, mas não ' +
               'tinha chegado no app. Já corrigimos — pode usar tudo normalmente.';
    passos.push('Acesso liberado.');
  } else if (liberou) {
    titulo = 'Tudo certo por aqui';
    mensagem = 'Sua assinatura está em dia e seu acesso está liberado.';
    passos.push('Nada estava travado.');
  } else {
    titulo = 'Sua assinatura está com pendência';
    mensagem = 'O provedor informa que a assinatura está como "' +
               _blLabelStatus_(statusBruto) + '". Enquanto isso não for regularizado, ' +
               'o acesso continua limitado.';
    passos.push('Acesso segue limitado — o provedor não confirma pagamento em dia.');
  }

  return {
    ok: true,
    mudou: mudouStatus || destravou,
    liberado: liberou,
    statusAntes: antes.status,
    statusAgora: novoStatus,
    titulo: titulo,
    mensagem: mensagem,
    passos: passos,
    provedor: provedor
  };
}

function _bsTemAcesso_(email) {
  try {
    var sh = getSpreadsheet_().getSheetByName(SHEET_COMPRADORES);
    if (!sh || sh.getLastRow() < 2) return false;
    var d = sh.getDataRange().getValues();
    var iE = d[0].indexOf('Email'), iA = d[0].indexOf('Ativo');
    if (iE < 0 || iA < 0) return false;
    for (var i = 1; i < d.length; i++) {
      if (_bsNorm_(d[i][iE]) === _bsNorm_(email)) return d[i][iA] === true;
    }
  } catch (e) {}
  return false;
}

function _bsMascara_(email) {
  var p = String(email || '').split('@');
  if (p.length !== 2) return '***';
  var u = p[0];
  return (u.length <= 2 ? u[0] + '*' : u.slice(0, 2) + '***') + '@' + p[1];
}

// ─────────────────────────────────────────────────────────────
// ADMIN — sincroniza um aluno pelo e-mail, sem precisar da
// sessão dele. Para o suporte resolver na hora.
// ─────────────────────────────────────────────────────────────
function adminSincronizarAssinatura(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  var email = _bsNorm_((data || {}).email);
  if (!email) return { ok: false, error: 'Informe o e-mail do aluno.' };
  try { if (typeof _resolverEmailAtual_ === 'function') email = _resolverEmailAtual_(email); } catch (e) {}

  var emails = _bsEmailsPossiveis_(email);
  var antes  = { status: '', acesso: _bsTemAcesso_(email) };
  try {
    var l = _getAssinaturaRow_(email);
    if (l) antes.status = String(l[_ASS_.APP_STATUS] || '');
  } catch (e) {}

  var achado = _bsAcharStripe_(emails);
  if (!achado) {
    return { ok: true, encontrado: false, email: email, emailsTestados: emails,
             statusAntes: antes.status, acessoAntes: antes.acesso,
             mensagem: 'Nenhuma assinatura Stripe encontrada para estes e-mails.' };
  }

  _stripeSyncAssinatura_(email, achado.sub, false);
  var novo = _stripeMapStatus_(achado.sub.status);
  logAction(user.email, 'ADMIN_BILLING_SYNC', 'assinatura', email,
            antes.status + ' -> ' + novo);

  return {
    ok: true, encontrado: true, email: email,
    emailUsadoNoStripe: achado.emailUsado,
    subId: achado.sub.id,
    statusStripe: achado.sub.status,
    statusAntes: antes.status,
    statusAgora: novo,
    acessoAntes: antes.acesso,
    acessoAgora: _bsTemAcesso_(email)
  };
}


// ─────────────────────────────────────────────────────────────
// DETECÇÃO DE DIVERGÊNCIA — usada pelo app inteiro
// ------------------------------------------------------------
// Só consulta o provedor para quem está sendo BLOQUEADO. Rodar
// isso no boot de todo mundo custaria uma chamada à Stripe por
// carregamento de app, para uma pergunta que só interessa a
// quem está travado.
// ─────────────────────────────────────────────────────────────
function bsDivergencia_(email, statusApp) {
  var fora = { divergente: false, statusProvedor: '', subId: '' };
  var travado = [AS.BLOCKED, AS.CANCELLED, AS.PAUSED].indexOf(String(statusApp)) >= 0;
  if (!travado) return fora;

  try {
    var achado = _bsAcharStripe_(_bsEmailsPossiveis_(email));
    if (!achado) return fora;
    var st = _stripeMapStatus_(achado.sub.status);
    if ([AS.TRIAL, AS.ACTIVE, AS.GRACE, AS.GRACE_FINAL].indexOf(st) < 0) return fora;
    return { divergente: true, statusProvedor: achado.sub.status, subId: achado.sub.id };
  } catch (e) { return fora; }
}
