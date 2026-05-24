// ============================================================
// Leads.gs — Lead / CRM Card Management
// Versão: 3.0 — getLeadsLite + Cache + Date fix
// ============================================================

var STAGES = ['Interessado', 'Qualificado', 'Em Atendimento', 'Proposta Enviada', 'Fechado'];

// ── Campos retornados para o Kanban (payload pequeno = rápido) ─
var KANBAN_FIELDS = ['id','name','email','phone','status','created_at','custom_fields'];

// ── getLeadsLite ─────────────────────────────────────────────
// Retorna apenas os campos necessários para renderizar o Kanban.
// NÃO inclui form_answers nem timeline (que podem ser muito grandes).
// Usa CacheService para evitar releituras desnecessárias da planilha.
function getLeadsLite(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };

  // Tenta cache primeiro (30 segundos)
  var cache    = CacheService.getScriptCache();
  var cached   = null;
  try { cached = cache.get('leads_lite'); } catch(e) {}
  if (cached) {
    try { return { ok: true, data: JSON.parse(cached), cached: true }; } catch(e) {}
  }

  var sheet = getSheet(SHEET_CRM);
  var data  = sheet.getDataRange().getValues();
  if (data.length < 2) return { ok: true, data: [] };

  var headers = data[0].map(function(h) { return String(h); });
  var idxMap  = {};
  KANBAN_FIELDS.forEach(function(k) { idxMap[k] = headers.indexOf(k); });

  var leads = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    // Pula linhas sem ID (linhas vazias)
    var idVal = idxMap['id'] >= 0 ? row[idxMap['id']] : null;
    if (!idVal) continue;

    var obj = {};
    KANBAN_FIELDS.forEach(function(k) {
      var ci = idxMap[k];
      if (ci < 0) { obj[k] = ''; return; }
      var v = row[ci];
      // Todos os campos do Kanban devem ser strings (phone, name, email, etc.)
      if (v instanceof Date)                  obj[k] = v.toISOString();
      else if (v === null || v === undefined)  obj[k] = '';
      else if (typeof v === 'number')          obj[k] = String(v);
      else                                     obj[k] = v;
    });
    leads.push(obj);
  }

  // Armazena em cache (até 100KB por chave)
  try {
    var json = JSON.stringify(leads);
    if (json.length < 90000) cache.put('leads_lite', json, 30);
  } catch(e) {}

  return { ok: true, data: leads };
}

// ── getLead (único, dados completos) ─────────────────────────
// Usado no modal de detalhe do lead — lê só o que precisa.
function getLead(token, leadId) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };

  var sheet   = getSheet(SHEET_CRM);
  var data    = sheet.getDataRange().getValues();
  if (data.length < 2) return { ok: false, error: 'Lead nao encontrado.' };

  var headers = data[0].map(function(h) { return String(h); });
  var idIdx   = headers.indexOf('id');

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(leadId)) {
      var obj = {};
      headers.forEach(function(h, ci) {
        var v = data[i][ci];
        if (v instanceof Date)                  obj[h] = v.toISOString();
        else if (v === null || v === undefined)  obj[h] = '';
        else                                     obj[h] = v;
      });
      return { ok: true, data: obj };
    }
  }
  return { ok: false, error: 'Lead nao encontrado.' };
}

// ── getLeads (compatibilidade — retorna tudo) ────────────────
function getLeads(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  return { ok: true, data: sheetToObjects(getSheet(SHEET_CRM)) };
}

// ── createLead ───────────────────────────────────────────────
function createLead(token, leadData) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };

  var id  = generateId();
  var now = nowISO();
  var timeline = JSON.stringify([{ action: 'Lead criado', user: user.email, timestamp: now }]);

  getSheet(SHEET_CRM).appendRow([
    id,
    leadData.name         || '',
    leadData.email        || '',
    leadData.phone        || '',
    leadData.form_answers || '',
    leadData.status       || STAGES[0],
    now, now,
    leadData.assigned_user || user.email,
    leadData.custom_fields || '{}',
    timeline
  ]);

  invalidateLeadsCache_();
  logAction(user.email, 'CREATE_LEAD', 'lead', id, leadData.name);
  return { ok: true, id: id };
}

// ── updateLead ───────────────────────────────────────────────
function updateLead(token, leadId, updates) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };

  var sheet   = getSheet(SHEET_CRM);
  var data    = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h); });
  var idIdx   = headers.indexOf('id');

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(leadId)) {
      var now = nowISO();
      var fieldMap = { name:'name', email:'email', phone:'phone',
        form_answers:'form_answers', status:'status',
        assigned_user:'assigned_user', custom_fields:'custom_fields' };

      Object.keys(fieldMap).forEach(function(key) {
        if (updates[key] !== undefined) {
          sheet.getRange(i+1, headers.indexOf(fieldMap[key])+1).setValue(updates[key]);
        }
      });
      sheet.getRange(i+1, headers.indexOf('updated_at')+1).setValue(now);

      var tl = [];
      try { tl = JSON.parse(data[i][headers.indexOf('timeline')] || '[]'); } catch(e) {}
      tl.push({ action: 'Atualizado: ' + Object.keys(updates).join(', '),
                user: user.email, timestamp: now });
      sheet.getRange(i+1, headers.indexOf('timeline')+1).setValue(JSON.stringify(tl));

      invalidateLeadsCache_();
      logAction(user.email, 'UPDATE_LEAD', 'lead', leadId, JSON.stringify(updates));
      return { ok: true };
    }
  }
  return { ok: false, error: 'Lead nao encontrado.' };
}

