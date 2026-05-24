// ============================================================
// LeadsSync.gs — Sincronização: aba "leads" → CRM + Contatos
// Versão: 3.0
// ============================================================

var SHEET_LEADS_SOURCE = 'leads';
var COL_IMPORTED       = 'crm_imported';

var LEADS_COL = {
  id:'id', created_time:'created_time', ad_id:'ad_id', ad_name:'ad_name',
  adset_id:'adset_id', adset_name:'adset_name', campaign_id:'campaign_id',
  campaign_name:'campaign_name', form_id:'form_id', form_name:'form_name',
  is_organic:'is_organic', platform:'platform',
  trava:'o_que_mais_te_trava_hoje?',
  vida_6m:'se_voce_continuar_assim_pelos_proximos_6_meses,_como_estara_sua_vida?',
  plano_21:'voce_esta_disposto_a_seguir_um_plano_diario_simples_por_21_dias?',
  quando:'quando_voce_quer_comecar_a_mudar_isso?',
  nome:'nome_completo', email:'email', telefone:'telefone', lead_status:'lead_status'
};

// Fallback por índice fixo (caso o cabeçalho tenha variação de encoding)
var LEADS_COL_IDX = {
  id:0, created_time:1, ad_id:2, ad_name:3, adset_id:4, adset_name:5,
  campaign_id:6, campaign_name:7, form_id:8, form_name:9, is_organic:10,
  platform:11, trava:12, vida_6m:13, plano_21:14, quando:15,
  nome:16, email:17, telefone:18, lead_status:19
};

// ── Helper: resolve índice de coluna ────────────────────────
function resolveColIdx_(headers, key) {
  var byName = headers.indexOf(LEADS_COL[key]);
  if (byName >= 0) return byName;
  var colLower = LEADS_COL[key].toLowerCase().replace(/[^a-z0-9_]/g, '');
  var byPartial = -1;
  for (var i = 0; i < headers.length; i++) {
    if (headers[i].toLowerCase().replace(/[^a-z0-9_]/g, '') === colLower) {
      byPartial = i; break;
    }
  }
  if (byPartial >= 0) return byPartial;
  return (LEADS_COL_IDX[key] !== undefined) ? LEADS_COL_IDX[key] : -1;
}

