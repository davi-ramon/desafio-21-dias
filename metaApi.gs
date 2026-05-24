// ============================================================
// metaApi.gs — Integração com Meta Marketing API
// Adicionar como novo arquivo no projeto CRM Desafio 21 Dias
// ============================================================

const SHEET_TRAFEGO    = 'trafego';
const META_API_VERSION = 'v22.0';
const META_API_BASE    = 'https://graph.facebook.com/' + META_API_VERSION;
const TRAFEGO_HEADERS  = [
  'data','campanha','conjunto','anuncio',
  'investimento','alcance','impressoes','frequencia',
  'cpm','cpc_link','cpc_total','cliques_link','cliques_total',
  'ctr_link','ctr_total','leads','custo_lead','views_lp',
  'campanha_id','conjunto_id','anuncio_id','sync_at'
];
const META_INSIGHTS_FIELDS = [
  'date_start', 'date_stop',
  'campaign_name', 'campaign_id',
  'adset_name', 'adset_id',
  'ad_name', 'ad_id',
  'spend', 'reach', 'impressions', 'frequency',
  'cpm', 'cpc', 'ctr', 'clicks',
  'inline_link_clicks', 'inline_link_click_ctr',
  'cost_per_inline_link_click',
  'actions', 'cost_per_action_type'
];
const META_LEAD_ACTION_TYPES = [
  'lead',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
  'onsite_web_lead',
  'omni_lead',
  'onsite_conversion.messaging_conversation_started_7d'
];
const META_LANDING_PAGE_ACTION_TYPES = [
  'landing_page_view',
  'landing_page_view.content_view'
];

// Colunas da aba trafego (base-0)
const COL_TRAFEGO = {
  DATA:         0,   // A
  CAMPANHA:     1,   // B
  CONJUNTO:     2,   // C
  ANUNCIO:      3,   // D
  INVESTIMENTO: 4,   // E
  ALCANCE:      5,   // F
  IMPRESSOES:   6,   // G
  FREQUENCIA:   7,   // H
  CPM:          8,   // I
  CPC_LINK:     9,   // J
  CPC_TOTAL:   10,   // K
  CLIQUES_LINK: 11,  // L
  CLIQUES_TOT:  12,  // M
  CTR_LINK:    13,   // N
  CTR_TOTAL:   14,   // O
  LEADS:       15,   // P
  CUSTO_LEAD:  16,   // Q
  VIEWS_LP:    17,   // R — landing_page_views (se disponível)
  CAMPANHA_ID: 18,   // S
  CONJUNTO_ID: 19,   // T
  ANUNCIO_ID:  20,   // U
  SYNC_AT:     21    // V
};

// ══════════════════════════════════════════════════════════════
// INIT SHEET TRAFEGO
// ══════════════════════════════════════════════════════════════

function initTrafegoSheet_() {
  const ss  = getSpreadsheet_();
  let aba   = ss.getSheetByName(SHEET_TRAFEGO);
  if (!aba) {
    aba = ss.insertSheet(SHEET_TRAFEGO);
    const headers = [
      'data','campanha','conjunto','anuncio',
      'investimento','alcance','impressoes','frequencia',
      'cpm','cpc_link','cpc_total','cliques_link','cliques_total',
      'ctr_link','ctr_total','leads','custo_lead','views_lp',
      'campanha_id','conjunto_id','anuncio_id','sync_at'
    ];
    aba.appendRow(headers);
    aba.getRange(1, 1, 1, headers.length)
       .setFontWeight('bold').setBackground('#1877f2').setFontColor('#ffffff');
    // Formata colunas numéricas
    aba.getRange('E:E').setNumberFormat('R$#,##0.00');
    aba.getRange('H:H').setNumberFormat('0.00');
    aba.getRange('I:I').setNumberFormat('R$#,##0.00');
    aba.getRange('J:K').setNumberFormat('R$#,##0.00');
    aba.getRange('N:O').setNumberFormat('0.00%');
    aba.getRange('Q:Q').setNumberFormat('R$#,##0.00');
    logAction('system', 'INIT_TRAFEGO_SHEET', 'trafego', '', 'Aba trafego criada.');
  }
  return aba;
}

