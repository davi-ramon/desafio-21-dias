// ══════════════════════════════════════════════════════════════
// users_extra.gs — extensao de auth.gs: colunas extendidas + endpoints
// de perfil completo (avatar, capa, bio, contato, seguranca).
// NAO modifica auth.gs (zero risco de regressao).
// ══════════════════════════════════════════════════════════════

const USERS_EXTRA_COLS = {
  AVATAR_URL:      9,   // I
  CAPA_URL:        10,  // J
  BIO:             11,  // K
  PRIMEIRO_NOME:   12,  // L
  SOBRENOME:       13,  // M
  APELIDO:         14,  // N
  CARGO:           15,  // O
  DEPARTAMENTO:    16,  // P
  TELEFONE:        17,  // Q
  WHATSAPP:        18,  // R
  ULTIMO_LOGIN:    19,  // S
  ULTIMO_IP:       20,  // T
  DISPOSITIVOS:    21,  // U  (JSON array de devices conhecidos)
  SESSOES_ATIVAS:  22,  // V  (JSON array de sessoes)
  CRIADO_POR:      23,  // W
  ATUALIZADO_EM:   24,  // X
};

const USERS_EXTRA_HEADERS = [
  'avatar_url','capa_url','bio','primeiro_nome','sobrenome','apelido','cargo',
  'departamento','telefone','whatsapp','ultimo_login','ultimo_ip','dispositivos',
  'sessoes_ativas','criado_por','atualizado_em'
];

// Garante que a aba users tem todas as colunas extras. Idempotente.
function ensureUsersExtraColumns_() {
  var sheet = getSheet(SHEET_USERS);
  var last = sheet.getLastColumn();
  if (last === 0) return; // aba vazia -> initUsers() cuida
  if (last >= 24) return; // ja tem tudo
  var headers = sheet.getRange(1, 1, 1, last).getValues()[0];
  var missing = USERS_EXTRA_HEADERS.filter(function(h) {
    return headers.indexOf(h) === -1;
  });
  if (missing.length === 0) return;
  missing.forEach(function(h, i) {
    sheet.getRange(1, last + 1 + i + (i > 0 ? 1 : 0)).setValue(h);
  });
  // Re-aplica estilo (idempotente)
  sheet.getRange(1, 1, 1, 24).setFontWeight('bold').setBackground('#6c47ff').setFontColor('#ffffff');
}

// ══════════════════════════════════════════════════════════════
// ROTAS: chama initUsers() tambem via setupAdminExtended_()
// (chamar 1x no editor apos deploy)
// ══════════════════════════════════════════════════════════════
function setupUsersExtended_() {
  ensureUsersExtraColumns_();
  return { ok: true, message: 'Colunas extras adicionadas (avatar_url, capa_url, bio, etc). 16 campos novos.' };
}

// ══════════════════════════════════════════════════════════════
// GET / SAVE perfil do proprio usuario logado
// ══════════════════════════════════════════════════════════════

// getMyProfile — retorna dados completos do usuario logado
function getMyProfile(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  ensureUsersExtraColumns_();
  var sheet = getSheet(SHEET_USERS);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(user.id) || String(data[i][2]) === String(user.email)) {
      var obj = _rowToUserObj_(data[i], sheet.getRange(1, 1, 1, data[i].length).getValues()[0]);
      return { ok: true, profile: obj };
    }
  }
  return { ok: false, error: 'Usuario nao encontrado.' };
}

// getUserFull — admin busca perfil de outro usuario
function getUserFull(token, userId) {
  if (!_isAdmin(token)) return { ok: false, error: 'Sem permissao.' };
  ensureUsersExtraColumns_();
  var sheet = getSheet(SHEET_USERS);
  var data = sheet.getDataRange().getValues();
  var headers = sheet.getRange(1, 1, 1, data[0].length).getValues()[0];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(userId)) {
      return { ok: true, profile: _rowToUserObj_(data[i], headers) };
    }
  }
  return { ok: false, error: 'Usuario nao encontrado.' };
}

// updateMyProfile — usuario edita o proprio perfil
function updateMyProfile(token, updates) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  if (!updates || typeof updates !== 'object') return { ok: false, error: 'Updates invalidos.' };
  return _updateUserFields_(token, user.id, updates, /* selfEdit */ true);
}

