// ============================================================
// CRM WPK TAVARES — Code.gs (Entry Point)
// Versão: 4.0 — + Cakto webhook detection + Config sheet init
// ============================================================
// DIFERENÇA EM RELAÇÃO À V3:
//   doPost() agora detecta payloads da Cakto (sem action/token)
//   e roteia para processWebhookCakto_() em automation.gs
//   initSheets() agora também inicializa a aba 'config'
// ============================================================

const SPREADSHEET_ID = '1KLn6C4LRW0GGTYVZnxYRrEaTQjPfxVfmAG9r3-ixhOU';
const SHEET_CRM      = 'CRM';
const SHEET_TASKS    = 'tasks_managment';
const SHEET_CONTACTS = 'contacts';
const SHEET_USERS    = 'users';
const SHEET_LOG      = 'log';

var _SS_ = null;
function getSpreadsheet_() {
  if (!_SS_) _SS_ = SpreadsheetApp.openById(SPREADSHEET_ID);
  return _SS_;
}

// ── Web App Entry Point (GET) ────────────────────────────────
function doGet(e) {
  var page  = e.parameter.page  || 'login';
  var token = e.parameter.token || '';

  // Carrega workspace config para injetar em todos os templates
  var ws = { nome: 'WPK Tavares', subtitulo: 'Desafio 21 Dias',
             logoUrl: 'https://i.imgur.com/bOf9i1R.png',
             logoCompact: 'https://i.imgur.com/bOf9i1R.png',
             faviconUrl: 'https://i.imgur.com/bOf9i1R.png',
             ogImage: 'https://i.imgur.com/Xe5iaZ1.gif' };
  try { ws = getWorkspaceConfig(); } catch(ex) {}

  if (page === 'login') {
    var loginTmpl = HtmlService.createTemplateFromFile('login');
    loginTmpl.wsNome      = ws.nome;
    loginTmpl.wsSubtitulo = ws.subtitulo;
    loginTmpl.wsLogoUrl   = ws.logoUrl;
    loginTmpl.wsFavicon   = ws.faviconUrl;
    return loginTmpl.evaluate()
      .setTitle(ws.nome + ' — Login')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  var user = getUserByToken(token);
  if (!user) {
    var loginTmpl2 = HtmlService.createTemplateFromFile('login');
    loginTmpl2.wsNome      = ws.nome;
    loginTmpl2.wsSubtitulo = ws.subtitulo;
    loginTmpl2.wsLogoUrl   = ws.logoUrl;
    loginTmpl2.wsFavicon   = ws.faviconUrl;
    return loginTmpl2.evaluate()
      .setTitle(ws.nome + ' — Login')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // Roteamento por role: aluno → aluno.html | admin/user → index.html
  if (user.role === 'aluno') {
    var alunoTmpl = HtmlService.createTemplateFromFile('aluno');
    alunoTmpl.userEmail   = user.email;
    alunoTmpl.userName    = user.name;
    alunoTmpl.userRole    = user.role;
    alunoTmpl.token       = token;
    alunoTmpl.wsNome      = ws.nome;
    alunoTmpl.wsSubtitulo = ws.subtitulo;
    alunoTmpl.wsLogoUrl   = ws.logoUrl;
    alunoTmpl.wsFavicon   = ws.faviconUrl;
    alunoTmpl.scriptUrl   = ScriptApp.getService().getUrl();
    return alunoTmpl.evaluate()
      .setTitle(ws.nome + ' — Desafio 21 Dias')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  var tmpl = HtmlService.createTemplateFromFile('index');
  tmpl.userEmail   = user.email;
  tmpl.userName    = user.name;
  tmpl.userRole    = user.role;
  tmpl.token       = token;
  tmpl.wsNome      = ws.nome;
  tmpl.wsSubtitulo = ws.subtitulo;
  tmpl.wsLogoUrl   = ws.logoUrl;
  tmpl.wsFavicon   = ws.faviconUrl;
  tmpl.scriptUrl   = ScriptApp.getService().getUrl();
  return tmpl.evaluate()
    .setTitle(ws.nome + ' — CRM')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ── REST API (POST) ──────────────────────────────────────────
// PATCH v4: detecta payload da Cakto antes de processar como CRM action
function doPost(e) {
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  try {
    var payload = JSON.parse(e.postData.contents);

    // ── Cakto webhook ────────────────────────────────────────
    // Payload da Cakto não tem 'action' nem 'token'.
    // Tem transaction_id, order_id ou event_type com valor de compra.
    if (
      payload.transaction_id ||
      payload.order_id       ||
      (payload.event_type && String(payload.event_type).toLowerCase().includes('purchase'))
    ) {
      return processWebhookCakto_(payload);
    }

    // ── Meta lead webhook (sem token) ────────────────────────
    if (payload.action === 'meta_lead') {
      output.setContent(JSON.stringify(receiveMetaLead(payload.data)));
    }
    // ── Ações públicas (sem token obrigatório) ────────────────
    // login:                 gera o token — não pode exigi-lo
    // reaberturaAccess:      verifica comprador e cria/reseta acesso
    // sendPasswordReset:     envia código de recuperação
    // verifyAndResetPassword: valida código e redefine senha
    // trackPageEvent:        rastreamento de visitantes (landing pages)
    // getEventoBySlug:       leitura pública de evento
    else if (
      payload.action === 'login'                  ||
      payload.action === 'reaberturaAccess'       ||
      payload.action === 'sendPasswordReset'      ||
      payload.action === 'verifyAndResetPassword' ||
      payload.action === 'trackPageEvent'         ||
      payload.action === 'getEventoBySlug'
    ) {
      output.setContent(JSON.stringify(handleRequest(payload)));
    }
    // ── CRM actions (autenticadas por token) ─────────────────
    else if (payload.action && payload.token) {
      output.setContent(JSON.stringify(handleRequest(payload)));
    }
    else {
      output.setContent(JSON.stringify({ ok: false, error: 'Acao ou token ausente.' }));
    }
  } catch (err) {
    output.setContent(JSON.stringify({ ok: false, error: err.message }));
  }
  return output;
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ── Sheet Helpers ────────────────────────────────────────────
function getSheet(name) {
  var ss    = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function sheetToObjects(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0].map(function(h) { return String(h); });
  return data.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) {
      var v = row[i];
      if (v instanceof Date)                  obj[h] = v.toISOString();
      else if (v === null || v === undefined)  obj[h] = '';
      else if (typeof v === 'boolean')         obj[h] = v;
      else if (typeof v === 'number')          obj[h] = String(v);
      else                                     obj[h] = v;
    });
    return obj;
  });
}

function generateId() { return Utilities.getUuid(); }
function nowISO()     { return new Date().toISOString(); }

function invalidateLeadsCache_() {
  try { CacheService.getScriptCache().removeAll(['leads_lite']); } catch(e) {}
}

// ── Init Sheets ──────────────────────────────────────────────
function initSheets() {
  initCRM();
  initContacts();
  initUsers();
  initLog();
  initTasks();
  initConfigSheet_();          // aba config (chave/valor)
  initCompradoresSheet_();     // aba compradores
  initWorkspaceConfigDefaults_(); // workspace logo/nome
  ensureAudio21Sheet_();       // audio_21_dias
  initNotificacoesSheet_();    // notificacoes para alunos
  return { ok: true };
}

function initCRM() {
  var sheet = getSheet(SHEET_CRM);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['id','name','email','phone','form_answers','status','created_at','updated_at','assigned_user','custom_fields','timeline']);
    sheet.getRange(1,1,1,11).setFontWeight('bold').setBackground('#6c47ff').setFontColor('#ffffff');
  }
}

function initContacts() {
  var sheet = getSheet(SHEET_CONTACTS);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['id','name','email','phone','company','tags','notes','created_at']);
    sheet.getRange(1,1,1,8).setFontWeight('bold').setBackground('#6c47ff').setFontColor('#ffffff');
  }
}

function initUsers() {
  var sheet = getSheet(SHEET_USERS);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['id','name','email','password_hash','role','token','active','created_at']);
    sheet.getRange(1,1,1,8).setFontWeight('bold').setBackground('#6c47ff').setFontColor('#ffffff');
    sheet.appendRow([generateId(),'Admin','admin@wpktavares.com',hashPassword('admin123'),'admin','',true,nowISO()]);
  }
}

function initLog() {
  var sheet = getSheet(SHEET_LOG);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['id','user_email','action','entity','entity_id','details','timestamp']);
    sheet.getRange(1,1,1,7).setFontWeight('bold').setBackground('#6c47ff').setFontColor('#ffffff');
  }
}

function initTasks() {
  var sheet = getSheet(SHEET_TASKS);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['id','title','description','assigned_to','lead_id','status','due_date','created_at']);
    sheet.getRange(1,1,1,8).setFontWeight('bold').setBackground('#6c47ff').setFontColor('#ffffff');
  }
}