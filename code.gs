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

// ── Dedup de webhook (a Cakto reenvia o mesmo evento em cold-start) ──
// Usa LockService p/ serializar + CacheService p/ lembrar eventos já vistos.
// Retorna true se ESTE evento (event+id) já foi processado nas últimas 6h.
function _dedupWebhook_(event, id) {
  if (!event || !id) return false;
  var key = 'wh_' + String(event) + '_' + String(id);
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return false; }
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get(key)) return true;       // já processado → ignora reenvio
    cache.put(key, '1', 21600);            // marca por 6h
    return false;
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ── Parser tolerante da borda HTTP ───────────────────────────
// Integrações legítimas nem sempre enviam application/json puro. Alguns
// clientes mandam formulário URL-encoded ou serializam objetos com aspas
// simples. A normalização acontece somente aqui; autenticação, secret e
// rate-limit continuam sendo aplicados normalmente pelas rotas abaixo.
function _postCitarChaves_(texto) {
  var saida = '';
  var emString = false;
  var escapando = false;
  var i = 0;
  while (i < texto.length) {
    var ch = texto.charAt(i);
    if (emString) {
      saida += ch;
      if (escapando) escapando = false;
      else if (ch === '\\') escapando = true;
      else if (ch === '"') emString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      emString = true; saida += ch; i++; continue;
    }
    if (ch === '{' || ch === ',') {
      saida += ch; i++;
      while (i < texto.length && /\s/.test(texto.charAt(i))) saida += texto.charAt(i++);
      var inicio = i;
      if (/[A-Za-z_$]/.test(texto.charAt(i))) {
        i++;
        while (i < texto.length && /[A-Za-z0-9_$-]/.test(texto.charAt(i))) i++;
        var fimNome = i;
        while (i < texto.length && /\s/.test(texto.charAt(i))) i++;
        if (texto.charAt(i) === ':') {
          saida += '"' + texto.slice(inicio, fimNome) + '"' + texto.slice(fimNome, i + 1);
          i++;
          continue;
        }
        i = inicio;
      }
      continue;
    }
    saida += ch;
    i++;
  }
  return saida;
}

function _postJsonAlternativo_(texto) {
  texto = String(texto == null ? '' : texto).replace(/^\uFEFF/, '').trim();
  if (!texto) return null;

  try {
    var estrito = JSON.parse(texto);
    if (estrito && typeof estrito === 'object') return estrito;
  } catch (_estritoErro) {}

  // Conversão conservadora de strings delimitadas por aspas simples para
  // JSON válido. Não usa eval e não executa conteúdo recebido.
  if ((texto.charAt(0) === '{' || texto.charAt(0) === '[') && texto.indexOf("'") !== -1) {
    var saida = '';
    var emAspasDuplas = false;
    var emAspasSimples = false;
    var escapando = false;
    var valido = true;
    for (var i = 0; i < texto.length; i++) {
      var ch = texto.charAt(i);
      if (emAspasDuplas) {
        saida += ch;
        if (escapando) escapando = false;
        else if (ch === '\\') escapando = true;
        else if (ch === '"') emAspasDuplas = false;
        continue;
      }
      if (emAspasSimples) {
        if (escapando) {
          if (ch === "'") saida += "'";
          else if (ch === '"') saida += '\\"';
          else if ('\\/bfnrtu'.indexOf(ch) !== -1) saida += '\\' + ch;
          else { valido = false; break; }
          escapando = false;
        } else if (ch === '\\') {
          escapando = true;
        } else if (ch === "'") {
          saida += '"'; emAspasSimples = false;
        } else if (ch === '"') {
          saida += '\\"';
        } else if (ch === '\n') {
          saida += '\\n';
        } else if (ch === '\r') {
          saida += '\\r';
        } else {
          saida += ch;
        }
        continue;
      }
      if (ch === '"') { emAspasDuplas = true; saida += ch; }
      else if (ch === "'") { emAspasSimples = true; saida += '"'; }
      else saida += ch;
    }
    if (escapando || emAspasSimples || emAspasDuplas) valido = false;
    if (valido) {
      try {
        var alternativo = JSON.parse(_postCitarChaves_(saida));
        if (alternativo && typeof alternativo === 'object') return alternativo;
      } catch (_alternativoErro) {}
    }
  }

  // Também cobre objetos serializados como {action:"..."}, sem executar JS.
  if (texto.charAt(0) === '{' || texto.charAt(0) === '[') {
    var comChavesCitadas = _postCitarChaves_(texto);
    if (comChavesCitadas !== texto) {
      try {
        var semAspasNasChaves = JSON.parse(comChavesCitadas);
        if (semAspasNasChaves && typeof semAspasNasChaves === 'object') return semAspasNasChaves;
      } catch (_chavesErro) {}
    }
  }
  return null;
}

function _postDecodificar_(valor) {
  valor = String(valor == null ? '' : valor).replace(/\+/g, ' ');
  try { return decodeURIComponent(valor); } catch (_e) { return valor; }
}