// updateUserFull (admin) — admin edita qualquer usuario (incluindo email)
function updateUserFull(token, userId, updates) {
  if (!_isAdmin(token)) return { ok: false, error: 'Sem permissao.' };
  if (!updates || typeof updates !== 'object') return { ok: false, error: 'Updates invalidos.' };
  return _updateUserFields_(token, userId, updates, /* selfEdit */ false);
}

// Apply fields comuns a self e admin
function _updateUserFields_(token, userId, updates, selfEdit) {
  try {
    ensureUsersExtraColumns_();
    var sheet = getSheet(SHEET_USERS);
    var data = sheet.getDataRange().getValues();
    var headers = sheet.getRange(1, 1, 1, data[0].length).getValues()[0];

    // Mapa header -> coluna (1-based)
    var colByHeader = {};
    headers.forEach(function(h, i) { colByHeader[h] = i + 1; });

    var targetRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(userId)) { targetRow = i + 1; break; }
    }
    if (targetRow < 0) return { ok: false, error: 'Usuario nao encontrado.' };

    // Campos permitidos para self (lista restrita)
    var SELF_FIELDS = {
      'avatar_url':1,'capa_url':1,'bio':1,'primeiro_nome':1,'sobrenome':1,
      'apelido':1,'cargo':1,'departamento':1,'telefone':1,'whatsapp':1
    };
    // Admin pode mudar tudo + name + email
    var ADMIN_FIELDS = Object.assign({}, SELF_FIELDS, { 'name': 1, 'email': 1, 'role': 1, 'active': 1 });

    var allowed = selfEdit ? SELF_FIELDS : ADMIN_FIELDS;
    var updatedCount = 0;
    var logDetails = [];

    Object.keys(updates).forEach(function(key) {
      if (!allowed[key]) return;
      var col = colByHeader[key];
      if (!col) return;
      // Validacao de email
      if (key === 'email') {
        var email = String(updates[key] || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw new Error('Email invalido.');
        }
      }
      sheet.getRange(targetRow, col).setValue(String(updates[key] || ''));
      updatedCount++;
      logDetails.push(key + '=' + String(updates[key]).slice(0, 30));
    });

    // Atualiza timestamp
    var colUpd = colByHeader['atualizado_em'];
    if (colUpd) sheet.getRange(targetRow, colUpd).setValue(nowISO());

    logAction(_getActorEmail_(token), 'PROFILE_UPDATED', 'user', userId, logDetails.join(', '));
    return { ok: true, updated: updatedCount };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// changeMyPassword — usuario troca a propria senha (precisa da senha atual)
function changeMyPassword(token, currentPwd, newPwd) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  if (!currentPwd || !newPwd) return { ok: false, error: 'Senhas nao informadas.' };
  if (newPwd.length < 6) return { ok: false, error: 'Nova senha muito curta (min 6 caracteres).' };

  var sheet = getSheet(SHEET_USERS);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(user.id) || String(data[i][2]) === String(user.email)) {
      // Verifica senha atual
      var chk = verificarSenha_(currentPwd, data[i][3]);
      if (!chk.ok) return { ok: false, error: 'Senha atual incorreta.' };
      // Grava novo hash
      sheet.getRange(i + 1, 4).setValue(hashPassword(newPwd));
      logAction(user.email, 'PASSWORD_CHANGED', 'user', user.id, '');
      return { ok: true };
    }
  }
  return { ok: false, error: 'Usuario nao encontrado.' };
}

// resetUserPassword (admin) — admin reseta senha de outro usuario
function resetUserPassword(token, userId, newPwd) {
  if (!_isAdmin(token)) return { ok: false, error: 'Sem permissao.' };
  if (!newPwd || newPwd.length < 6) return { ok: false, error: 'Nova senha muito curta.' };
  var sheet = getSheet(SHEET_USERS);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(userId)) {
      sheet.getRange(i + 1, 4).setValue(hashPassword(newPwd));
      logAction(_getActorEmail_(token), 'PASSWORD_RESET', 'user', userId, '');
      return { ok: true };
    }
  }
  return { ok: false, error: 'Usuario nao encontrado.' };
}

