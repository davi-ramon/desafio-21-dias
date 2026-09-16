// ============================================================
// email_change.gs — Trocar o e-mail de uma conta (v147)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// O e-mail é chave estrangeira em ~26 pontos do sistema: users,
// compradores, assinaturas, dream_board, flashcards, exercicio,
// preferencias... Trocar só na aba `users` faz a pessoa logar e
// cair em "comprador não encontrado", perdendo o progresso.
// Por isso a troca varre TODAS as abas.
//
// E há um detalhe que só aparece depois: a Cakto e o Stripe
// continuam mandando webhook com o e-mail ANTIGO, porque a conta
// lá não muda. Sem tradução, a renovação dela deixaria de casar e
// o acesso cairia no vencimento. Daí a tabela de apelidos.
// ============================================================

var EC_ABA_ALIAS = 'email_aliases';

function _ecNorm_(e) { return String(e || '').toLowerCase().trim(); }

function _ecAbaAlias_() {
  var ss = getSpreadsheet_();
  var aba = ss.getSheetByName(EC_ABA_ALIAS);
  if (!aba) {
    aba = ss.insertSheet(EC_ABA_ALIAS);
    var cab = ['email_antigo', 'email_atual', 'trocado_em', 'trocado_por', 'motivo'];
    aba.appendRow(cab);
    aba.getRange(1, 1, 1, cab.length)
       .setFontWeight('bold').setBackground('#6c47ff').setFontColor('#ffffff');
    aba.setFrozenRows(1);
  }
  return aba;
}

// Traduz um e-mail antigo para o atual. Usado pelos webhooks:
// a Cakto/Stripe seguem mandando o e-mail de origem para sempre.
// Segue a cadeia (a→b→c) com teto, caso a pessoa troque duas vezes.
function _resolverEmailAtual_(email) {
  var atual = _ecNorm_(email);
  if (!atual) return atual;
  try {
    var aba = getSpreadsheet_().getSheetByName(EC_ABA_ALIAS);
    if (!aba || aba.getLastRow() < 2) return atual;
    var d = aba.getDataRange().getValues();
    var iA = d[0].indexOf('email_antigo'), iN = d[0].indexOf('email_atual');
    if (iA < 0 || iN < 0) return atual;

    for (var salto = 0; salto < 5; salto++) {
      var achou = false;
      for (var i = 1; i < d.length; i++) {
        if (_ecNorm_(d[i][iA]) === atual) {
          var proximo = _ecNorm_(d[i][iN]);
          if (proximo && proximo !== atual) { atual = proximo; achou = true; }
          break;
        }
      }
      if (!achou) break;
    }
  } catch (e) {}
  return atual;
}

// ─────────────────────────────────────────────────────────────
// A troca em si: varre todas as abas e substitui o valor exato
// em qualquer coluna cujo cabeçalho seja e-mail.
// ─────────────────────────────────────────────────────────────
function _ecColunaDeEmail_(cabecalho) {
  var h = String(cabecalho || '').toLowerCase().trim();
  return h === 'email' || h === 'e-mail' || h === 'email_aluno' ||
         h === 'customer_email' || h === 'user_email' || h === 'destinatario';
}

function _ecTrocarEmTudo_(antigo, novo) {
  antigo = _ecNorm_(antigo);
  novo   = _ecNorm_(novo);
  var ss = getSpreadsheet_();
  var alterados = [];

  ss.getSheets().forEach(function (aba) {
    var nome = aba.getName();
    if (nome === EC_ABA_ALIAS) return;                 // o histórico não se reescreve
    var ultL = aba.getLastRow(), ultC = aba.getLastColumn();
    if (ultL < 2 || ultC < 1) return;

    var cab = aba.getRange(1, 1, 1, ultC).getValues()[0];
    var colunas = [];
    cab.forEach(function (h, i) { if (_ecColunaDeEmail_(h)) colunas.push(i); });
    if (!colunas.length) return;

    var dados = aba.getRange(2, 1, ultL - 1, ultC).getValues();
    var mudou = 0;
    for (var r = 0; r < dados.length; r++) {
      for (var c = 0; c < colunas.length; c++) {
        if (_ecNorm_(dados[r][colunas[c]]) === antigo) {
          aba.getRange(r + 2, colunas[c] + 1).setValue(novo);
          mudou++;
        }
      }
    }
    if (mudou) alterados.push({ aba: nome, celulas: mudou });
  });

  return alterados;
}