function _postFormulario_(texto) {
  texto = String(texto || '').trim();
  if (!texto || texto.indexOf('=') < 1) return null;
  var obj = {};
  texto.split('&').forEach(function(par) {
    if (!par) return;
    var pos = par.indexOf('=');
    var chave = _postDecodificar_(pos < 0 ? par : par.slice(0, pos));
    if (!chave || Object.prototype.hasOwnProperty.call(obj, chave)) return;
    obj[chave] = _postDecodificar_(pos < 0 ? '' : par.slice(pos + 1));
  });
  var chaves = Object.keys(obj);
  if (!chaves.length) return null;

  // payload/json/body costumam encapsular o objeto inteiro.
  for (var i = 0; i < ['payload','json','body'].length; i++) {
    var nome = ['payload','json','body'][i];
    if (!obj[nome]) continue;
    var inteiro = _postJsonAlternativo_(obj[nome]);
    if (inteiro && chaves.length === 1) return inteiro;
    if (inteiro) obj[nome] = inteiro;
  }
  // Em RPCs do app, data é um campo aninhado e deve voltar a ser objeto.
  if (typeof obj.data === 'string') {
    var dataObj = _postJsonAlternativo_(obj.data);
    if (dataObj) obj.data = dataObj;
  }
  return obj;
}

function _parsePostPayload_(e) {
  var conteudo = e && e.postData ? String(e.postData.contents || '') : '';
  var limpo = conteudo.replace(/^\uFEFF/, '').trim();
  var valor = _postJsonAlternativo_(limpo);
  var formato = valor ? 'json' : '';

  if (!valor) {
    valor = _postFormulario_(limpo);
    if (valor) formato = 'form';
  }

  // Apps Script já decodifica formulários em e.parameter. Usa esse caminho
  // apenas quando o corpo bruto não pôde ser interpretado.
  if (!valor && e && e.parameter && Object.keys(e.parameter).length) {
    var pares = [];
    Object.keys(e.parameter).forEach(function(k) {
      pares.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(e.parameter[k] || '')));
    });
    valor = _postFormulario_(pares.join('&'));
    if (valor) formato = 'parameter';
  }

  if (!valor || typeof valor !== 'object') {
    return { ok: false, error: 'Corpo POST inválido.', code: 'INVALID_POST_BODY' };
  }
  return { ok: true, value: valor, format: formato };
}