// ══════════════════════════════════════════════════════════════
// UPLOAD de avatar / capa (base64 -> Drive publico)
// ══════════════════════════════════════════════════════════════

// uploadAvatarBase64 (avatar ou capa) — salva no Drive do projeto e retorna URL publica
function uploadUserAssetBase64(token, fileBase64, fileName, kind) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  if (!fileBase64) return { ok: false, error: 'fileBase64 obrigatorio.' };
  if (kind !== 'avatar' && kind !== 'capa') return { ok: false, error: 'kind deve ser avatar ou capa.' };
  if (!_isAdmin(token) && user.role !== 'admin') {
    // self OK; admin pode fazer pra qualquer um (sem checagem de userId por enquanto)
  }
  try {
    var folder = _getOrCreateFolder_(kind === 'avatar' ? 'avatars' : 'capas');
    var blob = Utilities.newBlob(
      Utilities.base64Decode(fileBase64),
      kind === 'avatar' ? 'image/png' : 'image/jpeg',
      fileName
    );
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var url = 'https://drive.google.com/uc?export=view&id=' + file.getId();
    return { ok: true, url: url, fileId: file.getId(), kind: kind };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function _getOrCreateFolder_(name) {
  var folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(name);
}

// ══════════════════════════════════════════════════════════════
// Helpers compartilhados
// ══════════════════════════════════════════════════════════════

function _isAdmin(token) {
  var u = getUserByToken(token);
  return !!(u && u.role === 'admin');
}

function _getActorEmail_(token) {
  var u = getUserByToken(token);
  return u ? u.email : '';
}

function _rowToUserObj_(row, headers) {
  var obj = {};
  for (var i = 0; i < headers.length; i++) {
    if (headers[i]) obj[String(headers[i])] = row[i];
  }
  // Garantir defaults
  if (!obj.avatar_url) obj.avatar_url = '';
  if (!obj.capa_url)   obj.capa_url = '';
  return obj;
}

// Sobrescrever createUser (em auth.gs) para incluir avatar_url/capa_url opcional.
// Nota: GAS nao permite redeclarar funcoes; portanto o createUser original
// ainda funciona, e este novo helper cuida de criar com extras.
function createUserExtended(token, userData) {
  if (!_isAdmin(token)) return { ok: false, error: 'Sem permissao.' };
  ensureUsersExtraColumns_();
  var sheet = getSheet(SHEET_USERS);
  var id = generateId();
  sheet.appendRow([
    id,
    userData.name || '',
    userData.email || '',
    hashPassword(userData.password || ''),
    userData.role || 'aluno',
    '',                 // token
    userData.active !== false,
    nowISO(),
    userData.avatar_url || '',  // I
    userData.capa_url || '',    // J
    userData.bio || '',         // K
    userData.primeiro_nome || '',
    userData.sobrenome || '',
    userData.apelido || '',
    userData.cargo || '',
    userData.departamento || '',
    userData.telefone || '',
    userData.whatsapp || ''
  ]);
  logAction(_getActorEmail_(token), 'USER_CREATED', 'user', id, userData.email);
  return { ok: true, id: id };
}

// ══════════════════════════════════════════════════════════════
// Log de acesso (chamado pelo rpc quando detecta login/sessao)
// ══════════════════════════════════════════════════════════════
function logUserAccess(token, ip) {
  var user = getUserByToken(token);
  if (!user) return { ok: false };
  try {
    var sheet = getSheet(SHEET_USERS);
    var data = sheet.getDataRange().getValues();
    var headers = sheet.getRange(1, 1, 1, data[0].length).getValues()[0];
    var colByH = {};
    headers.forEach(function(h, i) { colByH[h] = i + 1; });
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(user.id) || String(data[i][2]) === String(user.email)) {
        if (colByH['ultimo_login']) sheet.getRange(i + 1, colByH['ultimo_login']).setValue(nowISO());
        if (colByH['ultimo_ip']) sheet.getRange(i + 1, colByH['ultimo_ip']).setValue(String(ip || '').slice(0, 45));
        return { ok: true };
      }
    }
    return { ok: false };
  } catch (e) {
    return { ok: false };
  }
}