// ============================================================
// auth_admin.gs — 2FA, recuperação de senha e link mágico (v130)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// Reusa a aba `password_reset` (id, email, code, expires_at,
// used, created_at) e o CacheService para o que é efêmero.
//
// Nota de arquitetura: o Apps Script não define headers de
// resposta, então não há cookie HttpOnly aqui. O token de sessão
// continua no sessionStorage — estas rotas endurecem a ENTRADA
// (segundo fator, expiração curta, uso único), não o transporte.
// ============================================================

var A2F_TTL_SEG        = 10 * 60;   // prazo para digitar o código
var A2F_MAX_TENTATIVAS = 5;
var ML_TTL_MIN         = 15;        // validade do link mágico
var ADMIN_URL          = 'https://app.wpktavares.com.br/admin/';

// ─────────────────────────────────────────────────────────────
// Coluna `twofa` na aba users — migração automática e silenciosa
// ─────────────────────────────────────────────────────────────
function _garantirColunaTwofa_() {
  var sh = getSheet(SHEET_USERS);
  var last = Math.max(1, sh.getLastColumn());
  var headers = sh.getRange(1, 1, 1, last).getValues()[0].map(function (h) { return String(h || ''); });
  if (headers.indexOf('twofa') < 0) {
    sh.getRange(1, last + 1).setValue('twofa');
  }
  return sh;
}

function _twofaAtivo_(user) {
  var v = String((user && user.twofa) || '').toLowerCase().trim();
  return v === 'true' || v === '1' || v === 'sim';
}

// ─────────────────────────────────────────────────────────────
// Token de uso único com validade em MINUTOS.
// Não dá pra reusar _gerarTokenAcesso_ do onboarding: ele faz
// parseInt(horas), e parseInt(0.25) é 0 — o link já nasceria
// expirado.
// ─────────────────────────────────────────────────────────────
function _gerarTokenAdmin_(email, minutos) {
  email = String(email || '').toLowerCase().trim();
  if (!email) return '';

  try { initPasswordResetSheet_(); } catch (e) {}
  var sh = getSpreadsheet_().getSheetByName(SHEET_RESET_CODES);
  if (!sh) throw new Error('Aba password_reset ausente.');

  var token = Utilities.getUuid().replace(/-/g, '') +
              Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  var agora  = new Date();
  var expira = new Date(agora.getTime() + (Number(minutos) || ML_TTL_MIN) * 60 * 1000);
  sh.appendRow([generateId(), email, token, expira.toISOString(), false, agora.toISOString()]);
  return token;
}

function _acharAdminPorEmail_(email) {
  var alvo = String(email || '').toLowerCase().trim();
  if (!alvo) return null;
  var users = sheetToObjects(getSheet(SHEET_USERS));
  var u = users.find(function (x) {
    return String(x.email || '').toLowerCase().trim() === alvo && x.active;
  });
  return (u && u.role === 'admin') ? u : null;
}

// Freio genérico por e-mail+ação (reusa a ideia do rate limit do login)
function _freioOk_(acao, email, maximo, janelaSeg) {
  try {
    var k = 'fr_' + acao + '_' + _sha256Hex_(String(email || '').toLowerCase().trim()).substring(0, 24);
    var c = CacheService.getScriptCache();
    var n = Number(c.get(k) || 0) + 1;
    c.put(k, String(n), janelaSeg);
    return n <= maximo;
  } catch (e) { return true; }
}

// ═════════════════════════════════════════════════════════════
// 2FA — segundo fator por código no e-mail
// ═════════════════════════════════════════════════════════════

function _2faChave_(desafio) { return 'a2f_' + String(desafio || ''); }

// Cria o desafio, manda o código e devolve o id do desafio.
function _2faCriarDesafio_(user) {
  var desafio = Utilities.getUuid().replace(/-/g, '');
  var codigo  = String(Math.floor(100000 + Math.random() * 900000));

  CacheService.getScriptCache().put(_2faChave_(desafio), JSON.stringify({
    email: String(user.email || '').toLowerCase().trim(),
    codigo: codigo,
    tentativas: 0
  }), A2F_TTL_SEG);

  var nome = String(user.name || '').split(' ')[0] || '';
  try {
    MailApp.sendEmail({
      to: user.email,
      subject: 'Seu código de acesso: ' + codigo,
      htmlBody: _emailCodigo2FA_(nome, codigo)
    });
  } catch (e) {
    logAction(user.email, '2FA_EMAIL_FALHOU', 'auth', '', e.message);
    return '';
  }
  logAction(user.email, '2FA_ENVIADO', 'auth', '', '');
  return desafio;
}

