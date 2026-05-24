// ============================================================
// Auth.gs — Authentication & Session Management
// ============================================================

function hashPassword(password) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password
  );
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

function login(email, password) {
  try {
    const sheet = getSheet(SHEET_USERS);
    const users = sheetToObjects(sheet);
    const user  = users.find(u => u.email === email && u.active);
    if (!user) return { ok: false, error: 'Usuário não encontrado ou inativo.' };

    const hash = hashPassword(password);
    if (user.password_hash !== hash) return { ok: false, error: 'Senha incorreta.' };

    // Generate session token
    const token = generateId();
    updateUserToken(sheet, users, email, token);
    logAction(email, 'LOGIN', 'session', '', '');

    return {
      ok: true,
      token,
      user: { name: user.name, email: user.email, role: user.role }
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function logout(token) {
  const sheet = getSheet(SHEET_USERS);
  const users = sheetToObjects(sheet);
  const user  = users.find(u => u.token === token);
  if (user) {
    updateUserToken(sheet, users, user.email, '');
    logAction(user.email, 'LOGOUT', 'session', '', '');
  }
  return { ok: true };
}

function getUserByToken(token) {
  if (!token) return null;
  const sheet = getSheet(SHEET_USERS);
  const users = sheetToObjects(sheet);
  return users.find(u => u.token === token && u.active) || null;
}

function updateUserToken(sheet, users, email, token) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const tokenCol = headers.indexOf('token') + 1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][headers.indexOf('email')] === email) {
      sheet.getRange(i + 1, tokenCol).setValue(token);
      break;
    }
  }
}

// ── User CRUD ────────────────────────────────────────────────
function getUsers(token) {
  const caller = getUserByToken(token);
  if (!caller || caller.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  const users = sheetToObjects(getSheet(SHEET_USERS)).map(u => ({
    id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, created_at: u.created_at
  }));
  return { ok: true, data: users };
}

function createUser(token, userData) {
  const caller = getUserByToken(token);
  if (!caller || caller.role !== 'admin') return { ok: false, error: 'Sem permissão.' };

  const sheet = getSheet(SHEET_USERS);
  const users = sheetToObjects(sheet);
  if (users.find(u => u.email === userData.email)) return { ok: false, error: 'Email já cadastrado.' };

  const id = generateId();
  sheet.appendRow([
    id, userData.name, userData.email,
    hashPassword(userData.password), userData.role || 'user',
    '', true, nowISO()
  ]);
  logAction(caller.email, 'CREATE_USER', 'user', id, userData.email);
  return { ok: true, id };
}

function updateUser(token, userId, updates) {
  const caller = getUserByToken(token);
  if (!caller || caller.role !== 'admin') return { ok: false, error: 'Sem permissão.' };

  const sheet = getSheet(SHEET_USERS);
  const data  = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');

  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === userId) {
      if (updates.name)     sheet.getRange(i+1, headers.indexOf('name')+1).setValue(updates.name);
      if (updates.role)     sheet.getRange(i+1, headers.indexOf('role')+1).setValue(updates.role);
      if (updates.active !== undefined) sheet.getRange(i+1, headers.indexOf('active')+1).setValue(updates.active);
      if (updates.password) sheet.getRange(i+1, headers.indexOf('password_hash')+1).setValue(hashPassword(updates.password));
      logAction(caller.email, 'UPDATE_USER', 'user', userId, JSON.stringify(updates));
      return { ok: true };
    }
  }
  return { ok: false, error: 'Usuário não encontrado.' };
}

// ══════════════════════════════════════════════════════════════
// sendPasswordReset — gera código de 6 dígitos e envia por e-mail
// ══════════════════════════════════════════════════════════════
function sendPasswordReset(email) {
  if (!email) return { ok: false, error: 'E-mail obrigatório.' };

  const sheet = getSheet(SHEET_USERS);
  const users = sheetToObjects(sheet);
  const user  = users.find(u => u.email === email && u.active);
  if (!user) return { ok: false, error: 'E-mail não encontrado.' };

  // Código de 6 dígitos + expiração de 5 minutos
  const code    = String(Math.floor(100000 + Math.random() * 900000));
  const now     = new Date();
  const expires = new Date(now.getTime() + 5 * 60 * 1000);

  // Persiste na aba password_reset
  try { initPasswordResetSheet_(); } catch(e) {}
  const resetSheet = getSpreadsheet_().getSheetByName(SHEET_RESET_CODES);
  if (!resetSheet) return { ok: false, error: 'Aba de reset não encontrada. Execute autorizarPermissoesDoSistema() primeiro.' };
  resetSheet.appendRow([generateId(), email, code, expires.toISOString(), false, now.toISOString()]);

  // Envia e-mail
  let wsNome = 'WPK Tavares';
  try { wsNome = getWorkspaceConfig().nome || wsNome; } catch(e) {}

  const subject = wsNome + ' — Código de recuperação de senha';
  const html    = _buildResetEmailHtml_(user.name || email, code, wsNome);
  try {
    MailApp.sendEmail({ to: email, subject: subject, htmlBody: html });
  } catch(mailErr) {
    return { ok: false, error: 'Erro ao enviar e-mail: ' + mailErr.message };
  }

  logAction(email, 'PASSWORD_RESET_REQUEST', 'user', email, '');
  return { ok: true };
}

