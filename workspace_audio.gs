// ============================================================
// workspace_audio.gs — Configurações de Workspace + Áudios 21 Dias
// Versão: 1.0
// ============================================================

const SHEET_AUDIO21  = 'audio_21_dias';
const SHEET_PIPELINES = 'pipelines_config';

// ══════════════════════════════════════════════════════════════
// WORKSPACE — defaults e helpers
// ══════════════════════════════════════════════════════════════

function getDefaultWorkspaceConfig_() {
  return {
    workspace_nome:          'WPK Tavares',
    workspace_subtitulo:     'Desafio 21 Dias',
    workspace_logo_url:      'https://i.imgur.com/bOf9i1R.png',
    workspace_logo_compact:  'https://i.imgur.com/bOf9i1R.png',
    workspace_favicon_url:   'https://i.imgur.com/bOf9i1R.png',
    workspace_og_image:      'https://i.imgur.com/Xe5iaZ1.gif'
  };
}

// Retorna o workspace config sem exigir token (usado em doGet)
function getWorkspaceConfig() {
  const sheet = getSheet(SHEET_CONFIG);
  const data  = sheet.getDataRange().getValues();
  const cfg   = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) cfg[String(data[i][0])] = data[i][1];
  }
  const defaults = getDefaultWorkspaceConfig_();
  Object.keys(defaults).forEach(k => {
    if (cfg[k] === undefined || cfg[k] === '') cfg[k] = defaults[k];
  });
  return {
    nome:          String(cfg['workspace_nome']         || defaults.workspace_nome),
    subtitulo:     String(cfg['workspace_subtitulo']    || defaults.workspace_subtitulo),
    logoUrl:       String(cfg['workspace_logo_url']     || defaults.workspace_logo_url),
    logoCompact:   String(cfg['workspace_logo_compact'] || defaults.workspace_logo_compact),
    faviconUrl:    String(cfg['workspace_favicon_url']  || defaults.workspace_favicon_url),
    ogImage:       String(cfg['workspace_og_image']     || defaults.workspace_og_image)
  };
}

// Retorna workspace config para o frontend autenticado
function getWorkspaceConfigAuth(token) {
  const user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  return { ok: true, data: getWorkspaceConfig() };
}

// Inicializa defaults de workspace na aba config (chamado de initSheets)
function initWorkspaceConfigDefaults_() {
  const defaults = getDefaultWorkspaceConfig_();
  Object.keys(defaults).forEach(k => {
    const existing = getConfig_(k);
    if (existing === null || existing === undefined || existing === '') {
      setConfig_(k, defaults[k]);
    }
  });
}

// ══════════════════════════════════════════════════════════════
// ÁUDIOS 21 DIAS — Sheet: audio_21_dias
// Colunas: dia | titulo | descricao | audio_url | capa_url |
//          legenda_url | duracao | ativo | ordem
// ══════════════════════════════════════════════════════════════

function initAudio21Sheet_() {
  const ss  = getSpreadsheet_();
  let aba   = ss.getSheetByName(SHEET_AUDIO21);
  if (!aba) {
    aba = ss.insertSheet(SHEET_AUDIO21);
    const headers = ['dia','titulo','descricao','audio_url','capa_url','legenda_url','duracao','ativo','ordem'];
    aba.appendRow(headers);
    aba.getRange(1, 1, 1, headers.length)
       .setFontWeight('bold')
       .setBackground('#0f1412')
       .setFontColor('#4caf50');
    // Pré-preenche 21 linhas vazias
    for (let d = 1; d <= 21; d++) {
      aba.appendRow([d, 'Áudio do Dia ' + d, '', '', '', '', '', true, d]);
    }
  }
  return aba;
}

// Garante que a aba existe; chama-se da initSheets principal
function ensureAudio21Sheet_() {
  const ss  = getSpreadsheet_();
  if (!ss.getSheetByName(SHEET_AUDIO21)) initAudio21Sheet_();
}