// ── Sync principal: aba "leads" → aba CRM ────────────────────
function syncLeadsFromSheet() {
  try {
    var ss         = getSpreadsheet_();
    var leadsSheet = ss.getSheetByName(SHEET_LEADS_SOURCE);
    if (!leadsSheet) {
      logAction('system','SYNC_ERROR','leads','','Aba "leads" nao encontrada.');
      return;
    }

    var crmSheet = getSheet(SHEET_CRM);
    var data     = leadsSheet.getDataRange().getValues();
    if (data.length < 2) return;

    var rawHeaders = data[0];
    var headers    = rawHeaders.map(function(h){ return String(h).trim(); });

    // Garante coluna de controle
    var importedColIdx = -1;
    for (var hi = 0; hi < headers.length; hi++) {
      if (headers[hi].toLowerCase() === COL_IMPORTED.toLowerCase()) {
        importedColIdx = hi; break;
      }
    }
    if (importedColIdx === -1) {
      leadsSheet.getRange(1, headers.length + 1).setValue(COL_IMPORTED);
      importedColIdx = headers.length;
      headers.push(COL_IMPORTED);
    }

    // Pré-resolve índices
    var idx = {};
    Object.keys(LEADS_COL).forEach(function(k) { idx[k] = resolveColIdx_(headers, k); });

    var imported = 0, skipped = 0, errors = 0;

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (row.slice(0,20).join('').trim() === '') continue;

      var alreadyImported = String(row[importedColIdx] || '').toLowerCase().trim();
      if (alreadyImported === 'sim' || alreadyImported === 'true' || alreadyImported === '1') {
        skipped++; continue;
      }

      try {
        var get = function(key) {
          var ci = idx[key];
          if (ci < 0 || ci >= row.length) return '';
          var v = row[ci];
          if (v instanceof Date) return v.toISOString();
          return String(v || '').trim();
        };

        var nome     = get('nome');
        var email    = get('email');
        var telefone = formatPhone(get('telefone'));
        var platform = get('platform') || 'meta';
        var adName   = get('ad_name');
        var campaign = get('campaign_name');
        var adset    = get('adset_name');
        var formName = get('form_name');
        var isOrg    = get('is_organic');
        var sheetId  = get('id') || generateId();

        var createdAt = get('created_time');
        if (!createdAt || createdAt === 'Invalid Date') createdAt = nowISO();

        var formAnswers = JSON.stringify({
          'O que mais te trava hoje?':        get('trava'),
          'Como estara sua vida em 6 meses?': get('vida_6m'),
          'Disposto a seguir plano 21 dias?': get('plano_21'),
          'Quando quer comecar a mudanca?':   get('quando'),
          'Campanha': campaign, 'Anuncio': adName, 'Plataforma': platform
        });

        var customFields = JSON.stringify({
          platform: platform, ad_name: adName, campaign_name: campaign,
          adset_name: adset, form_name: formName, is_organic: isOrg,
          lead_sheet_id: sheetId, source: 'sheet_sync'
        });

        var now    = nowISO();
        var crmId  = generateId();
        var timeline = JSON.stringify([{
          action: 'Lead importado automaticamente da planilha',
          user: 'system_sync', timestamp: now, lead_sheet_id: sheetId
        }]);

        crmSheet.appendRow([crmId, nome, email, telefone, formAnswers,
          'Interessado', createdAt, now, 'auto_sync', customFields, timeline]);

        leadsSheet.getRange(i+1, importedColIdx+1).setValue('sim');
        logAction('system','SYNC_LEAD','lead',crmId, nome + ' | ' + email);
        imported++;

      } catch(rowErr) {
        errors++;
        logAction('system','SYNC_ROW_ERROR','leads',String(i),rowErr.message);
      }
    }

    invalidateLeadsCache_();
    logAction('system','SYNC_COMPLETE','leads','',
      'Importados: ' + imported + ' | Ignorados: ' + skipped + ' | Erros: ' + errors);

  } catch(err) {
    logAction('system','SYNC_EXCEPTION','leads','',err.message);
  }
}

// ── Sync de Contatos: aba "leads" → aba "contacts" ───────────
// Importa nome, email e telefone dos leads para a aba de contatos.
// Evita duplicação por e-mail.
function syncContactsFromLeads(token) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };

  try {
    var ss           = getSpreadsheet_();
    var leadsSheet   = ss.getSheetByName(SHEET_LEADS_SOURCE);
    var contactSheet = getSheet(SHEET_CONTACTS);

    if (!leadsSheet) return { ok: false, error: 'Aba "leads" nao encontrada.' };

    var leadsData   = leadsSheet.getDataRange().getValues();
    if (leadsData.length < 2) return { ok: true, message: 'Sem leads para importar.' };

    var leadsHeaders = leadsData[0].map(function(h){ return String(h).trim(); });

    // Coleta emails ja existentes na aba contacts
    var contactsData   = contactSheet.getDataRange().getValues();
    var existingEmails = {};
    if (contactsData.length > 1) {
      var emailColC = contactsData[0].map(function(h){ return String(h); }).indexOf('email');
      contactsData.slice(1).forEach(function(row) {
        var e = String(row[emailColC] || '').toLowerCase().trim();
        if (e) existingEmails[e] = true;
      });
    }

    // Indices na aba leads
    var idx = {};
    Object.keys(LEADS_COL).forEach(function(k){ idx[k] = resolveColIdx_(leadsHeaders, k); });

    var imported = 0, skipped = 0;

    for (var i = 1; i < leadsData.length; i++) {
      var row = leadsData[i];
      if (row.slice(0,20).join('').trim() === '') continue;

      var get = function(key) {
        var ci = idx[key];
        if (ci < 0 || ci >= row.length) return '';
        var v = row[ci];
        if (v instanceof Date) return v.toISOString();
        return String(v || '').trim();
      };

      var nome    = get('nome');
      var email   = get('email').toLowerCase();
      var tel     = formatPhone(get('telefone'));
      var plat    = get('platform') || 'meta';
      var crAt    = get('created_time');
      if (!crAt || crAt === 'Invalid Date') crAt = nowISO();

      if (!nome && !email) continue;
      if (email && existingEmails[email]) { skipped++; continue; }

      var id = generateId();
      contactSheet.appendRow([id, nome, email, tel, 'WPK Tavares', plat,
        'Importado automaticamente dos leads do formulario', crAt]);

      if (email) existingEmails[email] = true;
      imported++;
    }

    logAction(user.email, 'SYNC_CONTACTS', 'contacts', '',
      'Importados: ' + imported + ' | Ja existentes: ' + skipped);
    return { ok: true, message: 'Contatos importados: ' + imported + ' | Ja existentes: ' + skipped };

  } catch(err) {
    return { ok: false, error: err.message };
  }
}

