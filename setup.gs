// ============================================================
// setup.gs — Autorização Manual + Utilitários de Setup
// ============================================================
// IMPORTANTE: Execute autorizarPermissoesDoSistema() no Editor
// do Apps Script ANTES de fazer o deploy/republish do Web App.
// Isso força o Google a abrir a janela de autorização e libera
// todos os escopos listados em appsscript.json.
// ============================================================

const SHEET_RESET_CODES = 'password_reset';

// ── Autorização manual — execute uma vez antes do deploy ─────
function autorizarPermissoesDoSistema() {
  const log = [];

  // 1. Drive
  try {
    const folder = DriveApp.getRootFolder();
    log.push('✅ DriveApp — pasta raiz acessível: "' + folder.getName() + '"');
  } catch(e) {
    log.push('❌ DriveApp — ' + e.message);
  }

  // 2. Spreadsheet
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    log.push('✅ SpreadsheetApp — planilha: "' + ss.getName() + '"');
  } catch(e) {
    log.push('❌ SpreadsheetApp — ' + e.message);
  }

  // 3. HTTP externo
  try {
    const resp = UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
    log.push('✅ UrlFetchApp — HTTP ' + resp.getResponseCode());
  } catch(e) {
    log.push('❌ UrlFetchApp — ' + e.message);
  }

  // 4. E-mail
  try {
    const quota = MailApp.getRemainingDailyQuota();
    log.push('✅ MailApp — quota diária restante: ' + quota + ' e-mails');
  } catch(e) {
    log.push('❌ MailApp — ' + e.message);
  }

  // 5. Sessão / identidade
  try {
    const email = Session.getActiveUser().getEmail();
    log.push('✅ Session — usuário autenticado: ' + (email || '(anônimo)'));
  } catch(e) {
    log.push('❌ Session — ' + e.message);
  }

  // 6. Init aba de reset de senha
  try {
    initPasswordResetSheet_();
    log.push('✅ Aba "password_reset" inicializada');
  } catch(e) {
    log.push('❌ Aba password_reset — ' + e.message);
  }

  const result = '=== Autorização de Permissões ===\n' + log.join('\n');
  Logger.log(result);
  console.log(result);
  return result;
}

// ── Init aba de reset de senha ────────────────────────────────
function initPasswordResetSheet_() {
  const ss    = getSpreadsheet_();
  let sheet   = ss.getSheetByName(SHEET_RESET_CODES);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_RESET_CODES);
    sheet.appendRow(['id', 'email', 'code', 'expires_at', 'used', 'created_at']);
    sheet.getRange(1, 1, 1, 6)
      .setFontWeight('bold')
      .setBackground('#6c47ff')
      .setFontColor('#ffffff');
    Logger.log('[setup] Aba "password_reset" criada.');
  }
  return sheet;
}