// ── deleteLead ───────────────────────────────────────────────
function deleteLead(token, leadId) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };

  var sheet   = getSheet(SHEET_CRM);
  var data    = sheet.getDataRange().getValues();
  var idIdx   = data[0].map(function(h){ return String(h); }).indexOf('id');

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(leadId)) {
      sheet.deleteRow(i + 1);
      invalidateLeadsCache_();
      logAction(user.email, 'DELETE_LEAD', 'lead', leadId, '');
      return { ok: true };
    }
  }
  return { ok: false, error: 'Lead nao encontrado.' };
}

// ── receiveMetaLead (Webhook) ────────────────────────────────
function receiveMetaLead(data) {
  try {
    var id  = generateId();
    var now = nowISO();
    var formAnswers = JSON.stringify(data.field_data || {});
    var timeline    = JSON.stringify([{ action: 'Lead recebido via Meta Ads', user: 'meta_webhook', timestamp: now }]);

    getSheet(SHEET_CRM).appendRow([
      id,
      data.full_name || data.name || '',
      data.email || '',
      data.phone_number || data.phone || '',
      formAnswers, STAGES[0],
      now, now, 'meta_ads', '{}', timeline
    ]);
    invalidateLeadsCache_();
    logAction('meta_webhook', 'META_LEAD', 'lead', id, data.email || '');
    return { ok: true, id: id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── getDashboardMetrics ──────────────────────────────────────
function getDashboardMetrics(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };

  // Usa getLeadsLite para métricas — mais rápido
  var sheet   = getSheet(SHEET_CRM);
  var data    = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return { ok: true, data: { total: 0, byStage: {}, byDay: {}, conversionRate: 0, stages: STAGES } };
  }

  var headers   = data[0].map(function(h){ return String(h); });
  var statusIdx = headers.indexOf('status');
  var dateIdx   = headers.indexOf('created_at');

  var total = 0;
  var byStage = {};
  STAGES.forEach(function(s) { byStage[s] = 0; });
  var byDay = {};
  var now = new Date();
  var thirtyAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue; // skip empty rows
    total++;
    var status = String(row[statusIdx] || '');
    if (byStage[status] !== undefined) byStage[status]++;

    var rawDate = row[dateIdx];
    var d = (rawDate instanceof Date) ? rawDate : new Date(rawDate);
    if (!isNaN(d) && d >= thirtyAgo) {
      var key = d.toISOString().slice(0,10);
      byDay[key] = (byDay[key] || 0) + 1;
    }
  }

  var conversionRate = total > 0 ? ((byStage['Fechado'] / total) * 100).toFixed(1) : 0;
  return { ok: true, data: { total: total, byStage: byStage, byDay: byDay, conversionRate: conversionRate, stages: STAGES } };
}

// ── Limpar colunas extras da aba CRM ────────────────────────
// A aba CRM pode ter colunas extras (headers da aba leads colados
// acidentalmente). Isso deixa a leitura lenta. Esta função remove
// tudo além das 11 colunas corretas.
function cleanupCRMSheet(token) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };

  try {
    var sheet    = getSheet(SHEET_CRM);
    var totalCols = sheet.getLastColumn();
    var expected  = 11; // id,name,email,phone,form_answers,status,created_at,updated_at,assigned_user,custom_fields,timeline

    if (totalCols <= expected) {
      return { ok: true, message: 'CRM ja possui ' + totalCols + ' colunas. Nenhuma acao necessaria.' };
    }

    // Verifica se headers corretos estao nas primeiras 11 colunas
    var headers = sheet.getRange(1, 1, 1, Math.min(totalCols, 11)).getValues()[0];
    var crmHeaders = ['id','name','email','phone','form_answers','status','created_at','updated_at','assigned_user','custom_fields','timeline'];
    var headersOk = crmHeaders.every(function(h, i) { return String(headers[i]).toLowerCase() === h.toLowerCase(); });

    if (!headersOk) {
      return { ok: false, error: 'Headers das primeiras 11 colunas nao conferem. Verifique manualmente antes de limpar.' };
    }

    // Remove colunas 12 em diante
    var toRemove = totalCols - expected;
    sheet.deleteColumns(expected + 1, toRemove);
    invalidateLeadsCache_();
    logAction(user.email, 'CLEANUP_CRM_SHEET', 'crm', '', toRemove + ' colunas extras removidas.');
    return { ok: true, message: toRemove + ' colunas extras removidas da aba CRM. De ' + totalCols + ' para 11.' };
  } catch(err) {
    return { ok: false, error: err.message };
  }
}