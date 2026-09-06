// ============================================================
// trial_provisao.gs — Provisionamento do trial com cartão (v154)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// AUDITORIA — onde os dois fluxos divergiam
//
// O trial SEM cartão (registrarTrial_) provisiona TUDO de forma
// síncrona, dentro da própria requisição: users, compradores,
// assinaturas, trial_leads e o e-mail. Quando a rota responde,
// o aluno já existe.
//
// O trial COM cartão não provisiona nada na requisição. Ele só
// grava consentimento + lead e manda a pessoa pro Stripe. Todo o
// resto — assinaturas, compradores, users, e-mail e WhatsApp —
// depende EXCLUSIVAMENTE do webhook `checkout.session.completed`.
//
// No teste real de 05/09 o webhook não rodou: a sessão existe no
// Stripe (status complete) mas `users` não tem o aluno, logo
// nenhum e-mail e nenhum WhatsApp saíram. Um único ponto de
// falha derrubou seis etapas.
//
// A CORREÇÃO aqui não cria uma segunda arquitetura: reaproveita
// _stripeSyncAssinatura_, que já sabe escrever nas três abas e
// criar o login. O que faltava era um caminho de reconciliação
// para quando o webhook não chega.
//
// Isso NÃO é confiar no navegador: o navegador só entrega um
// session_id. Quem decide é o servidor, que re-busca a sessão na
// API do Stripe — exatamente o mesmo modelo de confiança que o
// webhook usa (re-fetch do evento por ID).
// ============================================================

var TP_LOCK_SEG = 30;

function _tpNorm_(e) { return String(e || '').toLowerCase().trim(); }

function _tpLog_(email, etapa, detalhe) {
  try { logAction(email || 'system', etapa, 'trial_cartao', '', String(detalhe || '')); } catch (e) {}
}

function _tpDataBR_(unix) {
  if (!unix) return '';
  try {
    return Utilities.formatDate(new Date(unix * 1000), 'America/Sao_Paulo', 'dd/MM/yyyy');
  } catch (e) { return ''; }
}