// ── Trigger: onFormSubmit ────────────────────────────────────
function onLeadFormSubmit(e) {
  Utilities.sleep(4000);
  syncLeadsFromSheet();
}

// ── Formatar telefone → E.164 ────────────────────────────────
function formatPhone(raw) {
  if (!raw) return '';
  var digits = raw.replace(/\D/g,'');
  if (!digits) return '';
  if (digits.startsWith('55') && digits.length >= 12) return '+' + digits;
  if (digits.length === 11 || digits.length === 10) return '+55' + digits;
  if (digits.length >= 12) return '+' + digits;
  return '+55' + digits;
}

// ── getSyncStatus ────────────────────────────────────────────
function getSyncStatus(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  try {
    var ss         = getSpreadsheet_();
    var leadsSheet = ss.getSheetByName(SHEET_LEADS_SOURCE);
    if (!leadsSheet) return { ok: true, data: { sheetFound: false, total: 0, imported: 0, pending: 0 } };

    var data    = leadsSheet.getDataRange().getValues();
    var headers = data[0].map(function(h){ return String(h).trim(); });
    var impIdx  = -1;
    for (var i = 0; i < headers.length; i++) {
      if (headers[i].toLowerCase() === COL_IMPORTED.toLowerCase()) { impIdx = i; break; }
    }

    var total = 0, imported = 0;
    for (var j = 1; j < data.length; j++) {
      var row = data[j];
      if (row.slice(0,20).join('').trim() === '') continue;
      total++;
      var v = impIdx >= 0 ? String(row[impIdx] || '').toLowerCase().trim() : '';
      if (v === 'sim' || v === 'true' || v === '1') imported++;
    }

    // Contagem de contatos
    var contactSheet = getSheet(SHEET_CONTACTS);
    var contactCount = Math.max(0, contactSheet.getLastRow() - 1);

    return { ok: true, data: {
      sheetFound: true, total: total, imported: imported,
      pending: total - imported, contactCount: contactCount, lastCheck: nowISO()
    }};
  } catch(err) {
    return { ok: false, error: err.message };
  }
}

// ── Setup Triggers ───────────────────────────────────────────
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (fn === 'syncLeadsFromSheet' || fn === 'onLeadFormSubmit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncLeadsFromSheet').timeBased().everyMinutes(5).create();
  var ss = getSpreadsheet_();
  ScriptApp.newTrigger('onLeadFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  logAction('system','SETUP_TRIGGERS','system','','Triggers criados: 5min + onFormSubmit');
  return { ok: true, message: 'Triggers configurados: time-driven (5min) + onFormSubmit.' };
}

function removeAllTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t){ ScriptApp.deleteTrigger(t); });
  logAction('system','REMOVE_TRIGGERS','system','','Todos os triggers removidos.');
  return { ok: true, message: 'Todos os triggers removidos.' };
}

function manualSync(token) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao. Requer admin.' };
  syncLeadsFromSheet();
  logAction(user.email,'MANUAL_SYNC','leads','','Sync manual acionado.');
  return { ok: true, message: 'Sincronizacao concluida.' };
}