// ROTA PÚBLICA: verifica o código e devolve a sessão de verdade.
function verificar2FA(desafio, codigo) {
  var c   = CacheService.getScriptCache();
  var key = _2faChave_(desafio);
  var raw = c.get(key);
  if (!raw) return { ok: false, error: 'Este código expirou. Faça login novamente.' };

  var st;
  try { st = JSON.parse(raw); } catch (e) { return { ok: false, error: 'Desafio inválido.' }; }

  st.tentativas = Number(st.tentativas || 0) + 1;
  if (st.tentativas > A2F_MAX_TENTATIVAS) {
    c.remove(key);
    logAction(st.email, '2FA_BLOQUEADO', 'auth', '', 'excedeu tentativas');
    return { ok: false, error: 'Muitas tentativas. Faça login novamente.' };
  }

  var digitado = String(codigo || '').replace(/\D/g, '');
  if (!_timingEq_(digitado, String(st.codigo))) {
    c.put(key, JSON.stringify(st), A2F_TTL_SEG);
    var restam = A2F_MAX_TENTATIVAS - st.tentativas;
    return {
      ok: false,
      error: 'Código incorreto.' + (restam > 0 ? ' Restam ' + restam + ' tentativa(s).' : '')
    };
  }

  // Acertou: consome o desafio e abre a sessão
  c.remove(key);
  var sheet = getSheet(SHEET_USERS);
  var users = sheetToObjects(sheet);
  var user  = users.find(function (u) {
    return String(u.email || '').toLowerCase().trim() === st.email && u.active;
  });
  if (!user) return { ok: false, error: 'Usuário não encontrado.' };

  var token = generateId();
  if (!updateUserToken(sheet, users, st.email, token)) {
    return { ok: false, error: 'Não foi possível iniciar a sessão. Tente novamente.' };
  }
  _rlLimpar_(st.email);
  logAction(st.email, 'LOGIN_2FA', 'session', '', '');

  return { ok: true, token: token, user: { name: user.name, email: user.email, role: user.role } };
}

// ROTA PÚBLICA: reenviar o código do mesmo desafio.
function reenviar2FA(desafio) {
  var c = CacheService.getScriptCache();
  var raw = c.get(_2faChave_(desafio));
  if (!raw) return { ok: false, error: 'Este desafio expirou. Faça login novamente.' };

  var st = JSON.parse(raw);
  if (!_freioOk_('r2f', st.email, 3, 10 * 60)) {
    return { ok: false, error: 'Você já pediu o código várias vezes. Aguarde alguns minutos.' };
  }
  var user = _acharAdminPorEmail_(st.email);
  if (!user) return { ok: false, error: 'Usuário não encontrado.' };

  try {
    MailApp.sendEmail({
      to: user.email,
      subject: 'Seu código de acesso: ' + st.codigo,
      htmlBody: _emailCodigo2FA_(String(user.name || '').split(' ')[0] || '', st.codigo)
    });
  } catch (e) { return { ok: false, error: 'Não consegui reenviar: ' + e.message }; }

  return { ok: true, message: 'Código reenviado.' };
}

// ROTA AUTENTICADA: o admin liga/desliga o próprio 2FA.
function definir2FA(token, ativo) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };

  var sh = _garantirColunaTwofa_();
  var dados   = sh.getDataRange().getValues();
  var headers = dados[0].map(function (h) { return String(h || ''); });
  var iEmail  = headers.indexOf('email');
  var iTwofa  = headers.indexOf('twofa') + 1;
  var alvo    = String(user.email || '').toLowerCase().trim();

  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][iEmail] || '').toLowerCase().trim() === alvo) {
      sh.getRange(i + 1, iTwofa).setValue(ativo ? 'true' : 'false');
      logAction(user.email, ativo ? '2FA_ATIVADO' : '2FA_DESATIVADO', 'auth', '', '');
      return { ok: true, ativo: !!ativo };
    }
  }
  return { ok: false, error: 'Usuário não encontrado na planilha.' };
}

// ROTA AUTENTICADA: estado atual do 2FA do admin logado.
function get2FAStatus(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  return { ok: true, ativo: _twofaAtivo_(user), email: user.email };
}

// ═════════════════════════════════════════════════════════════
// LINK MÁGICO — entrar sem digitar senha
// ═════════════════════════════════════════════════════════════

// ROTA PÚBLICA. Responde sempre { ok:true } para não revelar quem é
// admin (anti-enumeração), mesmo quando não envia nada.
function solicitarLinkMagicoAdmin(email) {
  var alvo = String(email || '').toLowerCase().trim();
  if (!alvo) return { ok: true };

  if (!_freioOk_('ml', alvo, 3, 15 * 60)) return { ok: true };

  var user = _acharAdminPorEmail_(alvo);
  if (!user) {
    logAction(alvo, 'MAGICLINK_IGNORADO', 'auth', '', 'nao e admin ativo');
    return { ok: true };
  }

  try {
    var t = _gerarTokenAdmin_(alvo, ML_TTL_MIN);
    var link = ADMIN_URL + '?ml=' + encodeURIComponent(t);
    MailApp.sendEmail({
      to: user.email,
      subject: 'Seu link de acesso ao painel',
      htmlBody: _emailLinkMagico_(String(user.name || '').split(' ')[0] || '', link)
    });
    logAction(alvo, 'MAGICLINK_ENVIADO', 'auth', '', '');
  } catch (e) {
    logAction(alvo, 'MAGICLINK_FALHOU', 'auth', '', e.message);
  }
  return { ok: true };
}