function initTrafegoSheetV2_() {
  const aba = initTrafegoSheet_();
  const lastCol = Math.max(1, aba.getLastColumn());
  const currentHeaders = aba.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v || ''));
  const needsHeader = aba.getLastRow() === 0 || currentHeaders.slice(0, TRAFEGO_HEADERS.length).join('|') !== TRAFEGO_HEADERS.join('|');

  if (needsHeader) {
    aba.getRange(1, 1, 1, TRAFEGO_HEADERS.length).setValues([TRAFEGO_HEADERS]);
  }

  aba.getRange(1, 1, 1, TRAFEGO_HEADERS.length)
    .setFontWeight('bold').setBackground('#1877f2').setFontColor('#ffffff');
  aba.getRange('E:E').setNumberFormat('R$#,##0.00');
  aba.getRange('H:H').setNumberFormat('0.00');
  aba.getRange('I:I').setNumberFormat('R$#,##0.00');
  aba.getRange('J:K').setNumberFormat('R$#,##0.00');
  aba.getRange('N:O').setNumberFormat('0.00%');
  aba.getRange('Q:Q').setNumberFormat('R$#,##0.00');
  return aba;
}

function syncMetaDadosV2_() {
  const accessToken = String(getConfig_('meta_access_token') || '').trim();
  const accountId   = String(getConfig_('meta_ad_account_id') || '').trim();
  const syncAt      = nowISO();

  if (!accessToken || !accountId) {
    const error = 'Token ou Ad Account da Meta nao configurados.';
    setConfig_('meta_last_sync', syncAt);
    setConfig_('meta_last_status', 'error');
    setConfig_('meta_last_count', '0');
    setConfig_('meta_last_error', error);
    logAction('system', 'META_SYNC_SKIP', 'trafego', '', error);
    return { ok: false, error: error };
  }

  try {
    const dataAlvo = _metaDataOntem_();
    const insights = _buscarInsightsMetaV2_(accessToken, accountId, dataAlvo);
    const linhas = insights.map(_transformarInsightV2_).filter(Boolean);

    initTrafegoSheetV2_();
    _removerLinhasPorData_(dataAlvo);
    if (linhas.length) _gravarTrafegoSheetV2_(linhas);

    const status = linhas.length ? 'ok' : 'ok_empty';
    setConfig_('meta_last_sync', syncAt);
    setConfig_('meta_last_status', status);
    setConfig_('meta_last_count', String(linhas.length));
    setConfig_('meta_last_error', '');
    logAction('system', linhas.length ? 'META_SYNC_OK' : 'META_SYNC_EMPTY', 'trafego', dataAlvo, JSON.stringify({
      date: dataAlvo,
      count: linhas.length,
      status: status
    }));

    return {
      ok: true,
      count: linhas.length,
      date: dataAlvo,
      message: linhas.length
        ? 'Sync concluido. ' + linhas.length + ' linhas gravadas em trafego para ' + dataAlvo + '.'
        : 'Sync concluido. Nenhum insight disponivel para ' + dataAlvo + '.'
    };
  } catch (err) {
    const technical = err && err.technical ? err.technical : {};
    const error = technical.error || err.message || 'Falha ao sincronizar a Meta.';
    setConfig_('meta_last_sync', syncAt);
    setConfig_('meta_last_status', 'error');
    setConfig_('meta_last_count', '0');
    setConfig_('meta_last_error', error);
    logAction('system', 'META_SYNC_ERROR', 'trafego', '', JSON.stringify({
      error: error,
      technical: technical
    }));
    return { ok: false, error: error, technical: technical };
  }
}

function _buscarInsightsMetaV2_(accessToken, accountId, dataAlvo) {
  const cleanId = String(accountId).replace(/^act_/, '');
  const params = [
    'fields=' + encodeURIComponent(META_INSIGHTS_FIELDS.join(',')),
    'level=ad',
    'time_range=' + encodeURIComponent(JSON.stringify({ since: dataAlvo, until: dataAlvo })),
    'time_increment=1',
    'limit=500',
    'access_token=' + encodeURIComponent(accessToken)
  ].join('&');

  let url = META_API_BASE + '/act_' + cleanId + '/insights?' + params;
  let rows = [];
  let safetyCounter = 0;

  while (url && safetyCounter < 10) {
    const apiRes = _executarFetchMeta_(url);
    if (!apiRes.ok) {
      const error = _extrairErroMeta_(apiRes.body) || ('Meta API ' + apiRes.code);
      const metaError = new Error(error);
      metaError.technical = {
        accountId: cleanId,
        date: dataAlvo,
        endpoint: url,
        httpCode: apiRes.code,
        responseBody: _limitarMetaTexto_(apiRes.body, 1000),
        error: error,
        fields: META_INSIGHTS_FIELDS
      };
      throw metaError;
    }

    let json = {};
    try { json = JSON.parse(apiRes.body) || {}; } catch (e) {}
    rows = rows.concat(json.data || []);
    url = json.paging && json.paging.next ? json.paging.next : '';
    safetyCounter++;
  }

  return rows;
}