// ── REST API (POST) ──────────────────────────────────────────
// PATCH v6: detecta Cakto nos dois formatos reais observados em produção
function doPost(e) {
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  try {
    var parsed = _parsePostPayload_(e);
    if (!parsed.ok) {
      var tipo = e && e.postData ? String(e.postData.type || '') : '';
      var tamanho = e && e.postData ? Number(e.postData.length || String(e.postData.contents || '').length || 0) : 0;
      Logger.log('[doPost] entrada rejeitada: tipo=' + tipo + ' bytes=' + tamanho + ' codigo=' + parsed.code);
      output.setContent(JSON.stringify({ ok: false, error: parsed.error, code: parsed.code }));
      return output;
    }
    var raw = parsed.value;

    // ── Telegram webhook (comandos do bot) ───────────────────
    if (raw && raw.update_id && (raw.message || raw.edited_message)) {
      return tgProcessarUpdate_(raw);
    }

    // ── Stripe webhook (evento de assinatura) ────────────────
    // Autenticado por re-fetch do evento na API (GAS não expõe headers).
    if (raw && raw.object === 'event' && raw.type && raw.id) {
      return processStripeEvent_(raw);
    }

    // ── Cakto webhook formato PLANO (produção real) ──────────
    // Formato real: { event, secret, data:{ id, customer, product, subscription?,… } }
    if (raw && !Array.isArray(raw) && raw.data && raw.data.id && raw.event) {
      // BLINDAGEM: valida o secret antes de processar (anti-fraude)
      var _sec = _validarCaktoSecret_(raw.secret);
      if (!_sec.ok) return _rejeitarWebhook_(raw.event, _sec.motivo);
      // dedup: ignora reenvios do mesmo evento (Cakto reenvia em cold-start)
      if (_dedupWebhook_(raw.event, raw.data.id)) {
        output.setContent(JSON.stringify({ ok: true, dedup: true }));
        return output;
      }
      var pName = String((raw.data.product && raw.data.product.name) || '');
      // Ingresso do Seminário
      if (isEventoFabioLuiz_(pName)) {
        return processWebhookCaktoEvento_(raw);
      }
      // Produto de assinatura (tem objeto subscription) → roteia para gestor de assinaturas
      // E também para o handler legado (cria registro em compradores se for 1ª compra)
      if (raw.data.subscription) {
        try { processWebhookCakto_(flattenCaktoV2_(raw.data)); } catch(_e) {}
        return processWebhookAssinatura_(raw);
      }
      return processWebhookCakto_(flattenCaktoV2_(raw.data));
    }

    // ── Cakto webhook formato ARRAY (docs/testes) ───────────
    // Formato alternativo: [{ event, secret, data:{ id,… } }]
    if (Array.isArray(raw) && raw.length > 0 && raw[0].data && raw[0].data.id) {
      var caktoEvt = raw[0];
      // BLINDAGEM: valida o secret antes de processar (anti-fraude)
      var _sec2 = _validarCaktoSecret_(caktoEvt.secret);
      if (!_sec2.ok) return _rejeitarWebhook_(caktoEvt.event, _sec2.motivo);
      // dedup: ignora reenvios do mesmo evento
      if (_dedupWebhook_(caktoEvt.event, caktoEvt.data.id)) {
        output.setContent(JSON.stringify({ ok: true, dedup: true }));
        return output;
      }
      var pName    = String((caktoEvt.data.product && caktoEvt.data.product.name) || '');
      if (isEventoFabioLuiz_(pName)) {
        return processWebhookCaktoEvento_(caktoEvt);
      }
      if (caktoEvt.data.subscription) {
        try { processWebhookCakto_(flattenCaktoV2_(caktoEvt.data)); } catch(_e) {}
        return processWebhookAssinatura_(caktoEvt);
      }
      return processWebhookCakto_(flattenCaktoV2_(caktoEvt.data));
    }

    // ── Cakto webhook v1 legado (campo transaction_id plano) ─
    var payload = raw;
    if (
      payload.transaction_id ||
      payload.order_id       ||
      (payload.event_type && String(payload.event_type).toLowerCase().indexOf('purchase') !== -1)
    ) {
      // BLINDAGEM: rota legada também cria conta de aluno → exige secret válido
      var _sec3 = _validarCaktoSecret_(payload.secret);
      if (!_sec3.ok) return _rejeitarWebhook_('legacy_v1', _sec3.motivo);
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
    // verificarIngresso:     valida UUID do ingresso no check-in (sem auth)
    // registrarTrial:        cadastro de lead no trial gratuito (sem cartão)
    else if (
      payload.action === 'login'                  ||
      payload.action === 'reaberturaAccess'       ||
      payload.action === 'sendPasswordReset'      ||
      payload.action === 'verifyAndResetPassword' ||
      payload.action === 'trackPageEvent'         ||
      payload.action === 'getEventoBySlug'        ||
      payload.action === 'verificarIngresso'      ||
      payload.action === 'registrarTrial'         ||
      payload.action === 'salvarLeadIncompleto'   ||
      payload.action === 'trackVsl'                ||
      payload.action === 'criarCheckoutStripe'     ||
      payload.action === 'diagEmailSample'         ||
      payload.action === 'userExistsPublic'        ||
      payload.action === 'reenviarCredenciais'     ||
      payload.action === 'confirmarCheckoutStripe' ||
      payload.action === 'validarTokenAcesso'      ||
      payload.action === 'definirSenhaComToken'    ||
      payload.action === 'reenviarLinkAcesso'      ||
      // v130 — entrada do painel: são públicas por natureza (ainda não
      // existe sessão neste ponto). Todas passam pelo _gatePublico_.
      payload.action === 'verificar2FA'             ||
      payload.action === 'reenviar2FA'              ||
      payload.action === 'solicitarLinkMagicoAdmin' ||
      payload.action === 'entrarComLinkMagico'      ||
      // v141 — checkout do trial com cartao: publicas por natureza
      payload.action === 'enviarCodigoTrial'        ||
      payload.action === 'verificarCodigoTrial'     ||
      payload.action === 'validarWhatsappTrial'     ||
      payload.action === 'criarCheckoutTrialCartao' ||
      // v151 — atividade real do checkout (leitura publica, sem dado pessoal)
      payload.action === 'getAtividadeReal'         ||
      // v154 — a pagina de obrigado consulta antes de existir sessao;
      // quem manda e o session_id validado na API do Stripe
      payload.action === 'statusTrialCartao'        ||
      // v155 — rodape do e-mail: quem clica ainda nao tem sessao
      payload.action === 'preferenciasEmail'        ||
      // v159 — clique no link de indicacao: acontece antes de qualquer cadastro
      payload.action === 'registrarCliqueIndicacao' ||
      // migracao — so booleanos (nenhum e-mail sai); confere a troca de
      // conta de fora, antes de mexer no endereco de producao
      payload.action === 'getMigracaoStatus'
    ) {
      // BLINDAGEM: rate-limit + honeypot nas rotas públicas
      var _gate = _gatePublico_(payload);
      if (_gate) { output.setContent(JSON.stringify(_gate)); return output; }
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
    try { if (typeof tgEnviarErro_ === 'function') tgEnviarErro_('doPost', err.message); } catch(_t) {}
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
  initCriativosSheet_();       // aba criativos (Meta Ads)
  initUserContentSheet_();     // conteudo privado: meditacao, leitura e audio
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
