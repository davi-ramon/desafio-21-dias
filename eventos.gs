// ============================================================
// eventos.gs — Sistema de Eventos WPK Tavares
// CRUD de eventos para a landing page template
// ============================================================

const SHEET_EVENTOS = 'eventos';

// Cabeçalhos da planilha de eventos
const EVENTO_HEADERS = [
  'id','slug','status','nome_evento','subtitulo','historia',
  'foto_capa','fotos_json','video_url',
  'preco_virtual','preco_presencial',
  'link_virtual','link_presencial',
  'texto_btn_virtual','texto_btn_presencial',
  'data_evento','horario','local','nome_palestrante',
  'og_title','og_desc','og_image','contato','created_at','updated_at'
];

// ── Init planilha ─────────────────────────────────────────────
function initEventosSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(SHEET_EVENTOS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_EVENTOS);
    sh.appendRow(EVENTO_HEADERS);
    sh.getRange(1, 1, 1, EVENTO_HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#4caf50')
      .setFontColor('#ffffff');
    sh.setFrozenRows(1);
    Logger.log('[Eventos] Planilha "eventos" criada.');
  }
  return sh;
}

// ── Público — sem autenticação ────────────────────────────────
function getEventoBySlug(slug) {
  if (!slug) return { ok: false, error: 'Slug obrigatório.' };
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(SHEET_EVENTOS);
  if (!sh) return { ok: false, error: 'Módulo de eventos não inicializado.' };

  const data    = sh.getDataRange().getValues();
  const headers = data[0].map(function(h) { return String(h); });
  const slugIdx   = headers.indexOf('slug');
  const statusIdx = headers.indexOf('status');

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][slugIdx]) === String(slug) &&
        String(data[i][statusIdx]) !== 'inativo') {
      var obj = {};
      headers.forEach(function(h, j) { obj[h] = data[i][j]; });
      try { obj.fotos = JSON.parse(obj.fotos_json || '[]'); } catch(e) { obj.fotos = []; }
      return { ok: true, evento: obj };
    }
  }
  return { ok: false, error: 'Evento não encontrado ou inativo.' };
}

// Lista eventos ativos (qualquer usuário autenticado — para a aba comunidade)
function getEventosAtivos(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(SHEET_EVENTOS);
  if (!sh) return { ok: true, data: [] };
  var rows = sheetToObjects(sh);
  var ativos = rows.filter(function(r) { return String(r.status) !== 'inativo'; });
  ativos.forEach(function(r) {
    try { r.fotos = JSON.parse(r.fotos_json || '[]'); } catch(e) { r.fotos = []; }
    // Remove fotos_json from public response
    delete r.fotos_json;
  });
  return { ok: true, data: ativos.reverse() };
}

// Lista todos os eventos (admin)
function getEventos(token) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(SHEET_EVENTOS);
  if (!sh) return { ok: true, data: [] };
  var rows = sheetToObjects(sh);
  rows.forEach(function(r) {
    try { r.fotos = JSON.parse(r.fotos_json || '[]'); } catch(e) { r.fotos = []; }
  });
  return { ok: true, data: rows.reverse() };
}

// Criar evento
function createEvento(token, data) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  if (!data.slug)        return { ok: false, error: 'Slug é obrigatório.' };
  if (!data.nome_evento) return { ok: false, error: 'Nome do evento é obrigatório.' };

  // Verifica slug duplicado
  var sh = initEventosSheet_();
  var existing = sh.getDataRange().getValues();
  var headers  = existing[0].map(function(h) { return String(h); });
  var slugIdx  = headers.indexOf('slug');
  for (var i = 1; i < existing.length; i++) {
    if (String(existing[i][slugIdx]) === String(data.slug)) {
      return { ok: false, error: 'Slug já existe. Use outro identificador único.' };
    }
  }

  var id  = generateId();
  var now = nowISO();
  sh.appendRow([
    id,
    data.slug,
    data.status || 'ativo',
    data.nome_evento || '',
    data.subtitulo || '',
    data.historia || '',
    data.foto_capa || '',
    JSON.stringify(data.fotos || []),
    data.video_url || '',
    data.preco_virtual || '',
    data.preco_presencial || '',
    data.link_virtual || '',
    data.link_presencial || '',
    data.texto_btn_virtual || 'Comprar Ingresso Virtual',
    data.texto_btn_presencial || 'Comprar Ingresso Presencial',
    data.data_evento || '',
    data.horario || '',
    data.local || '',
    data.nome_palestrante || '',
    data.og_title || data.nome_evento || '',
    data.og_desc  || data.subtitulo  || '',
    data.og_image || data.foto_capa  || '',
    data.contato  || '',
    now, now
  ]);

  logAction(user.email, 'CREATE_EVENTO', 'evento', id, data.nome_evento);
  return { ok: true, id: id };
}