function _transformarInsightV2_(row) {
  const n = value => parseFloat(value) || 0;
  const s = value => String(value || '');
  const spend = n(row.spend);
  const clicks = n(row.clicks);
  const linkClicks = n(row.inline_link_clicks);
  const leads = _somarActionStats_(row.actions, META_LEAD_ACTION_TYPES);
  const custoLead = _obterPrimeiroActionStat_(row.cost_per_action_type, META_LEAD_ACTION_TYPES) || (leads > 0 ? spend / leads : 0);
  const viewsLp = _somarActionStats_(row.actions, META_LANDING_PAGE_ACTION_TYPES);
  const cpcLink = n(row.cost_per_inline_link_click) || (linkClicks > 0 ? spend / linkClicks : 0);
  const cpcTotal = clicks > 0 ? spend / clicks : 0;

  const linha = new Array(TRAFEGO_HEADERS.length).fill('');
  linha[COL_TRAFEGO.DATA]         = s(row.date_start || row.date_stop);
  linha[COL_TRAFEGO.CAMPANHA]     = s(row.campaign_name);
  linha[COL_TRAFEGO.CONJUNTO]     = s(row.adset_name);
  linha[COL_TRAFEGO.ANUNCIO]      = s(row.ad_name);
  linha[COL_TRAFEGO.INVESTIMENTO] = spend;
  linha[COL_TRAFEGO.ALCANCE]      = n(row.reach);
  linha[COL_TRAFEGO.IMPRESSOES]   = n(row.impressions);
  linha[COL_TRAFEGO.FREQUENCIA]   = n(row.frequency);
  linha[COL_TRAFEGO.CPM]          = n(row.cpm);
  linha[COL_TRAFEGO.CPC_LINK]     = cpcLink;
  linha[COL_TRAFEGO.CPC_TOTAL]    = cpcTotal;
  linha[COL_TRAFEGO.CLIQUES_LINK] = linkClicks;
  linha[COL_TRAFEGO.CLIQUES_TOT]  = clicks;
  linha[COL_TRAFEGO.CTR_LINK]     = n(row.inline_link_click_ctr) / 100;
  linha[COL_TRAFEGO.CTR_TOTAL]    = n(row.ctr) / 100;
  linha[COL_TRAFEGO.LEADS]        = leads;
  linha[COL_TRAFEGO.CUSTO_LEAD]   = custoLead;
  linha[COL_TRAFEGO.VIEWS_LP]     = viewsLp;
  linha[COL_TRAFEGO.CAMPANHA_ID]  = s(row.campaign_id);
  linha[COL_TRAFEGO.CONJUNTO_ID]  = s(row.adset_id);
  linha[COL_TRAFEGO.ANUNCIO_ID]   = s(row.ad_id);
  linha[COL_TRAFEGO.SYNC_AT]      = nowISO();
  return linha;
}

function _gravarTrafegoSheetV2_(linhas) {
  if (!linhas || !linhas.length) return;
  const aba = initTrafegoSheetV2_();
  const startRow = Math.max(2, aba.getLastRow() + 1);
  aba.getRange(startRow, 1, linhas.length, TRAFEGO_HEADERS.length).setValues(linhas);
}

function _executarFetchMeta_(url) {
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  return {
    ok: resp.getResponseCode() >= 200 && resp.getResponseCode() < 300,
    code: resp.getResponseCode(),
    body: resp.getContentText()
  };
}

function _somarActionStats_(items, actionTypes) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((acc, item) => {
    return actionTypes.indexOf(String(item && item.action_type || '')) !== -1
      ? acc + (parseFloat(item.value) || 0)
      : acc;
  }, 0);
}

