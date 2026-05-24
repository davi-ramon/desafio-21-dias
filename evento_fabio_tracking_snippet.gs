// ============================================================
// SNIPPET — Rastreamento dedicado do evento-fabio
// Objetivo:
// 1. manter o trackPageEvent já roteado pelo code.gs/modules.gs
// 2. gravar os eventos da landing "evento-fabio" em uma aba própria
// 3. preservar o tracking genérico existente para outras páginas
//
// Como usar no Apps Script:
// - cole este bloco no projeto GAS
// - deixe esta definição de trackPageEvent por último, para sobrescrever a atual
// - não precisa mudar doPost() no code.gs, porque ele já aceita action=trackPageEvent
// ============================================================

var SHEET_TRACKING_EVENTO_FABIO = 'tracking_evento_fabio';
var TRACKING_EVENTO_FABIO_HEADERS = [
  'visitor_id',
  'page',
  'page_url',
  'device',
  'user_agent',
  'first_seen',
  'last_seen',
  'last_event_name',
  'last_event_at',
  'page_view',
  'scroll_50',
  'scroll_75',
  'gallery_view',
  'gallery_swipe',
  'ticket_interact',
  'bia_open',
  'purchase_presencial',
  'purchase_virtual'
];

function initEventoFabioTrackingSheet_() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(SHEET_TRACKING_EVENTO_FABIO);
  if (!sh) {
    sh = ss.insertSheet(SHEET_TRACKING_EVENTO_FABIO);
    sh.appendRow(TRACKING_EVENTO_FABIO_HEADERS);
    sh.getRange(1, 1, 1, TRACKING_EVENTO_FABIO_HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#2e7d32')
      .setFontColor('#ffffff');
    sh.setFrozenRows(1);
    Logger.log('[Evento Fabio Tracking] Aba criada: ' + SHEET_TRACKING_EVENTO_FABIO);
  }
  return sh;
}

function trackPageEvent(data) {
  try {
    if (!data || !data.visitor_id || !data.event_name) {
      return { ok: false, error: 'Dados insuficientes.' };
    }

    var page = String(data.page || '').trim().toLowerCase();
    if (page === 'evento-fabio') {
      return trackEventoFabioPageEvent_(data);
    }

    return trackPageEventDefault_(data);
  } catch (e) {
    Logger.log('[trackPageEvent] Erro: ' + e.message);
    return { ok: false, error: e.message };
  }
}

function trackEventoFabioPageEvent_(data) {
  var sh = initEventoFabioTrackingSheet_();
  var rows = sh.getDataRange().getValues();
  var headers = rows[0].map(function(h) { return String(h); });
  var vidIdx = headers.indexOf('visitor_id');
  var now = data.ts || new Date().toISOString();
  var eventName = String(data.event_name || '').trim();
  var rowNum = -1;

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][vidIdx]) === String(data.visitor_id)) {
      rowNum = i + 1;
      break;
    }
  }

  if (rowNum === -1) {
    var newRow = new Array(TRACKING_EVENTO_FABIO_HEADERS.length).fill('');
    TRACKING_EVENTO_FABIO_HEADERS.forEach(function(h, j) {
      if (h === 'visitor_id')         newRow[j] = data.visitor_id;
      else if (h === 'page')          newRow[j] = data.page || 'evento-fabio';
      else if (h === 'page_url')      newRow[j] = data.page_url || '';
      else if (h === 'device')        newRow[j] = data.device || '';
      else if (h === 'user_agent')    newRow[j] = data.user_agent || '';
      else if (h === 'first_seen')    newRow[j] = now;
      else if (h === 'last_seen')     newRow[j] = now;
      else if (h === 'last_event_name') newRow[j] = eventName;
      else if (h === 'last_event_at') newRow[j] = now;
      else if (h === eventName)       newRow[j] = now;
    });
    sh.appendRow(newRow);
    return { ok: true, created: true };
  }

  var lastSeenIdx = headers.indexOf('last_seen');
  var lastEventNameIdx = headers.indexOf('last_event_name');
  var lastEventAtIdx = headers.indexOf('last_event_at');
  var eventIdx = headers.indexOf(eventName);
  var pageIdx = headers.indexOf('page');
  var pageUrlIdx = headers.indexOf('page_url');
  var deviceIdx = headers.indexOf('device');
  var agentIdx = headers.indexOf('user_agent');

  if (pageIdx >= 0 && data.page) sh.getRange(rowNum, pageIdx + 1).setValue(data.page);
  if (pageUrlIdx >= 0 && data.page_url) sh.getRange(rowNum, pageUrlIdx + 1).setValue(data.page_url);
  if (deviceIdx >= 0 && data.device) sh.getRange(rowNum, deviceIdx + 1).setValue(data.device);
  if (agentIdx >= 0 && data.user_agent) sh.getRange(rowNum, agentIdx + 1).setValue(data.user_agent);
  if (lastSeenIdx >= 0) sh.getRange(rowNum, lastSeenIdx + 1).setValue(now);
  if (lastEventNameIdx >= 0) sh.getRange(rowNum, lastEventNameIdx + 1).setValue(eventName);
  if (lastEventAtIdx >= 0) sh.getRange(rowNum, lastEventAtIdx + 1).setValue(now);
  if (eventIdx >= 0 && !rows[rowNum - 1][eventIdx]) {
    sh.getRange(rowNum, eventIdx + 1).setValue(now);
  }

  return { ok: true, updated: true };
}

function trackPageEventDefault_(data) {
  var sh = initTrackingSheet_();
  var rows = sh.getDataRange().getValues();
  var headers = rows[0].map(function(h) { return String(h); });
  var vidIdx = headers.indexOf('visitor_id');
  var now = data.ts || new Date().toISOString();
  var rowNum = -1;

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][vidIdx]) === String(data.visitor_id)) {
      rowNum = i + 1;
      break;
    }
  }

  if (rowNum === -1) {
    var newRow = new Array(TRACKING_HEADERS.length).fill('');
    TRACKING_HEADERS.forEach(function(h, j) {
      if (h === 'visitor_id')         newRow[j] = data.visitor_id;
      else if (h === 'user_agent')    newRow[j] = data.user_agent || '';
      else if (h === 'device')        newRow[j] = data.device || '';
      else if (h === 'page')          newRow[j] = data.page || '';
      else if (h === 'page_url')      newRow[j] = data.page_url || '';
      else if (h === 'first_seen')    newRow[j] = now;
      else if (h === 'last_seen')     newRow[j] = now;
      else if (h === data.event_name) newRow[j] = now;
    });
    sh.appendRow(newRow);
    return { ok: true, created: true };
  }

  var lastIdx = headers.indexOf('last_seen');
  var eventIdx = headers.indexOf(data.event_name);
  if (lastIdx >= 0) sh.getRange(rowNum, lastIdx + 1).setValue(now);
  if (eventIdx >= 0 && !rows[rowNum - 1][eventIdx]) {
    sh.getRange(rowNum, eventIdx + 1).setValue(now);
  }

  return { ok: true, updated: true };
}