// Atualizar evento
function updateEvento(token, id, updates) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };

  var sh   = getSpreadsheet_().getSheetByName(SHEET_EVENTOS);
  if (!sh) return { ok: false, error: 'Planilha não encontrada.' };

  var data    = sh.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h); });
  var idIdx   = headers.indexOf('id');

  var editableFields = [
    'slug','status','nome_evento','subtitulo','historia','foto_capa',
    'video_url','preco_virtual','preco_presencial','link_virtual','link_presencial',
    'texto_btn_virtual','texto_btn_presencial','data_evento','horario','local',
    'nome_palestrante','og_title','og_desc','og_image','contato'
  ];

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(id)) {
      editableFields.forEach(function(field) {
        if (updates[field] !== undefined) {
          var colIdx = headers.indexOf(field);
          if (colIdx >= 0) sh.getRange(i + 1, colIdx + 1).setValue(updates[field]);
        }
      });
      if (updates.fotos !== undefined) {
        var fotosIdx = headers.indexOf('fotos_json');
        if (fotosIdx >= 0) sh.getRange(i + 1, fotosIdx + 1).setValue(JSON.stringify(updates.fotos));
      }
      var updIdx = headers.indexOf('updated_at');
      if (updIdx >= 0) sh.getRange(i + 1, updIdx + 1).setValue(nowISO());
      logAction(user.email, 'UPDATE_EVENTO', 'evento', id, '');
      return { ok: true };
    }
  }
  return { ok: false, error: 'Evento não encontrado.' };
}

// Deletar evento
function deleteEvento(token, id) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  var sh = getSpreadsheet_().getSheetByName(SHEET_EVENTOS);
  if (!sh) return { ok: false, error: 'Planilha não encontrada.' };
  var data  = sh.getDataRange().getValues();
  var idIdx = data[0].map(function(h) { return String(h); }).indexOf('id');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(id)) {
      sh.deleteRow(i + 1);
      logAction(user.email, 'DELETE_EVENTO', 'evento', id, '');
      return { ok: true };
    }
  }
  return { ok: false, error: 'Evento não encontrado.' };
}

// ── Rastreamento de visitantes das landing pages ───────────────
var SHEET_TRACKING = 'page_tracking';
var TRACKING_HEADERS = [
  'visitor_id','user_agent','device','page','page_url',
  'first_seen','last_seen',
  'page_view','scroll_50','scroll_75',
  'gallery_view','gallery_swipe','ticket_interact',
  'bia_open','purchase_presencial','purchase_virtual'
];

function initTrackingSheet_() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(SHEET_TRACKING);
  if (!sh) {
    sh = ss.insertSheet(SHEET_TRACKING);
    sh.appendRow(TRACKING_HEADERS);
    sh.getRange(1, 1, 1, TRACKING_HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#1565c0')
      .setFontColor('#ffffff');
    sh.setFrozenRows(1);
    Logger.log('[Tracking] Planilha "page_tracking" criada.');
  }
  return sh;
}

// NOTA: trackPageEvent() foi movida para evento_fabio_tracking_snippet.gs,
// que implementa roteamento por página (evento-fabio → aba própria,
// demais páginas → trackPageEventDefault_ → 'page_tracking').
// initTrackingSheet_(), SHEET_TRACKING e TRACKING_HEADERS permanecem
// aqui pois são usados pelo snippet como helpers de fallback.

// Init planilha via painel (admin)
function initEventosAction(token) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  initEventosSheet_();
  return { ok: true, msg: 'Planilha "eventos" inicializada.' };
}