function _obterPrimeiroActionStat_(items, actionTypes) {
  if (!Array.isArray(items)) return 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i] || {};
    if (actionTypes.indexOf(String(item.action_type || '')) !== -1) {
      return parseFloat(item.value) || 0;
    }
  }
  return 0;
}

function _extrairErroMeta_(body) {
  try {
    const json = JSON.parse(body || '{}');
    if (json && json.error && json.error.message) return json.error.message;
    if (json && json.message) return json.message;
  } catch (e) {}
  return _limitarMetaTexto_(body || '', 500);
}

function _limitarMetaTexto_(value, maxLen) {
  const text = String(value || '');
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + '...';
}

// ══════════════════════════════════════════════════════════════
// SYNC PRINCIPAL — chamado pelo trigger diário
// ══════════════════════════════════════════════════════════════

function syncMetaDados_() {
  const accessToken = getConfig_('meta_access_token');
  const accountId   = getConfig_('meta_ad_account_id');

  if (!accessToken || !accountId) {
    logAction('system', 'META_SYNC_SKIP', 'trafego', '', 'Token ou Ad Account não configurados.');
    return;
  }

  try {
    // Data de ontem no formato YYYY-MM-DD
    const ontem = _metaDataOntem_();
    const insights = _buscarInsightsMeta_(accessToken, accountId, ontem);

    if (!insights || !insights.length) {
      logAction('system', 'META_SYNC_EMPTY', 'trafego', '', 'Sem insights para ' + ontem);
      setConfig_('meta_last_sync', nowISO());
      setConfig_('meta_last_status', 'ok_empty');
      return;
    }

    // Remove linhas existentes para a mesma data (evita duplicatas)
    _removerLinhasPorData_(ontem);

    // Grava novos dados
    const linhas = insights.map(_transformarInsight_);
    _gravarTrafegoSheet_(linhas);

    setConfig_('meta_last_sync', nowISO());
    setConfig_('meta_last_status', 'ok');
    setConfig_('meta_last_count', String(linhas.length));
    logAction('system', 'META_SYNC_OK', 'trafego', '', 'Linhas gravadas: ' + linhas.length + ' | data: ' + ontem);

  } catch (err) {
    setConfig_('meta_last_status', 'error: ' + err.message.substring(0, 100));
    logAction('system', 'META_SYNC_ERROR', 'trafego', '', err.message);
  }
}

// ══════════════════════════════════════════════════════════════
// CHAMADA À API META
// ══════════════════════════════════════════════════════════════

function _buscarInsightsMeta_(accessToken, accountId, dataAlvo) {
  // Remove 'act_' se já existir no accountId
  const cleanId = String(accountId).replace(/^act_/, '');

  const fields = [
    'date_start', 'date_stop',
    'campaign_name', 'campaign_id',
    'adset_name', 'adset_id',
    'ad_name', 'ad_id',
    'spend', 'reach', 'impressions', 'frequency',
    'cpm', 'cpc', 'ctr', 'clicks',
    'inline_link_clicks', 'inline_link_click_ctr',
    'actions', 'cost_per_action_type',
    'landing_page_views'
  ].join(',');

  const params = [
    'fields=' + fields,
    'level=ad',
    'time_range=' + encodeURIComponent(JSON.stringify({ since: dataAlvo, until: dataAlvo })),
    'time_increment=1',
    'limit=500',
    'access_token=' + accessToken
  ].join('&');

  const url = META_API_BASE + '/act_' + cleanId + '/insights?' + params;

  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const code = resp.getResponseCode();
  const body = resp.getContentText();

  if (code !== 200) {
    throw new Error('Meta API ' + code + ': ' + body.substring(0, 300));
  }

  const json = JSON.parse(body);
  let rows = json.data || [];

  // Paginação automática
  let paging = json.paging;
  let safetyCounter = 0;
  while (paging && paging.next && safetyCounter < 10) {
    const nextResp = UrlFetchApp.fetch(paging.next, { muteHttpExceptions: true });
    const nextJson = JSON.parse(nextResp.getContentText());
    rows = rows.concat(nextJson.data || []);
    paging = nextJson.paging;
    safetyCounter++;
  }

  return rows;
}

// ══════════════════════════════════════════════════════════════
// TRANSFORMAR INSIGHT → LINHA DA PLANILHA
// ══════════════════════════════════════════════════════════════

