// ============================================================
// reabertura.gs — Fluxo de Reabertura de Acesso
// Valida comprador na aba 'compradores' → cria ou reseta
// usuário na aba 'users' → envia e-mail com credenciais
// ============================================================

var CHECKOUT_URL_REABERTURA = 'https://pay.cakto.com.br/a4po2eu_659401';

// ════════════════════════════════════════════════════════════
// reaberturaAccess — endpoint público (sem token)
//   Recebe: email
//   Retorna:
//     { ok: false, status: 'not_found', checkout_url }
//     { ok: true,  status: 'created'  }  → novo aluno, e-mail enviado
//     { ok: true,  status: 'existing' }  → aluno já existia, senha resetada
// ════════════════════════════════════════════════════════════
function reaberturaAccess(email) {
  if (!email || typeof email !== 'string') {
    return { ok: false, error: 'E-mail inválido.' };
  }
  email = email.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Formato de e-mail inválido.' };
  }

  try {
    // ── 1. Busca na aba compradores ──────────────────────────
    var ss  = getSpreadsheet_();
    var aba = ss.getSheetByName(SHEET_COMPRADORES);
    if (!aba || aba.getLastRow() < 2) {
      logAction('system', 'REABERTURA_NOT_FOUND', 'comprador', email, 'aba vazia');
      return { ok: false, status: 'not_found', checkout_url: CHECKOUT_URL_REABERTURA };
    }

    var dados    = aba.getDataRange().getValues();
    var headers  = dados[0].map(function(h) { return String(h); });
    var emailIdx = headers.indexOf('Email');
    var nomeIdx  = headers.indexOf('Nome');

    var compradorRow = null;
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][emailIdx] || '').toLowerCase().trim() === email) {
        compradorRow = dados[i];
        break;
      }
    }

    if (!compradorRow) {
      logAction('system', 'REABERTURA_NOT_FOUND', 'comprador', email, '');
      return { ok: false, status: 'not_found', checkout_url: CHECKOUT_URL_REABERTURA };
    }

    var nome = String(compradorRow[nomeIdx] || '').trim() || email;

    // ── 2. Workspace config ──────────────────────────────────
    var wsNome = 'WPK Tavares';
    try { wsNome = getWorkspaceConfig().nome || wsNome; } catch(e) {}
    var appUrl = 'https://wpktavares.com.br/app/';

    // ── 3. Verifica / cria usuário ───────────────────────────
    var tempPassword = _gerarSenhaTemp_();
    var userSheet    = getSheet(SHEET_USERS);
    var uData        = userSheet.getDataRange().getValues();
    var uHeaders     = uData[0];
    var uEmailIdx    = uHeaders.indexOf('email');
    var uHashIdx     = uHeaders.indexOf('password_hash') + 1;
    var uActiveIdx   = uHeaders.indexOf('active') + 1;

    var existingRow = -1;
    for (var j = 1; j < uData.length; j++) {
      if (String(uData[j][uEmailIdx] || '').toLowerCase().trim() === email) {
        existingRow = j + 1; // 1-based sheet row
        break;
      }
    }

    if (existingRow < 0) {
      // ── Novo aluno: cria registro ──
      userSheet.appendRow([
        generateId(),
        nome,
        email,
        hashPassword(tempPassword),
        'aluno',
        '',      // token vazio
        true,    // active
        nowISO()
      ]);
      logAction('system', 'REABERTURA_USER_CREATED', 'user', email, nome);
      _enviarCredenciaisReinabertura_(email, nome, tempPassword, wsNome, appUrl);
      return { ok: true, status: 'created' };

    } else {
      // ── Aluno já existe: reseta senha e garante active=true ──
      userSheet.getRange(existingRow, uHashIdx).setValue(hashPassword(tempPassword));
      var currentActive = uData[existingRow - 1][uActiveIdx - 1];
      if (currentActive !== true) {
        userSheet.getRange(existingRow, uActiveIdx).setValue(true);
      }
      logAction('system', 'REABERTURA_USER_RESET', 'user', email, nome);
      _enviarCredenciaisReinabertura_(email, nome, tempPassword, wsNome, appUrl);
      return { ok: true, status: 'existing' };
    }

  } catch (err) {
    logAction('system', 'REABERTURA_ERROR', 'comprador', email, err.message);
    return { ok: false, error: 'Erro interno: ' + err.message };
  }
}