// ─────────────────────────────────────────────────────────────
// Núcleo compartilhado pelo admin e pelo autoatendimento
// ─────────────────────────────────────────────────────────────
function _ecExecutarTroca_(antigo, novo, quem, motivo) {
  antigo = _ecNorm_(antigo);
  novo   = _ecNorm_(novo);

  if (!antigo || !novo)  return { ok: false, error: 'Informe os dois e-mails.' };
  if (antigo === novo)   return { ok: false, error: 'Os e-mails sao iguais.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(novo)) return { ok: false, error: 'E-mail novo invalido.' };

  var users = sheetToObjects(getSheet(SHEET_USERS));
  var achou = users.some(function (u) { return _ecNorm_(u.email) === antigo; });
  if (!achou) return { ok: false, error: 'Nao existe conta com o e-mail ' + antigo + '.' };

  // O novo e-mail não pode já pertencer a outra conta: viraria login duplicado
  var ocupado = users.some(function (u) { return _ecNorm_(u.email) === novo; });
  if (ocupado) return { ok: false, error: 'Ja existe uma conta com ' + novo + '. Nao da para unir contas por aqui.' };

  var alterados = _ecTrocarEmTudo_(antigo, novo);

  try {
    _ecAbaAlias_().appendRow([antigo, novo, nowISO(), quem || 'sistema', motivo || '']);
  } catch (e) {}

  // Derruba a sessão: o token some junto, e ela entra de novo pelo e-mail novo
  try {
    var sh = getSheet(SHEET_USERS);
    var d = sh.getDataRange().getValues();
    var iE = d[0].indexOf('email'), iT = d[0].indexOf('token');
    if (iT >= 0) {
      for (var i = 1; i < d.length; i++) {
        if (_ecNorm_(d[i][iE]) === novo) { sh.getRange(i + 1, iT + 1).setValue(''); break; }
      }
    }
  } catch (e) {}

  logAction(quem || 'sistema', 'EMAIL_TROCADO', 'user', antigo,
            'para ' + novo + ' | ' + JSON.stringify(alterados));

  return { ok: true, data: { antigo: antigo, novo: novo, alterados: alterados } };
}

// ═════════════════════════════════════════════════════════════
// ROTA ADMIN — para quem PERDEU o e-mail antigo e nao consegue
// mais receber codigo nele (o caso que motivou isto)
// ═════════════════════════════════════════════════════════════
function adminTrocarEmailAluno(token, data) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  data = data || {};

  var r = _ecExecutarTroca_(data.antigo, data.novo, user.email,
                            String(data.motivo || 'troca solicitada pelo aluno'));
  if (!r.ok) return r;

  // Avisa nos DOIS endereços: o novo confirma, o antigo é a trilha de
  // auditoria caso a troca não tenha sido pedida por ela.
  try {
    _ecAvisarTroca_(r.data.novo, r.data.antigo, true);
    _ecAvisarTroca_(r.data.antigo, r.data.novo, false);
  } catch (e) {}

  return r;
}

// ═════════════════════════════════════════════════════════════
// AUTOATENDIMENTO — aluno logado troca o próprio e-mail.
// Prova de posse: já está logado (conta) + código enviado ao
// endereço NOVO (novo e-mail). Sem código no antigo, de propósito:
// quem chega aqui normalmente perdeu o acesso a ele.
// ═════════════════════════════════════════════════════════════
var EC_OTP_TTL   = 10 * 60;
var EC_OTP_TENT  = 5;

function _ecChave_(email) { return 'ectr_' + _sha256Hex_(_ecNorm_(email)).substring(0, 32); }

function solicitarTrocaEmail(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  var novo = _ecNorm_((data || {}).novoEmail);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(novo)) return { ok: false, error: 'Informe um e-mail valido.' };
  if (novo === _ecNorm_(user.email)) return { ok: false, error: 'Esse ja e o seu e-mail atual.' };

  var users = sheetToObjects(getSheet(SHEET_USERS));
  if (users.some(function (u) { return _ecNorm_(u.email) === novo; })) {
    return { ok: false, error: 'Ja existe uma conta com esse e-mail.' };
  }

  var codigo = String(Math.floor(100000 + Math.random() * 900000));
  CacheService.getScriptCache().put(_ecChave_(user.email), JSON.stringify({
    novo: novo, hash: _sha256Hex_(codigo + '|' + novo), tentativas: 0
  }), EC_OTP_TTL);

  try {
    _enviarEmailWpk_(novo, 'Confirme seu novo e-mail: ' + codigo,
      'Use o codigo ' + codigo + ' para confirmar a troca de e-mail. Vale por 10 minutos.',
      _tcEmailOtpHtml_(String(user.name || '').split(' ')[0] || '', codigo));
  } catch (e) {
    return { ok: false, error: 'Nao consegui enviar o codigo para esse e-mail.' };
  }

  logAction(user.email, 'EMAIL_TROCA_SOLICITADA', 'user', '', 'para ' + novo);
  return { ok: true, enviadoPara: novo, expiraEm: EC_OTP_TTL };
}