function _transformarInsight_(row) {
  const n  = v => parseFloat(v) || 0;
  const s  = v => String(v || '');

  // Extrai leads das actions
  let leads     = 0;
  let custoLead = 0;
  const actions = row.actions || [];
  const leadTypes = ['onsite_conversion.lead_grouped', 'lead', 'onsite_conversion.messaging_conversation_started_7d'];

  actions.forEach(a => {
    if (leadTypes.includes(a.action_type)) leads += parseInt(a.value) || 0;
  });

  const costActions = row.cost_per_action_type || [];
  costActions.forEach(a => {
    if (leadTypes.includes(a.action_type)) custoLead = n(a.value);
  });

  const spend    = n(row.spend);
  const clicks   = n(row.clicks);
  const linkClk  = n(row.inline_link_clicks);

  // CPC total calculado se não vier direto
  const cpcTotal = clicks > 0 ? spend / clicks : 0;

  const linha = new Array(22).fill('');
  linha[COL_TRAFEGO.DATA]         = s(row.date_start);
  linha[COL_TRAFEGO.CAMPANHA]     = s(row.campaign_name);
  linha[COL_TRAFEGO.CONJUNTO]     = s(row.adset_name);
  linha[COL_TRAFEGO.ANUNCIO]      = s(row.ad_name);
  linha[COL_TRAFEGO.INVESTIMENTO] = spend;
  linha[COL_TRAFEGO.ALCANCE]      = n(row.reach);
  linha[COL_TRAFEGO.IMPRESSOES]   = n(row.impressions);
  linha[COL_TRAFEGO.FREQUENCIA]   = n(row.frequency);
  linha[COL_TRAFEGO.CPM]          = n(row.cpm);
  linha[COL_TRAFEGO.CPC_LINK]     = n(row.cpc);
  linha[COL_TRAFEGO.CPC_TOTAL]    = cpcTotal;
  linha[COL_TRAFEGO.CLIQUES_LINK] = linkClk;
  linha[COL_TRAFEGO.CLIQUES_TOT]  = clicks;
  linha[COL_TRAFEGO.CTR_LINK]     = n(row.inline_link_click_ctr) / 100; // converte % para decimal
  linha[COL_TRAFEGO.CTR_TOTAL]    = n(row.ctr) / 100;
  linha[COL_TRAFEGO.LEADS]        = leads;
  linha[COL_TRAFEGO.CUSTO_LEAD]   = custoLead;
  linha[COL_TRAFEGO.VIEWS_LP]     = n(row.landing_page_views);
  linha[COL_TRAFEGO.CAMPANHA_ID]  = s(row.campaign_id);
  linha[COL_TRAFEGO.CONJUNTO_ID]  = s(row.adset_id);
  linha[COL_TRAFEGO.ANUNCIO_ID]   = s(row.ad_id);
  linha[COL_TRAFEGO.SYNC_AT]      = nowISO();

  return linha;
}

// ══════════════════════════════════════════════════════════════
// GRAVAR NA ABA TRAFEGO
// ══════════════════════════════════════════════════════════════

function _gravarTrafegoSheet_(linhas) {
  const aba = initTrafegoSheet_();
  linhas.forEach(l => aba.appendRow(l));
}

function _removerLinhasPorData_(data) {
  const ss  = getSpreadsheet_();
  const aba = ss.getSheetByName(SHEET_TRAFEGO);
  if (!aba || aba.getLastRow() < 2) return;

  const valores = aba.getDataRange().getValues();
  // Percorre de baixo para cima para não deslocar índices
  for (let i = valores.length - 1; i >= 1; i--) {
    if (String(valores[i][COL_TRAFEGO.DATA]) === data) {
      aba.deleteRow(i + 1);
    }
  }
}

// ══════════════════════════════════════════════════════════════
// TESTAR CONEXÃO
// ══════════════════════════════════════════════════════════════