// Lê todos os 21 áudios configurados
function getAudios21(token) {
  const user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  ensureAudio21Sheet_();
  const aba   = getSheet(SHEET_AUDIO21);
  const data  = aba.getDataRange().getValues();
  if (data.length < 2) return { ok: true, data: _emptyAudios21_() };

  const headers = data[0].map(h => String(h || ''));
  const audios  = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const obj = {};
    headers.forEach((h, j) => { obj[h] = row[j]; });
    audios.push({
      dia:         Number(obj['dia']       || i),
      titulo:      String(obj['titulo']    || 'Áudio do Dia ' + (obj['dia'] || i)),
      descricao:   String(obj['descricao'] || ''),
      audio_url:   String(obj['audio_url'] || ''),
      capa_url:    String(obj['capa_url']  || ''),
      legenda_url: String(obj['legenda_url'] || ''),
      duracao:     String(obj['duracao']   || ''),
      ativo:       obj['ativo'] !== false && obj['ativo'] !== 'FALSE' && obj['ativo'] !== false,
      ordem:       Number(obj['ordem']     || i)
    });
  }

  // Ordena por dia
  audios.sort((a, b) => a.dia - b.dia);

  // Preenche até 21 entradas caso a planilha esteja incompleta
  const byDia = {};
  audios.forEach(a => { byDia[a.dia] = a; });
  const result = [];
  for (let d = 1; d <= 21; d++) {
    result.push(byDia[d] || { dia: d, titulo: 'Áudio do Dia ' + d, descricao: '', audio_url: '', capa_url: '', legenda_url: '', duracao: '', ativo: true, ordem: d });
  }
  return { ok: true, data: result };
}

// Salva (upsert) um áudio individual
function saveAudio21(token, audioData) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };

  const dia = parseInt(audioData.dia);
  if (!dia || dia < 1 || dia > 21) return { ok: false, error: 'Dia inválido (1-21).' };

  ensureAudio21Sheet_();
  const aba   = getSheet(SHEET_AUDIO21);
  const data  = aba.getDataRange().getValues();
  const headers = data[0].map(h => String(h || ''));

  // Procura linha do dia
  let targetRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (parseInt(data[i][headers.indexOf('dia')]) === dia) {
      targetRow = i + 1;
      break;
    }
  }

  const rowData = [
    dia,
    String(audioData.titulo      || 'Áudio do Dia ' + dia),
    String(audioData.descricao   || ''),
    String(audioData.audio_url   || ''),
    String(audioData.capa_url    || ''),
    String(audioData.legenda_url || ''),
    String(audioData.duracao     || ''),
    audioData.ativo !== false,
    dia
  ];

  if (targetRow > 0) {
    aba.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);
  } else {
    aba.appendRow(rowData);
  }

  logAction(user.email, 'SAVE_AUDIO21', 'audio_21_dias', String(dia), 'D' + dia);
  return { ok: true };
}

// Salva todos os 21 áudios de uma vez (batch)
function saveAllAudios21(token, audiosArray) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  if (!Array.isArray(audiosArray)) return { ok: false, error: 'Dados inválidos.' };

  const erros = [];
  audiosArray.forEach(a => {
    const r = saveAudio21(token, a);
    if (!r.ok) erros.push('D' + a.dia + ': ' + r.error);
  });

  return erros.length ? { ok: false, error: erros.join('; ') } : { ok: true };
}

// Helper: retorna array vazio de 21 áudios padrão
function _emptyAudios21_() {
  const arr = [];
  for (let d = 1; d <= 21; d++) {
    arr.push({ dia: d, titulo: 'Áudio do Dia ' + d, descricao: '', audio_url: '', capa_url: '', legenda_url: '', duracao: '', ativo: true, ordem: d });
  }
  return arr;
}

// ══════════════════════════════════════════════════════════════
// PIPELINES CONFIG — armazena etapas do pipeline como JSON
// ══════════════════════════════════════════════════════════════

function getDefaultPipeline_() {
  return {
    id:      'crm_default',
    nome:    'CRM Principal',
    etapas: [
      { id: 'interessado',      nome: 'Interessado',       cor: '#4caf50', ordem: 1, ativa: true },
      { id: 'qualificado',      nome: 'Qualificado',       cor: '#3b82f6', ordem: 2, ativa: true },
      { id: 'em_atendimento',   nome: 'Em Atendimento',    cor: '#f59e0b', ordem: 3, ativa: true },
      { id: 'proposta_enviada', nome: 'Proposta Enviada',  cor: '#e84040', ordem: 4, ativa: true },
      { id: 'fechado',          nome: 'Fechado',           cor: '#6dde71', ordem: 5, ativa: true }
    ],
    etapa_padrao: 'interessado',
    created_at:   new Date().toISOString(),
    updated_at:   new Date().toISOString()
  };
}

function getPipelinesConfig(token) {
  const user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  const raw = getConfig_('pipelines_config');
  let cfg;
  try { cfg = raw ? JSON.parse(String(raw)) : null; } catch(e) { cfg = null; }
  if (!cfg) cfg = getDefaultPipeline_();

  return { ok: true, data: cfg };
}

function savePipelinesConfig(token, cfg) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };

  cfg.updated_at = new Date().toISOString();
  setConfig_('pipelines_config', JSON.stringify(cfg));
  logAction(user.email, 'SAVE_PIPELINE_CONFIG', 'config', 'pipeline', '');
  return { ok: true };
}