function confirmarTrocaEmail(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  var codigo = String((data || {}).codigo || '').replace(/\D/g, '');
  if (codigo.length !== 6) return { ok: false, error: 'Digite os 6 digitos.' };

  var c = CacheService.getScriptCache();
  var raw = c.get(_ecChave_(user.email));
  if (!raw) return { ok: false, error: 'O pedido expirou. Comece de novo.' };

  var st = JSON.parse(raw);
  st.tentativas = Number(st.tentativas || 0) + 1;
  if (st.tentativas > EC_OTP_TENT) {
    c.remove(_ecChave_(user.email));
    return { ok: false, error: 'Muitas tentativas. Comece de novo.' };
  }
  if (!_timingEq_(_sha256Hex_(codigo + '|' + st.novo), String(st.hash))) {
    c.put(_ecChave_(user.email), JSON.stringify(st), EC_OTP_TTL);
    return { ok: false, error: 'Codigo incorreto. Restam ' + (EC_OTP_TENT - st.tentativas) + '.' };
  }

  c.remove(_ecChave_(user.email));
  var r = _ecExecutarTroca_(user.email, st.novo, user.email, 'troca pelo proprio aluno');
  if (!r.ok) return r;

  try { _ecAvisarTroca_(st.novo, user.email, true); } catch (e) {}
  return { ok: true, novo: st.novo, precisaLogarDeNovo: true };
}

// ── E-mail de aviso ─────────────────────────────────────────
function _ecAvisarTroca_(para, outro, ehNovo) {
  var titulo = ehNovo ? 'Seu e-mail de acesso foi atualizado' : 'Seu acesso mudou de e-mail';
  var corpo = ehNovo
    ? '<p style="margin:0 0 14px">Pronto. A partir de agora voce entra no app com <b>' + para + '</b>.</p>' +
      '<p style="margin:0 0 14px">Seu progresso, sua assinatura e seu historico continuam iguais — ' +
      'so o endereco de login mudou.</p>' +
      '<p style="margin:0">Voce precisa entrar de novo, usando este e-mail.</p>'
    : '<p style="margin:0 0 14px">O acesso desta conta passou a usar <b>' + outro + '</b>.</p>' +
      '<p style="margin:0">Se nao foi voce quem pediu, responda este e-mail imediatamente.</p>';

  var html =
  '<div style="margin:0;padding:28px 16px;background:#f4f6f4;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">' +
    '<div style="max-width:460px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 14px rgba(0,0,0,.07)">' +
      '<div style="background:linear-gradient(135deg,#4caf50,#2e7d32);padding:22px 26px">' +
        '<div style="color:rgba(255,255,255,.72);font-size:11px;letter-spacing:2px;text-transform:uppercase">WPK Tavares</div>' +
        '<div style="color:#fff;font-size:18px;font-weight:800;margin-top:4px">' + titulo + '</div>' +
      '</div>' +
      '<div style="padding:26px;color:#2c3a30;font-size:14.5px;line-height:1.7">' + corpo +
        '<div style="text-align:center;margin:24px 0 4px">' +
          '<a href="https://app.wpktavares.com.br" style="display:inline-block;' +
            'background:linear-gradient(135deg,#4caf50,#2e7d32);color:#fff;text-decoration:none;' +
            'padding:13px 30px;border-radius:11px;font-weight:800;font-size:14.5px">Abrir o app</a>' +
        '</div>' +
      '</div>' +
      '<div style="padding:16px 26px;border-top:1px solid #eef1ee;color:#8a9a8e;font-size:11.5px">' +
        'WPK Tavares - Equipe Lapidados</div>' +
    '</div>' +
  '</div>';

  _enviarEmailWpk_(para, titulo, titulo, html);
}

// ─────────────────────────────────────────────────────────────
// Atalho de editor para o caso da Apolyana. Preencha e execute.
// ─────────────────────────────────────────────────────────────
function trocarEmailApolyana() {
  var ANTIGO = 'COLE_O_EMAIL_ANTIGO_AQUI';
  var NOVO   = 'lirasantanaapolyana@gmail.com';

  if (ANTIGO.indexOf('COLE_') === 0) {
    Logger.log('Cole o e-mail ANTIGO dela na variavel ANTIGO e execute de novo.');
    return;
  }
  var r = _ecExecutarTroca_(ANTIGO, NOVO, 'editor-admin', 'perdeu acesso ao e-mail antigo');
  Logger.log(JSON.stringify(r, null, 2));
  if (r.ok) {
    try { _ecAvisarTroca_(NOVO, ANTIGO, true); Logger.log('Aviso enviado para ' + NOVO); }
    catch (e) { Logger.log('Troca feita, mas o aviso falhou: ' + e.message); }
  }
  return r;
}