function testarConexaoMeta(token) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };

  const accessToken = getConfig_('meta_access_token');
  const accountId   = getConfig_('meta_ad_account_id');

  if (!accessToken || !accountId) {
    return { ok: false, error: 'Configure o Access Token e o Ad Account ID primeiro.' };
  }

  try {
    const cleanId = String(accountId).replace(/^act_/, '');
    const url     = META_API_BASE + '/act_' + cleanId + '?fields=name,currency,timezone_name&access_token=' + accessToken;
    const resp    = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code    = resp.getResponseCode();
    const body    = JSON.parse(resp.getContentText());

    if (code === 200 && body.name) {
      logAction(user.email, 'META_TEST_OK', 'meta', accountId, body.name);
      return { ok: true, data: { nome: body.name, moeda: body.currency, fuso: body.timezone_name } };
    } else {
      const errMsg = (body.error && body.error.message) || ('HTTP ' + code);
      logAction(user.email, 'META_TEST_FAIL', 'meta', accountId, errMsg);
      return { ok: false, error: errMsg };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ══════════════════════════════════════════════════════════════
// SYNC MANUAL (chamado pelo frontend)
// ══════════════════════════════════════════════════════════════

function syncMetaManual(token) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };

  try {
    syncMetaDados_();
    const count = getConfig_('meta_last_count') || '0';
    const st    = getConfig_('meta_last_status') || 'ok';
    if (st.startsWith('error')) return { ok: false, error: st };
    return { ok: true, message: 'Sync concluído. Linhas: ' + count };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ══════════════════════════════════════════════════════════════
// SETUP TRIGGER DIÁRIO (08:00 Brasília)
// ══════════════════════════════════════════════════════════════

function setupMetaTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncMetaDados_') ScriptApp.deleteTrigger(t);
  });

  const hora = parseInt(getConfig_('meta_sync_hora')) || 8;
  ScriptApp.newTrigger('syncMetaDados_')
    .timeBased().atHour(hora).nearMinute(0)
    .everyDays(1).inTimezone('America/Sao_Paulo').create();

  logAction('system', 'META_TRIGGER_OK', 'meta', '', 'Trigger diário criado às ' + hora + ':00 Brasília');
  return { ok: true, message: 'Trigger Meta configurado: ' + hora + ':00 todos os dias.' };
}

// ══════════════════════════════════════════════════════════════
// STATUS DA INTEGRAÇÃO META (para o frontend)
// ══════════════════════════════════════════════════════════════

function getMetaStatus(token) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };

  const configurado = !!(getConfig_('meta_access_token') && getConfig_('meta_ad_account_id'));

  // Conta total de linhas na aba trafego
  const ss  = getSpreadsheet_();
  const aba = ss.getSheetByName(SHEET_TRAFEGO);
  const totalLinhas = aba ? Math.max(0, aba.getLastRow() - 1) : 0;

  return {
    ok: true,
    data: {
      configurado:  configurado,
      lastSync:     getConfig_('meta_last_sync')  || null,
      lastStatus:   getConfig_('meta_last_status')|| null,
      lastCount:    getConfig_('meta_last_count') || '0',
      totalLinhas:  totalLinhas,
      syncHora:     getConfig_('meta_sync_hora')  || '8'
    }
  };
}

// ══════════════════════════════════════════════════════════════
// RESUMO DE TRÁFEGO PARA O DASHBOARD
// Retorna totais dos últimos 7 dias
// ══════════════════════════════════════════════════════════════

function getTrafegoResumoDashboard_() {
  const ss  = getSpreadsheet_();
  const aba = ss.getSheetByName(SHEET_TRAFEGO);
  if (!aba || aba.getLastRow() < 2) {
    return { configurado: false };
  }

  const dados   = aba.getDataRange().getValues();
  const headers = dados[0];
  const agora   = new Date();
  const limite  = new Date(agora - 7 * 24 * 3600000);

  let invest = 0, leads = 0, alcance = 0, impressoes = 0, cliquesLink = 0;
  let linhasContadas = 0;

  for (let i = 1; i < dados.length; i++) {
    const dataStr = String(dados[i][COL_TRAFEGO.DATA]);
    const dataRow = new Date(dataStr);
    if (isNaN(dataRow) || dataRow < limite) continue;

    invest     += parseFloat(dados[i][COL_TRAFEGO.INVESTIMENTO]) || 0;
    leads      += parseInt(dados[i][COL_TRAFEGO.LEADS])          || 0;
    alcance    += parseInt(dados[i][COL_TRAFEGO.ALCANCE])         || 0;
    impressoes += parseInt(dados[i][COL_TRAFEGO.IMPRESSOES])      || 0;
    cliquesLink+= parseInt(dados[i][COL_TRAFEGO.CLIQUES_LINK])    || 0;
    linhasContadas++;
  }

  const cpl = leads > 0 ? invest / leads : 0;

  return {
    configurado: true,
    periodo:     '7 dias',
    invest:      invest.toFixed(2),
    leads:       leads,
    alcance:     alcance,
    impressoes:  impressoes,
    cliquesLink: cliquesLink,
    cpl:         cpl.toFixed(2),
    linhas:      linhasContadas
  };
}