// ROTA PÚBLICA: troca o token do link por uma sessão.
function entrarComLinkMagico(t) {
  var achado = _acharTokenAcesso_(t);
  if (!achado) return { ok: false, error: 'Este link expirou ou já foi usado.' };

  var sheet = getSheet(SHEET_USERS);
  var users = sheetToObjects(sheet);
  var alvo  = String(achado.email || '').toLowerCase().trim();
  var user  = users.find(function (u) {
    return String(u.email || '').toLowerCase().trim() === alvo && u.active;
  });
  if (!user || user.role !== 'admin') return { ok: false, error: 'Este link não dá acesso ao painel.' };

  // Consome o token ANTES de abrir a sessão — uso único de verdade
  try {
    getSpreadsheet_().getSheetByName(SHEET_RESET_CODES)
      .getRange(achado.rowIndex, achado.usedCol).setValue(true);
  } catch (e) {
    return { ok: false, error: 'Não foi possível validar o link. Tente novamente.' };
  }

  var token = generateId();
  if (!updateUserToken(sheet, users, alvo, token)) {
    return { ok: false, error: 'Não foi possível iniciar a sessão. Tente novamente.' };
  }
  _rlLimpar_(alvo);
  logAction(alvo, 'LOGIN_MAGICLINK', 'session', '', '');

  return { ok: true, token: token, user: { name: user.name, email: user.email, role: user.role } };
}

// ═════════════════════════════════════════════════════════════
// E-mails
// ═════════════════════════════════════════════════════════════

function _emailBase_(titulo, corpo) {
  return '' +
  '<div style="margin:0;padding:28px 16px;background:#f4f6f4;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">' +
    '<div style="max-width:460px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;' +
                'box-shadow:0 2px 14px rgba(0,0,0,.07)">' +
      '<div style="background:linear-gradient(135deg,#4caf50,#2e7d32);padding:22px 26px">' +
        '<div style="color:rgba(255,255,255,.72);font-size:11px;letter-spacing:2px;text-transform:uppercase">WPK Tavares</div>' +
        '<div style="color:#fff;font-size:18px;font-weight:800;margin-top:4px">' + titulo + '</div>' +
      '</div>' +
      '<div style="padding:26px;color:#2c3a30;font-size:14.5px;line-height:1.65">' + corpo + '</div>' +
      '<div style="padding:16px 26px;border-top:1px solid #eef1ee;color:#8a9a8e;font-size:11.5px">' +
        'Se não foi você quem pediu, pode ignorar este e-mail — nada muda na sua conta.' +
      '</div>' +
    '</div>' +
  '</div>';
}

function _emailCodigo2FA_(nome, codigo) {
  return _emailBase_('Código de acesso',
    (nome ? '<p style="margin:0 0 14px">Oi, ' + nome + '!</p>' : '') +
    '<p style="margin:0 0 18px">Use o código abaixo para concluir a entrada no painel:</p>' +
    '<div style="text-align:center;margin:22px 0">' +
      '<div style="display:inline-block;background:#f2f7f3;border:1px solid #d7e6da;border-radius:12px;' +
                  'padding:15px 26px;font-size:31px;font-weight:800;letter-spacing:9px;color:#2e7d32">' +
        codigo +
      '</div>' +
    '</div>' +
    '<p style="margin:0;color:#7a8a7e;font-size:13px">O código vale por 10 minutos e só pode ser usado uma vez.</p>');
}

function _emailLinkMagico_(nome, link) {
  return _emailBase_('Seu link de acesso',
    (nome ? '<p style="margin:0 0 14px">Oi, ' + nome + '!</p>' : '') +
    '<p style="margin:0 0 20px">Clique no botão para entrar no painel sem digitar senha:</p>' +
    '<div style="text-align:center;margin:24px 0">' +
      '<a href="' + link + '" style="display:inline-block;background:linear-gradient(135deg,#4caf50,#2e7d32);' +
        'color:#fff;text-decoration:none;padding:14px 30px;border-radius:11px;font-weight:800;font-size:14.5px">' +
        'Entrar no painel</a>' +
    '</div>' +
    '<p style="margin:0 0 6px;color:#7a8a7e;font-size:13px">O link vale por ' + ML_TTL_MIN +
      ' minutos e funciona uma única vez.</p>' +
    '<p style="margin:0;color:#9aa89e;font-size:11.5px;word-break:break-all">Se o botão não funcionar: ' + link + '</p>');
}