// Dias de trial DA ASSINATURA, não do que o navegador mandou.
// Preferimos a metadata (gravada na criação) e caímos na conta
// entre início e fim do trial quando ela não existir.
function _tpDiasDoTrial_(sub) {
  if (!sub) return 0;
  var meta = sub.metadata || {};
  var d = parseInt(meta.trial_dias, 10);
  if (d > 0) return d;
  if (sub.trial_start && sub.trial_end) {
    return Math.round((sub.trial_end - sub.trial_start) / 86400);
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────
// NÚCLEO — provisiona uma assinatura Stripe. Idempotente.
//
// O marcador de "já provisionado" vive na metadata da própria
// assinatura no Stripe. CacheService morre em 6h e o retry do
// Stripe pode chegar depois disso; a metadata não morre.
// ─────────────────────────────────────────────────────────────
function _provisionarSub_(email, sub, origem) {
  email = _tpNorm_(email);
  if (!email || !sub || !sub.id) return { ok: false, error: 'sem e-mail ou assinatura' };

  var ehTrial = String(sub.status) === 'trialing';
  var lock = LockService.getScriptLock();
  try { lock.waitLock(TP_LOCK_SEG * 1000); } catch (e) {
    return { ok: false, error: 'ocupado', reentrante: true };
  }

  try {
    // Já provisionado? Sai sem repetir e-mail nem WhatsApp.
    if (String((sub.metadata || {}).provisionado || '') === '1') {
      return { ok: true, jaFeito: true, tipo: ehTrial ? 'trial' : 'compra' };
    }

    _tpLog_(email, 'PROV_INICIO', origem + ' | ' + sub.id + ' | ' + sub.status);

    // 1) assinaturas + compradores + users + e-mail de acesso.
    // Toda essa cadeia já existe e é a MESMA que o webhook usa.
    _stripeSyncAssinatura_(email, sub, true);
    _tpLog_(email, 'SHEETS_SUBSCRIPTION_OK', sub.id);

    // 2) trial_leads: fecha o lead como convertido
    try {
      _tpMarcarLeadConvertido_(email, _tpDiasDoTrial_(sub));
      _tpLog_(email, 'SHEETS_TRIAL_LEAD_OK', '');
    } catch (e) { _tpLog_(email, 'SHEETS_TRIAL_LEAD_ERRO', e.message); }

    // 3) automações do trial (e-mail de boas-vindas do trial,
    //    WhatsApp, Telegram e CAPI). Só para assinatura em teste.
    if (ehTrial) {
      try {
        var auto = dispararAutomacoesTrial_(email, sub);
        _tpLog_(email, 'TRIAL_AUTOMACOES_OK', JSON.stringify(auto && auto.resultado || {}).slice(0, 240));
      } catch (e) { _tpLog_(email, 'TRIAL_AUTOMACOES_ERRO', e.message); }
    }

    // 4) carimba no Stripe que já passou por aqui
    try {
      _stripeCall_('post', '/v1/subscriptions/' + encodeURIComponent(sub.id),
                   { 'metadata[provisionado]': '1',
                     'metadata[provisionado_em]': new Date().toISOString() });
    } catch (e) { _tpLog_(email, 'PROV_MARCA_ERRO', e.message); }

    _tpLog_(email, 'PROVISIONING_COMPLETE', sub.id);
    return { ok: true, tipo: ehTrial ? 'trial' : 'compra' };

  } catch (e) {
    _tpLog_(email, 'PROV_ERRO', e.message);
    return { ok: false, error: e.message };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// trial_leads: marca o lead como convertido e corrige a oferta
function _tpMarcarLeadConvertido_(email, dias) {
  var sh = getSpreadsheet_().getSheetByName(SHEET_TRIAL_LEADS);
  if (!sh || sh.getLastRow() < 2) return;
  var d = sh.getDataRange().getValues();
  var agora = new Date().toISOString();

  for (var i = d.length - 1; i >= 1; i--) {
    if (_tpNorm_(d[i][2]) !== _tpNorm_(email)) continue;
    if (dias > 0) sh.getRange(i + 1, 5).setValue(dias);   // OfertaDias
    sh.getRange(i + 1, 6).setValue('cartao_confirmado');  // Estagio
    sh.getRange(i + 1, 8).setValue('convertido');         // Status
    sh.getRange(i + 1, 9).setValue('sim');                // Convertido
    sh.getRange(i + 1, 10).setValue(agora);
    return;
  }
}

// ─────────────────────────────────────────────────────────────
// ROTA PÚBLICA: statusTrialCartao
// A página /obrigado chama com o session_id. Devolve o estado do
// provisionamento e os dados REAIS do trial, e provisiona caso o
// webhook ainda não tenha chegado.
//
// Estados: validando | provisionando | pronto | erro
// ─────────────────────────────────────────────────────────────
function statusTrialCartao(data) {
  var sessionId = String((data || {}).sessionId || '').trim();
  if (sessionId.indexOf('cs_') !== 0) {
    return { ok: false, estado: 'erro', error: 'Sessão inválida.' };
  }
  if (!stripeConfigurado_()) {
    return { ok: false, estado: 'erro', error: 'Pagamento indisponível no momento.' };
  }

  // Fonte da verdade: a API do Stripe, não a URL do navegador
  var s = _stripeCall_('get', '/v1/checkout/sessions/' + encodeURIComponent(sessionId));
  if (!s || s._error) return { ok: false, estado: 'erro', error: 'Não encontramos essa compra.' };

  var email = _tpNorm_((s.customer_details && s.customer_details.email) || s.customer_email || '');
  var nome  = String((s.customer_details && s.customer_details.name) || '');

  // Sessão ainda aberta = pessoa não terminou (boleto pendente cai aqui)
  if (String(s.status || '') !== 'complete') {
    return { ok: true, estado: 'validando', tipo: 'indefinido', email: email, nome: nome,
             mensagem: 'Ainda não recebemos a confirmação do seu cadastro.' };
  }

  if (!s.subscription) {
    return { ok: true, estado: 'erro', email: email, nome: nome,
             error: 'Esta sessão não gerou assinatura.' };
  }

  var sub = _stripeCall_('get', '/v1/subscriptions/' +
              encodeURIComponent(s.subscription) + '?expand[]=items.data.price');
  if (!sub || sub._error) {
    return { ok: true, estado: 'erro', email: email, nome: nome,
             error: 'Não consegui ler sua assinatura.' };
  }

  var ehTrial = String(sub.status) === 'trialing';
  var item    = (sub.items && sub.items.data && sub.items.data[0]) || {};
  var price   = item.price || {};
  var valor   = price.unit_amount != null ? (price.unit_amount / 100) : 17;

  // Assinatura que não está nem em teste nem ativa não libera acesso
  if (['trialing', 'active'].indexOf(String(sub.status)) < 0) {
    return { ok: true, estado: 'validando', tipo: ehTrial ? 'trial' : 'compra',
             email: email, nome: nome, statusStripe: sub.status,
             mensagem: 'Seu pagamento ainda está sendo confirmado.' };
  }

  // Provisiona se ainda não passou por aqui (webhook atrasado ou perdido)
  var jaTemLogin = _tpTemLogin_(email);
  if (!jaTemLogin || String((sub.metadata || {}).provisionado || '') !== '1') {
    var p = _provisionarSub_(email, sub, 'pagina_obrigado');
    if (p && p.reentrante) {
      return { ok: true, estado: 'provisionando', tipo: ehTrial ? 'trial' : 'compra',
               email: email, nome: nome };
    }
    jaTemLogin = _tpTemLogin_(email);
  }

  var dias = _tpDiasDoTrial_(sub);

  return {
    ok: true,
    estado: jaTemLogin ? 'pronto' : 'provisionando',
    tipo:   ehTrial ? 'trial' : 'compra',
    email:  email,
    nome:   nome || String((sub.metadata || {}).nome || ''),
    trial: {
      dias:            dias,
      inicio:          _tpDataBR_(sub.trial_start || sub.start_date),
      fim:             _tpDataBR_(sub.trial_end),
      primeiraCobranca: _tpDataBR_(sub.trial_end || sub.current_period_end),
      valor:           valor,
      cobradoHoje:     0
    },
    precisaCriarSenha: email ? _temTokenAcessoPendente_(email) : false,
    appUrl: 'https://app.wpktavares.com.br'
  };
}

function _tpTemLogin_(email) {
  email = _tpNorm_(email);
  if (!email) return false;
  try {
    var users = sheetToObjects(getSheet(SHEET_USERS));
    return !!users.find(function (u) { return _tpNorm_(u.email) === email; });
  } catch (e) { return false; }
}

// ─────────────────────────────────────────────────────────────
// DIAGNÓSTICO (admin) — responde a pergunta que importa:
// "o webhook chegou?" e "o que foi provisionado?"
// ─────────────────────────────────────────────────────────────
function diagTrialCartao(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  var email = _tpNorm_((data || {}).email);
  var out = { email: email, abas: {}, logs: [], webhookRecente: false };

  var checar = [
    ['users',          SHEET_USERS,        'email'],
    ['compradores',    SHEET_COMPRADORES,  'Email'],
    ['trial_leads',    SHEET_TRIAL_LEADS,  'Email']
  ];
  checar.forEach(function (c) {
    try {
      var sh = getSpreadsheet_().getSheetByName(c[1]);
      if (!sh || sh.getLastRow() < 2) { out.abas[c[0]] = false; return; }
      var d = sh.getDataRange().getValues();
      var idx = d[0].map(function (h) { return String(h); }).indexOf(c[2]);
      var achou = false;
      for (var i = 1; i < d.length && !achou; i++) {
        if (_tpNorm_(d[i][idx]) === email) achou = true;
      }
      out.abas[c[0]] = achou;
    } catch (e) { out.abas[c[0]] = 'erro: ' + e.message; }
  });

  try { out.abas.assinaturas = !!_getAssinaturaRow_(email); } catch (e) { out.abas.assinaturas = false; }

  // Últimos registros do log que tocam este e-mail ou o Stripe
  try {
    var lg = getSpreadsheet_().getSheetByName(SHEET_LOG);
    if (lg && lg.getLastRow() > 1) {
      var L = lg.getDataRange().getValues();
      for (var j = L.length - 1; j >= 1 && out.logs.length < 25; j--) {
        var acao = String(L[j][2] || '');
        var alvo = _tpNorm_(L[j][1]) + ' ' + _tpNorm_(L[j][4]) + ' ' + _tpNorm_(L[j][5]);
        if (acao.indexOf('STRIPE') === 0 || acao.indexOf('PROV') === 0 ||
            acao.indexOf('TRIAL') === 0 || acao.indexOf('WA_') === 0 ||
            (email && alvo.indexOf(email) >= 0)) {
          out.logs.push({ quando: String(L[j][6] || ''), acao: acao,
                          quem: String(L[j][1] || ''), detalhe: String(L[j][5] || '').slice(0, 160) });
          if (acao.indexOf('STRIPE_SYNC') === 0 || acao === 'STRIPE_EVENT_ERRO') out.webhookRecente = true;
        }
      }
    }
  } catch (e) {}

  return { ok: true, data: out };
}