// ══════════════════════════════════════════════════════════════
// STUB PARA FUTURA ABA rastreio_lp — arquitetura preparada
// ══════════════════════════════════════════════════════════════

const SHEET_RASTREIO_LP = 'rastreio_lp';

// Colunas preparadas para eventos da landing page
// Será alimentada por um endpoint POST recebendo eventos do pixel customizado
// (VSLPlay, VSLWatched, ScrollDepth, CTAClick, WhatsAppClick, BiaChatOpened)
// Chamada futura: receberEventoLP_(payload)

function initRastreioLPSheet_() {
  const ss  = getSpreadsheet_();
  let aba   = ss.getSheetByName(SHEET_RASTREIO_LP);
  if (!aba) {
    aba = ss.insertSheet(SHEET_RASTREIO_LP);
    const headers = [
      'timestamp', 'evento', 'valor', 'url_origem',
      'session_id', 'fbclid', 'user_agent_hash', 'extra'
    ];
    aba.appendRow(headers);
    aba.getRange(1, 1, 1, headers.length)
       .setFontWeight('bold').setBackground('#059669').setFontColor('#ffffff');
    logAction('system', 'INIT_RASTREIO_LP', 'rastreio_lp', '', 'Aba rastreio_lp criada (stub).');
  }
  return aba;
}

// Esta função ficará ativa quando o pixel da LP começar a enviar eventos server-side
function receberEventoLP_(payload) {
  // payload: { evento, valor, url_origem, session_id, fbclid }
  const aba = initRastreioLPSheet_();
  aba.appendRow([
    nowISO(),
    payload.evento || '',
    payload.valor  || '',
    payload.url    || '',
    payload.session_id || '',
    payload.fbclid     || '',
    '',  // user_agent_hash — a ser implementado
    JSON.stringify(payload.extra || {})
  ]);
}

// ── Helper interno: data de ontem ────────────────────────────
function _metaDataOntem_() {
  const d   = new Date();
  d.setDate(d.getDate() - 1);
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function syncMetaDados_() {
  return syncMetaDadosV2_();
}

function syncMetaManual(token) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };

  const result = syncMetaDadosV2_();
  if (!result.ok) return result;

  return {
    ok: true,
    message: result.message,
    technical: {
      date: result.date,
      count: result.count
    }
  };
}

function setupMetaTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    const handler = t.getHandlerFunction();
    if (handler === 'syncMetaDados_' || handler === 'syncMetaDadosV2_') ScriptApp.deleteTrigger(t);
  });

  const hora = parseInt(getConfig_('meta_sync_hora')) || 8;
  ScriptApp.newTrigger('syncMetaDadosV2_')
    .timeBased().atHour(hora).nearMinute(0)
    .everyDays(1).inTimezone('America/Sao_Paulo').create();

  logAction('system', 'META_TRIGGER_OK', 'meta', '', 'Trigger diario criado as ' + hora + ':00 Brasilia');
  return { ok: true, message: 'Trigger Meta configurado: ' + hora + ':00 todos os dias.' };
}

function getMetaStatus(token) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };

  const configurado = !!(getConfig_('meta_access_token') && getConfig_('meta_ad_account_id'));
  const ss  = getSpreadsheet_();
  const aba = ss.getSheetByName(SHEET_TRAFEGO);
  const totalLinhas = aba ? Math.max(0, aba.getLastRow() - 1) : 0;

  return {
    ok: true,
    data: {
      configurado: configurado,
      lastSync: getConfig_('meta_last_sync') || null,
      lastStatus: getConfig_('meta_last_status') || null,
      lastCount: getConfig_('meta_last_count') || '0',
      lastError: getConfig_('meta_last_error') || '',
      totalLinhas: totalLinhas,
      syncHora: getConfig_('meta_sync_hora') || '8'
    }
  };
}