// ══════════════════════════════════════════════════════════════
// verifyAndResetPassword — valida código e salva nova senha
// ══════════════════════════════════════════════════════════════
function verifyAndResetPassword(email, code, newPassword) {
  if (!email || !code || !newPassword) return { ok: false, error: 'Campos obrigatórios.' };
  if (newPassword.length < 6) return { ok: false, error: 'Senha deve ter ao menos 6 caracteres.' };

  try { initPasswordResetSheet_(); } catch(e) {}
  const resetSheet = getSpreadsheet_().getSheetByName(SHEET_RESET_CODES);
  if (!resetSheet) return { ok: false, error: 'Serviço de reset indisponível.' };

  const data    = resetSheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h));
  const now     = new Date();
  let   foundRow = -1;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const obj = {};
    headers.forEach((h, j) => { obj[h] = row[j]; });

    if (
      String(obj.email).toLowerCase() === email.toLowerCase() &&
      String(obj.code)  === String(code) &&
      obj.used  !== true  &&
      new Date(obj.expires_at) > now
    ) {
      foundRow = i + 1;
      break;
    }
  }

  if (foundRow < 0) return { ok: false, error: 'Código inválido ou expirado.' };

  // Marca o código como usado
  const usedIdx = headers.indexOf('used') + 1;
  resetSheet.getRange(foundRow, usedIdx).setValue(true);

  // Atualiza a senha do usuário
  const userSheet = getSheet(SHEET_USERS);
  const uData     = userSheet.getDataRange().getValues();
  const uHeaders  = uData[0];
  const hashCol   = uHeaders.indexOf('password_hash') + 1;

  for (let i = 1; i < uData.length; i++) {
    if (String(uData[i][uHeaders.indexOf('email')]).toLowerCase() === email.toLowerCase()) {
      userSheet.getRange(i + 1, hashCol).setValue(hashPassword(newPassword));
      logAction(email, 'PASSWORD_RESET_SUCCESS', 'user', email, '');
      return { ok: true };
    }
  }

  return { ok: false, error: 'Usuário não encontrado.' };
}

// ── Template de e-mail para reset ─────────────────────────────
function _buildResetEmailHtml_(nome, code, wsNome) {
  const esc = function(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  };
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    'body{background:#07090a;margin:0;padding:40px 16px;font-family:\'DM Sans\',Segoe UI,sans-serif}' +
    '.wrap{max-width:480px;margin:0 auto;background:#0f1412;border:1px solid rgba(76,175,80,0.18);border-radius:20px;overflow:hidden}' +
    '.bar{height:3px;background:linear-gradient(90deg,#4caf50,#6dde71,#4caf50)}' +
    '.body{padding:36px 32px}' +
    '.icon{width:52px;height:52px;background:linear-gradient(135deg,#4caf50,#2e6b31);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:20px}' +
    'h2{color:#dde8dd;font-size:22px;font-weight:800;margin:0 0 8px}' +
    'p{color:#6e9070;font-size:14px;line-height:1.65;margin:0 0 16px}' +
    'strong{color:#dde8dd}' +
    '.code-box{background:#141c18;border:1px solid rgba(76,175,80,0.28);border-radius:14px;padding:24px;text-align:center;margin:20px 0}' +
    '.code{font-size:44px;font-weight:800;color:#4caf50;letter-spacing:0.2em}' +
    '.code-lbl{font-size:11px;color:#6e9070;text-transform:uppercase;letter-spacing:0.1em;margin-top:10px}' +
    '.foot{padding:18px 32px;border-top:1px solid rgba(76,175,80,0.1);text-align:center;font-size:11px;color:#3e5a3e}' +
    '</style></head><body>' +
    '<div class="wrap"><div class="bar"></div><div class="body">' +
    '<div class="icon">🔑</div>' +
    '<h2>Redefinir senha</h2>' +
    '<p>Olá, <strong>' + esc(nome) + '</strong>!<br>' +
    'Recebemos uma solicitação para redefinir sua senha no <strong>' + esc(wsNome) + '</strong>.</p>' +
    '<div class="code-box">' +
    '<div class="code">' + esc(code) + '</div>' +
    '<div class="code-lbl">Válido por 5 minutos</div>' +
    '</div>' +
    '<p>Digite este código na tela de login para criar sua nova senha.</p>' +
    '<p style="color:#3e5a3e;font-size:13px">Se não foi você, ignore este e-mail com segurança.</p>' +
    '</div>' +
    '<div class="foot">' + esc(wsNome) + ' &middot; e-mail automático &middot; não responda</div>' +
    '</div></body></html>';
}