// ── Gera senha temporária legível (8 chars, sem ambíguos) ────
function _gerarSenhaTemp_() {
  var chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var senha = '';
  for (var i = 0; i < 8; i++) {
    senha += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return senha;
}

// ── Envia e-mail com credenciais de acesso ───────────────────
function _enviarCredenciaisReinabertura_(email, nome, senha, wsNome, appUrl) {
  var subject = wsNome + ' — Seu acesso ao Desafio 21 Dias está liberado! 🔓';
  var html    = _buildAcessoEmailHtml_(nome, email, senha, wsNome, appUrl);
  MailApp.sendEmail({ to: email, subject: subject, htmlBody: html });
}

// ── Template HTML dark de boas-vindas ────────────────────────
function _buildAcessoEmailHtml_(nome, email, senha, wsNome, appUrl) {
  var esc = function(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };
  var primeiroNome = esc(String(nome || '').split(' ')[0] || 'aluno');

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    'body{background:#07090a;margin:0;padding:40px 16px;font-family:\'DM Sans\',Segoe UI,sans-serif}' +
    '.wrap{max-width:520px;margin:0 auto;background:#0f1412;border:1px solid rgba(76,175,80,0.18);border-radius:20px;overflow:hidden}' +
    '.bar{height:3px;background:linear-gradient(90deg,#4caf50,#6dde71,#4caf50)}' +
    '.body{padding:36px 32px}' +
    '.icon{width:52px;height:52px;background:linear-gradient(135deg,#4caf50,#2e6b31);border-radius:14px;' +
      'display:inline-flex;align-items:center;justify-content:center;font-size:26px;margin-bottom:20px}' +
    'h2{color:#dde8dd;font-size:22px;font-weight:800;margin:0 0 8px}' +
    'p{color:#6e9070;font-size:14px;line-height:1.65;margin:0 0 16px}' +
    'strong{color:#dde8dd}' +
    '.cred-box{background:#141c18;border:1px solid rgba(76,175,80,0.28);border-radius:14px;padding:22px 24px;margin:20px 0}' +
    '.cred-row{margin-bottom:14px}' +
    '.cred-row:last-child{margin-bottom:0}' +
    '.cred-label{display:block;font-size:11px;color:#6e9070;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px}' +
    '.cred-val{display:block;font-size:17px;font-weight:700;color:#6dde71;letter-spacing:.06em;word-break:break-all}' +
    '.btn{display:block;background:#4caf50;color:#fff !important;font-size:15px;font-weight:700;' +
      'text-decoration:none;text-align:center;padding:16px 24px;border-radius:11px;margin-top:22px;' +
      'box-shadow:0 4px 24px rgba(76,175,80,.28)}' +
    '.note{font-size:12px;color:#3e5a3e;margin-top:16px;line-height:1.7}' +
    '.foot{padding:18px 32px;border-top:1px solid rgba(76,175,80,.08);text-align:center;font-size:11px;color:#3e5a3e}' +
    '</style></head><body>' +
    '<div class="wrap">' +
    '<div class="bar"></div>' +
    '<div class="body">' +
    '<div class="icon">🔓</div>' +
    '<h2>Acesso liberado, ' + primeiroNome + '!</h2>' +
    '<p>Seu acesso ao <strong>' + esc(wsNome) + ' — Desafio 21 Dias</strong> está ativo.<br>' +
    'Guarde as credenciais abaixo para entrar na plataforma:</p>' +
    '<div class="cred-box">' +
    '<div class="cred-row">' +
      '<span class="cred-label">E-mail</span>' +
      '<span class="cred-val">' + esc(email) + '</span>' +
    '</div>' +
    '<div class="cred-row">' +
      '<span class="cred-label">Senha temporária</span>' +
      '<span class="cred-val">' + esc(senha) + '</span>' +
    '</div>' +
    '</div>' +
    '<a href="' + esc(appUrl) + '" class="btn">Acessar o Desafio 21 Dias →</a>' +
    '<p class="note">' +
    'Após o primeiro login você pode redefinir sua senha na tela de acesso.<br>' +
    'Se não foi você quem solicitou este acesso, ignore este e-mail com segurança.' +
    '</p>' +
    '</div>' +
    '<div class="foot">' + esc(wsNome) + ' &middot; e-mail automático &middot; não responda</div>' +
    '</div>' +
    '</body></html>';
}
