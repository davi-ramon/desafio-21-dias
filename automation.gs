// ============================================================
// automation.gs — Automações: Follow-up + Pós-compra 21 dias
// Integrado ao CRM WPK Tavares — adicionar como novo arquivo
// ============================================================

const SHEET_COMPRADORES = 'compradores';
const SHEET_CONFIG      = 'config';

// Índices da aba compradores (base-0)
const COL_COMP = {
  ORDER_ID:   0,  // A
  EMAIL:      1,  // B
  STATUS:     2,  // C
  NOME:       3,  // D
  TELEFONE:   4,  // E
  PAID_AT:    5,  // F
  CREATED_AT: 6,  // G
  PRODUTO:    7,  // H
  CHECKOUT:   8,  // I
  EBOOK:      9,  // J
  AUDIOS:    10,  // K
  GRUPO:     11,  // L
  DIA_ATUAL: 12,  // M
  ATIVO:     13,  // N
  ULT_CHECK: 14,  // O
  ONBOARDED: 15,  // P
  DIA_CONC:  16,  // Q
  D1:        17   // R..AL = D1..D21
};

const GPTMAKER_BOT_ID_DEFAULT = '3EC71D3CE79690D58F1406248698ACFB';
// Token removido do fonte (segurança). Vive no config sheet — getConfig_('gptmaker_token').
// Se precisar reconfigurar, grave lá ou via setupGptmakerToken('<token>'). NUNCA hardcodar.
const GPTMAKER_TOKEN_DEFAULT  = '';
const COMPRADOR_META_HEADERS = [
  'ModoExecucao',
  'TesteIniciadoEm',
  'UltimoEnvioStatus',
  'UltimoEnvioDetalhe',
  'GptChatId',
  'GptChannelId',
  'GptWorkspaceId',
  'GptEndpoint',
  'UltimaMensagemAt',
  'Preferencias'      // v132 — JSON de personalização da experiência
];

// ── Defaults de configuração ─────────────────────────────────
function getDefaultConfig_() {
  return {
    followup_ativo:            false,
    followup_delay_horas:      24,
    followup_max_tentativas:   2,
    followup_intervalo_horas:  48,
    followup_template:         'desafio21_boas_vindas_mkt',
    automacao21_ativa:         true,
    pdf_link:    'https://drive.google.com/file/d/119EuQBQ6VG8jvwGu14BdziPixfIllHmF/view?usp=drive_link',
    grupo_link:  'https://chat.whatsapp.com/KRpaLAV4lD526yhgOeC4Us',
    audios_link: 'https://wpktavares.com.br/audios',
    sala_link:   '',
    gptmaker_bot_id: GPTMAKER_BOT_ID_DEFAULT,
    gptmaker_token:  GPTMAKER_TOKEN_DEFAULT,
    gptmaker_workspace_id: '',
    gptmaker_channel_id: ''
  };
}

// ══════════════════════════════════════════════════════════════
// CONFIG MANAGEMENT
// ══════════════════════════════════════════════════════════════

function initConfigSheet_() {
  const sheet = getSheet(SHEET_CONFIG);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['key', 'value', 'updated_at']);
    sheet.getRange(1,1,1,3).setFontWeight('bold').setBackground('#6c47ff').setFontColor('#ffffff');
    const defaults = getDefaultConfig_();
    const now = nowISO();
    Object.keys(defaults).forEach(k => sheet.appendRow([k, defaults[k], now]));
  }
  return sheet;
}

function getConfig_(key) {
  const sheet = getSheet(SHEET_CONFIG);
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === key) return data[i][1];
  }
  // Retorna default se chave não existe
  const defaults = getDefaultConfig_();
  return defaults[key] !== undefined ? defaults[key] : null;
}

function setConfig_(key, value) {
  const sheet = getSheet(SHEET_CONFIG);
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      sheet.getRange(i + 1, 3).setValue(nowISO());
      return;
    }
  }
  sheet.appendRow([key, value, nowISO()]);
}

// Retorna config completo para o frontend
function getFullConfig(token) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };

  const sheet = getSheet(SHEET_CONFIG);
  const data  = sheet.getDataRange().getValues();
  const cfg   = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) cfg[String(data[i][0])] = data[i][1];
  }

  // Preencher defaults para chaves ausentes
  const defaults = getDefaultConfig_();
  Object.keys(defaults).forEach(k => {
    if (cfg[k] === undefined || cfg[k] === '') cfg[k] = defaults[k];
  });

  return { ok: true, data: cfg };
}

// Salva config enviado pelo frontend
function saveFullConfig(token, cfg) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };

  Object.keys(cfg).forEach(k => setConfig_(k, cfg[k]));
  logAction(user.email, 'SAVE_CONFIG', 'config', '', JSON.stringify(cfg));
  return { ok: true, message: 'Configurações salvas.' };
}

// ══════════════════════════════════════════════════════════════
// COMPRADORES — CRUD
// ══════════════════════════════════════════════════════════════

function initCompradoresSheet_() {
  const ss  = getSpreadsheet_();
  let aba   = ss.getSheetByName(SHEET_COMPRADORES);
  if (!aba) {
    aba = ss.insertSheet(SHEET_COMPRADORES);
    const cab = _getCompradoresHeaders_();
    aba.appendRow(cab);
    aba.getRange(1, 1, 1, cab.length)
       .setFontWeight('bold').setBackground('#6c47ff').setFontColor('#ffffff');
  } else {
    ensureCompradoresMetaColumns_(aba);
  }
  return aba;
}

function _getCompradoresHeaders_() {
  const headers = [
    'OrderId','Email','Status','Nome','Telefone','PaidAt','CreatedAt','Produto',
    'CheckoutUrl','EbookUrl','AudiosUrl','GrupoUrl',
    'DiaAtual','Ativo','UltimoCheckin','OnboardingEnviado','DiaConcluido'
  ];
  for (let d = 1; d <= 21; d++) headers.push('D' + d);
  return headers.concat(COMPRADOR_META_HEADERS);
}

function ensureCompradoresMetaColumns_(aba) {
  if (!aba) return {};

  const totalCols = Math.max(1, aba.getLastColumn());
  const headers = aba.getRange(1, 1, 1, totalCols).getValues()[0].map(v => String(v || ''));
  let changed = false;

  COMPRADOR_META_HEADERS.forEach(header => {
    if (headers.indexOf(header) === -1) {
      headers.push(header);
      changed = true;
    }
  });

  if (changed) {
    aba.getRange(1, 1, 1, headers.length).setValues([headers]);
    aba.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold').setBackground('#6c47ff').setFontColor('#ffffff');
  }

  const map = {};
  headers.forEach((header, idx) => { map[header] = idx + 1; });
  return map;
}

function salvarComprador_(orderId, email, status, nome, telefone, paidAt, produto) {
  const ss  = getSpreadsheet_();
  const aba = ss.getSheetByName(SHEET_COMPRADORES) || initCompradoresSheet_();
  ensureCompradoresMetaColumns_(aba);

  const linha = [
    orderId, email, status, nome, telefone, paidAt, nowISO(), produto,
    '',                               // CheckoutUrl
    getConfig_('pdf_link')   || '',   // EbookUrl
    getConfig_('audios_link')|| '',   // AudiosUrl
    getConfig_('grupo_link') || '',   // GrupoUrl
    1,     // DiaAtual
    true,  // Ativo
    '',    // UltimoCheckin
    false, // OnboardingEnviado
    ''     // DiaConcluido
  ];
  for (let i = 0; i < 21; i++) linha.push('');
  aba.appendRow(linha);
  return aba.getLastRow();
}

function compradorExiste_(orderId) {
  const ss  = getSpreadsheet_();
  const aba = ss.getSheetByName(SHEET_COMPRADORES);
  if (!aba) return false;
  const dados = aba.getDataRange().getValues();
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][COL_COMP.ORDER_ID]) === String(orderId)) return true;
  }
  return false;
}

function getCompradores_() {
  const ss  = getSpreadsheet_();
  const aba = ss.getSheetByName(SHEET_COMPRADORES);
  if (!aba) return [];
  return aba.getDataRange().getValues().slice(1).filter(r => r[COL_COMP.ATIVO] === true);
}

// ══════════════════════════════════════════════════════════════
// GPT MAKER — ENVIO DE MENSAGENS
// ══════════════════════════════════════════════════════════════

function enviarMensagemGPT_(telefone, mensagem) {
  const token  = getConfig_('gptmaker_token')   || GPTMAKER_TOKEN_DEFAULT;
  const botId  = getConfig_('gptmaker_bot_id')  || GPTMAKER_BOT_ID_DEFAULT;
  // Remove não-dígitos; o chat_id do GPT Maker = BOT_ID-PHONE
  const digits   = String(telefone).replace(/\D/g, '');
  const chatId   = botId + '-' + digits;
  const endpoint = 'https://api.gptmaker.ai/v2/chat/' + chatId + '/send-message';

  const options = {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    payload: JSON.stringify({ message: mensagem, replyMessageId: '' }),
    muteHttpExceptions: true
  };

  const resp = UrlFetchApp.fetch(endpoint, options);
  const code = resp.getResponseCode();
  logAction('system', 'GPTMAKER_MSG', 'whatsapp', telefone,
    code + ' | ' + resp.getContentText().substring(0, 200));
  return code >= 200 && code < 300;
}

function enviarMensagemGptV2_(telefone, mensagem) {
  const token   = String(getConfig_('gptmaker_token') || GPTMAKER_TOKEN_DEFAULT || '').trim();
  const agentId = String(getConfig_('gptmaker_bot_id') || GPTMAKER_BOT_ID_DEFAULT || '').trim();
  const digits  = _normalizarTelefoneGpt_(telefone);
  const result  = {
    ok: false,
    phone: digits,
    agentId: agentId,
    workspaceId: '',
    channelId: '',
    channelType: '',
    chatId: '',
    mode: '',
    endpoint: '',
    httpCode: 0,
    error: '',
    responseBody: ''
  };

  if (!token) {
    result.error = 'Token do GPT Maker nÃ£o configurado.';
    return _logResultadoGptMakerV2_(telefone, result);
  }
  if (!agentId) {
    result.error = 'Bot / Agent ID do GPT Maker nÃ£o configurado.';
    return _logResultadoGptMakerV2_(telefone, result);
  }
  if (!digits) {
    result.error = 'Telefone invÃ¡lido para envio no GPT Maker.';
    return _logResultadoGptMakerV2_(telefone, result);
  }

  const workspaceRes = _resolverWorkspaceGptMaker_(token);
  if (!workspaceRes.ok) {
    result.error = workspaceRes.error;
    result.httpCode = workspaceRes.httpCode || 0;
    result.responseBody = workspaceRes.responseBody || '';
    result.endpoint = workspaceRes.endpoint || '';
    return _logResultadoGptMakerV2_(telefone, result);
  }
  result.workspaceId = workspaceRes.workspaceId;

  const chatRes = _buscarChatGptMakerPorTelefone_(token, result.workspaceId, agentId, digits);
  if (chatRes.ok && chatRes.chatId) {
    const sendRes = _enviarMensagemChatGptMaker_(token, chatRes.chatId, mensagem);
    result.chatId = chatRes.chatId;
    result.mode = 'send-message';
    result.endpoint = sendRes.endpoint;
    result.httpCode = sendRes.code;
    result.responseBody = sendRes.body;
    if (sendRes.ok) {
      result.ok = true;
      return _logResultadoGptMakerV2_(telefone, result);
    }

    const sendError = _extrairErroApi_(sendRes.body, 'Falha ao enviar mensagem para chat existente.');
    if (!_deveTentarStartConversation_(sendRes.code, sendError)) {
      result.error = sendError;
      return _logResultadoGptMakerV2_(telefone, result);
    }
  }

  const channelRes = _resolverCanalGptMaker_(token, agentId, result.workspaceId);
  if (!channelRes.ok) {
    result.error = channelRes.error;
    result.httpCode = channelRes.httpCode || result.httpCode;
    result.responseBody = channelRes.responseBody || result.responseBody;
    result.endpoint = channelRes.endpoint || result.endpoint;
    return _logResultadoGptMakerV2_(telefone, result);
  }

  result.channelId = channelRes.channelId;
  result.channelType = channelRes.channelType || '';

  const startRes = _iniciarConversaGptMaker_(token, result.channelId, digits, mensagem);
  result.mode = 'start-conversation';
  result.endpoint = startRes.endpoint;
  result.httpCode = startRes.code;
  result.responseBody = startRes.body;
  if (startRes.ok) {
    result.ok = true;
  } else {
    result.error = _extrairErroApi_(startRes.body, 'Falha ao iniciar conversa no GPT Maker.');
  }

  return _logResultadoGptMakerV2_(telefone, result);
}

function _normalizarTelefoneGpt_(telefone) {
  const formatted = formatPhone(String(telefone || ''));
  return String(formatted || telefone || '').replace(/\D/g, '');
}

function _gptmakerHeadersV2_(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  };
}

function _callGptMakerApiV2_(method, endpoint, token, payload) {
  const options = {
    method: method,
    headers: _gptmakerHeadersV2_(token),
    muteHttpExceptions: true
  };
  if (payload !== undefined) options.payload = JSON.stringify(payload);

  const response = UrlFetchApp.fetch(endpoint, options);
  return {
    code: response.getResponseCode(),
    body: response.getContentText(),
    endpoint: endpoint,
    ok: response.getResponseCode() >= 200 && response.getResponseCode() < 300
  };
}

function _resolverWorkspaceGptMaker_(token) {
  const cachedWorkspace = String(getConfig_('gptmaker_workspace_id') || '').trim();
  if (cachedWorkspace) return { ok: true, workspaceId: cachedWorkspace };

  const endpoint = 'https://api.gptmaker.ai/v2/workspaces';
  const apiRes = _callGptMakerApiV2_('GET', endpoint, token);
  if (!apiRes.ok) {
    return {
      ok: false,
      error: _extrairErroApi_(apiRes.body, 'Falha ao listar workspaces do GPT Maker.'),
      httpCode: apiRes.code,
      responseBody: apiRes.body,
      endpoint: endpoint
    };
  }

  let workspaces = [];
  try { workspaces = JSON.parse(apiRes.body) || []; } catch (e) {}
  const firstWorkspace = workspaces[0];
  if (!firstWorkspace || !firstWorkspace.id) {
    return { ok: false, error: 'Nenhum workspace encontrado para o token do GPT Maker.', endpoint: endpoint };
  }

  setConfig_('gptmaker_workspace_id', firstWorkspace.id);
  return { ok: true, workspaceId: firstWorkspace.id };
}

function _resolverCanalGptMaker_(token, agentId, workspaceId) {
  const cachedChannel = String(getConfig_('gptmaker_channel_id') || '').trim();
  if (cachedChannel) return { ok: true, channelId: cachedChannel };

  const endpoint = 'https://api.gptmaker.ai/v2/workspace/' + encodeURIComponent(workspaceId) + '/channels';
  const apiRes = _callGptMakerApiV2_('GET', endpoint, token);
  if (!apiRes.ok) {
    return {
      ok: false,
      error: _extrairErroApi_(apiRes.body, 'Falha ao listar canais do GPT Maker.'),
      httpCode: apiRes.code,
      responseBody: apiRes.body,
      endpoint: endpoint
    };
  }

  let json = {};
  try { json = JSON.parse(apiRes.body) || {}; } catch (e) {}
  const channels = Array.isArray(json) ? json : (json.data || []);
  const connectedChannels = channels.filter(channel =>
    channel && channel.connected && /WHATSAPP|CLOUD_API|Z_API/i.test(String(channel.type || ''))
  );
  const matchedChannel = connectedChannels.find(channel => String(channel.agentId || '') === String(agentId))
    || connectedChannels[0];

  if (!matchedChannel || !matchedChannel.id) {
    return {
      ok: false,
      error: 'Nenhum canal WhatsApp conectado encontrado para o bot/agente informado.',
      endpoint: endpoint
    };
  }

  setConfig_('gptmaker_channel_id', matchedChannel.id);
  return {
    ok: true,
    channelId: matchedChannel.id,
    channelType: String(matchedChannel.type || '')
  };
}

function _buscarChatGptMakerPorTelefone_(token, workspaceId, agentId, phoneDigits) {
  let page = 1;
  let lastEndpoint = '';

  while (page <= 5) {
    const params = [
      'agentId=' + encodeURIComponent(agentId),
      'page=' + page,
      'pageSize=100',
      'query=' + encodeURIComponent(phoneDigits)
    ].join('&');
    const endpoint = 'https://api.gptmaker.ai/v2/workspace/' + encodeURIComponent(workspaceId) + '/chats?' + params;
    const apiRes = _callGptMakerApiV2_('GET', endpoint, token);
    lastEndpoint = endpoint;

    if (!apiRes.ok) {
      return {
        ok: false,
        error: _extrairErroApi_(apiRes.body, 'Falha ao consultar chats do GPT Maker.'),
        httpCode: apiRes.code,
        responseBody: apiRes.body,
        endpoint: endpoint
      };
    }

    let json = [];
    try { json = JSON.parse(apiRes.body) || []; } catch (e) {}
    const items = Array.isArray(json) ? json : (json.data || []);
    const matchedChat = items.find(item => {
      const phone = _normalizarTelefoneGpt_(item.whatsappPhone || item.recipient || '');
      return phone && phone === phoneDigits;
    });
    if (matchedChat && matchedChat.id) {
      return { ok: true, chatId: matchedChat.id, endpoint: endpoint };
    }
    if (items.length < 100) break;
    page++;
  }

  return { ok: false, notFound: true, endpoint: lastEndpoint };
}

function _enviarMensagemChatGptMaker_(token, chatId, mensagem) {
  const endpoint = 'https://api.gptmaker.ai/v2/chat/' + encodeURIComponent(chatId) + '/send-message';
  return _callGptMakerApiV2_('POST', endpoint, token, { message: mensagem, replyMessageId: '' });
}

function _iniciarConversaGptMaker_(token, channelId, phoneDigits, mensagem) {
  const endpoint = 'https://api.gptmaker.ai/v2/channel/' + encodeURIComponent(channelId) + '/start-conversation';
  return _callGptMakerApiV2_('POST', endpoint, token, { phone: phoneDigits, message: mensagem });
}

function _extrairErroApi_(body, fallback) {
  try {
    const json = JSON.parse(body);
    if (json && json.error && json.error.message) return json.error.message;
    if (json && json.message) return json.message;
    if (json && json.success === false) return body;
  } catch (e) {}
  return _limitarTexto_(body || fallback || 'Erro desconhecido.', 500);
}

function _deveTentarStartConversation_(httpCode, errorText) {
  if (httpCode === 404) return true;
  const text = String(errorText || '').toLowerCase();
  return text.indexOf('chat') !== -1 && (text.indexOf('not found') !== -1 || text.indexOf('nÃ£o encontrado') !== -1 || text.indexOf('inexistente') !== -1);
}

function _limitarTexto_(value, maxLen) {
  const text = String(value || '');
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + '...';
}

function _logResultadoGptMakerV2_(telefone, result) {
  logAction('system', result.ok ? 'GPTMAKER_MSG_OK' : 'GPTMAKER_MSG_FAIL', 'whatsapp', String(telefone || ''), JSON.stringify({
    ok: result.ok,
    phone: result.phone || '',
    agentId: result.agentId || '',
    workspaceId: result.workspaceId || '',
    channelId: result.channelId || '',
    channelType: result.channelType || '',
    chatId: result.chatId || '',
    mode: result.mode || '',
    httpCode: result.httpCode || 0,
    endpoint: result.endpoint || '',
    error: result.error || '',
    responseBody: _limitarTexto_(result.responseBody || '', 500)
  }));
  return result;
}

function registrarResultadoEnvioComprador_(aba, rowIndex, modoExecucao, result, extra) {
  if (!aba || !rowIndex) return;

  const cols = ensureCompradoresMetaColumns_(aba);
  const updates = {
    ModoExecucao: modoExecucao || '',
    UltimoEnvioStatus: result && result.ok ? 'success' : 'error',
    UltimoEnvioDetalhe: _limitarTexto_(
      result && result.ok
        ? 'Envio OK via ' + (result.mode || 'gptmaker') + ' | HTTP ' + (result.httpCode || 200)
        : ((result && result.error) || 'Falha desconhecida no GPT Maker.'),
      500
    ),
    GptChatId: result && result.chatId ? result.chatId : '',
    GptChannelId: result && result.channelId ? result.channelId : '',
    GptWorkspaceId: result && result.workspaceId ? result.workspaceId : '',
    GptEndpoint: result && result.endpoint ? result.endpoint : '',
    UltimaMensagemAt: nowISO()
  };

  if (modoExecucao === 'teste') updates.TesteIniciadoEm = nowISO();
  if (extra && extra.pending === true) updates.UltimoEnvioStatus = 'pending';
  if (extra && extra.detail) updates.UltimoEnvioDetalhe = _limitarTexto_(extra.detail, 500);

  Object.keys(updates).forEach(key => {
    const col = cols[key];
    if (col) aba.getRange(rowIndex, col).setValue(updates[key]);
  });
}

// ══════════════════════════════════════════════════════════════
// WEBHOOK PÓS-COMPRA (CAKTO)
// Chamado de code.gs > doPost — NÃO tem doPost próprio
// ══════════════════════════════════════════════════════════════

function processWebhookCakto_(payload) {
  try {
    const status = String(payload.status || payload.payment_status || '').toLowerCase();
    if (status !== 'paid' && status !== 'approved') {
      logAction('system', 'CAKTO_IGNORED', 'webhook', '', 'status=' + status);
      return _okJson('Ignorado: status=' + status);
    }

    const nome     = String(payload.customer_name  || payload.name  || '');
    const email    = String(payload.customer_email || payload.email || '');
    const telefone = formatPhone(payload.customer_phone || payload.phone || '');
    const orderId  = String(payload.transaction_id || payload.order_id || payload.id || '');
    const produto  = String(payload.product_name || payload.product || 'Desafio 21 Dias');
    const paidAt   = nowISO();

    if (!telefone) {
      logAction('system', 'CAKTO_NO_PHONE', 'webhook', orderId, email);
      return _okJson('Sem telefone — pulando');
    }
    if (compradorExiste_(orderId)) {
      return _okJson('Pedido ja registrado: ' + orderId);
    }

    // 1. Registrar comprador
    const rowIndex = salvarComprador_(orderId, email, 'paid', nome, telefone, paidAt, produto);

    // 2. Criar conta de aluno (senha = últimos 6 dígitos do telefone)
    const senhaTemp = String(telefone).replace(/\D/g,'').slice(-6) || 'desafio21';
    criarUsuarioAluno_(email, nome, senhaTemp);

    // 3. Onboarding via GPT Maker
    const primeiroNome = nome.split(' ')[0] || 'pessoal';
    const pdfLink   = getConfig_('pdf_link')  || '';
    const grupoLink = getConfig_('grupo_link')|| '';

    const appUrl  = ScriptApp.getService().getUrl();
    const msg =
      'Boa, ' + primeiroNome + '! 🙌\n\n' +
      'Sua inscrição no *Desafio 21 Dias* tá confirmada.\n\n' +
      '📄 Seu guia em PDF: ' + pdfLink + '\n' +
      '💬 Grupo do desafio: ' + grupoLink + '\n\n' +
      '🔐 *Acesse sua área do aluno:*\n' + appUrl + '\n' +
      'Login: ' + email + '\n' +
      'Senha: ' + senhaTemp + '\n\n' +
      '*Dia 1 começa agora.* Bora! 💪';

    const envio = enviarMensagemGptV2_(telefone, msg);
    const compradoresAba = initCompradoresSheet_();
    registrarResultadoEnvioComprador_(compradoresAba, rowIndex, 'onboarding', envio);
    if (envio.ok) compradoresAba.getRange(rowIndex, COL_COMP.ONBOARDED + 1).setValue(true);

    logAction('system', envio.ok ? 'CAKTO_ONBOARDING_OK' : 'CAKTO_ONBOARDING_FAIL', 'comprador', orderId, JSON.stringify({
      nome: nome,
      email: email,
      phone: telefone,
      ok: envio.ok,
      error: envio.error || '',
      mode: envio.mode || ''
    }));

    return _okJson(
      envio.ok
        ? 'Onboarding enviado para ' + nome
        : 'Comprador registrado, mas o envio do onboarding falhou: ' + (envio.error || 'erro desconhecido')
    );

  } catch (err) {
    logAction('system', 'CAKTO_ERROR', 'webhook', '', err.message);
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function _okJson(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', msg: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ══════════════════════════════════════════════════════════════
// FOLLOW-UP — LEADS SEM RESPOSTA
// Trigger: a cada 1 hora
// ══════════════════════════════════════════════════════════════

function followUpLeadsSemResposta() {
  const ativo = getConfig_('followup_ativo');
  if (!ativo || ativo === 'false' || ativo === false) return;

  const delayHoras     = parseFloat(getConfig_('followup_delay_horas'))    || 24;
  const maxTentativas  = parseInt(getConfig_('followup_max_tentativas'))    || 2;
  const intervaloHoras = parseFloat(getConfig_('followup_intervalo_horas')) || 48;

  const sheet   = getSheet(SHEET_CRM);
  const data    = sheet.getDataRange().getValues();
  if (data.length < 2) return;

  const headers   = data[0].map(h => String(h));
  const idxId     = headers.indexOf('id');
  const idxStatus = headers.indexOf('status');
  const idxPhone  = headers.indexOf('phone');
  const idxName   = headers.indexOf('name');
  const idxDate   = headers.indexOf('created_at');
  const idxCF     = headers.indexOf('custom_fields');
  const idxTL     = headers.indexOf('timeline');

  const agora = new Date();
  let disparados = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[idxId]) continue;
    if (String(row[idxStatus]) !== 'Interessado') continue;

    const telefone = String(row[idxPhone] || '').replace(/\D/g,'');
    if (!telefone) continue;

    let cf = {};
    try { cf = JSON.parse(String(row[idxCF] || '{}')); } catch(e) {}

    const tentativas = parseInt(cf.followup_count) || 0;
    if (tentativas >= maxTentativas) continue;

    // Delay inicial desde criação do lead
    const rawDate   = row[idxDate];
    const createdAt = rawDate instanceof Date ? rawDate : new Date(rawDate);
    if (isNaN(createdAt)) continue;
    const horasDesde = (agora - createdAt) / 3600000;
    if (horasDesde < delayHoras) continue;

    // Intervalo entre tentativas
    if (tentativas > 0 && cf.followup_last_at) {
      const lastAt      = new Date(cf.followup_last_at);
      const horasUltimo = (agora - lastAt) / 3600000;
      if (horasUltimo < intervaloHoras) continue;
    }

    const nome     = String(row[idxName] || '').split(' ')[0] || 'você';
    const foneE164 = '+' + telefone;

    const msg =
      'Oi, ' + nome + '! 👋\n\n' +
      'Vi que você se inscreveu para conhecer o *Desafio 21 Dias*.\n\n' +
      'Muita gente que chegou até aqui estava exatamente onde você está — ' +
      'querendo mudar, mas sem saber por onde começar.\n\n' +
      'Posso te mostrar como funciona o método? É rápido. 🎯';

    const envio = enviarMensagemGptV2_(foneE164, msg);

    if (envio.ok) {
      cf.followup_count   = tentativas + 1;
      cf.followup_last_at = nowISO();
      cf.followup_status  = 'sent';
      sheet.getRange(i + 1, idxCF + 1).setValue(JSON.stringify(cf));

      let tl = [];
      try { tl = JSON.parse(String(row[idxTL] || '[]')); } catch(e) {}
      tl.push({
        action:    'Follow-up #' + (tentativas + 1) + ' enviado automaticamente',
        user:      'automation',
        timestamp: nowISO()
      });
      sheet.getRange(i + 1, idxTL + 1).setValue(JSON.stringify(tl));

      logAction('system', 'FOLLOWUP_SENT', 'lead', String(row[idxId]), foneE164);
      disparados++;

      // Evita rate limit
      if (disparados % 10 === 0) Utilities.sleep(2000);
    } else {
      cf.followup_status = 'error';
      cf.followup_last_error = envio.error || 'Falha desconhecida no GPT Maker.';
      sheet.getRange(i + 1, idxCF + 1).setValue(JSON.stringify(cf));
      logAction('system', 'FOLLOWUP_FAIL', 'lead', String(row[idxId]), JSON.stringify({
        phone: foneE164,
        error: envio.error || '',
        httpCode: envio.httpCode || 0
      }));
    }
  }

  invalidateLeadsCache_();
  logAction('system', 'FOLLOWUP_RUN', 'automation', '', 'Disparados: ' + disparados);
}

// ══════════════════════════════════════════════════════════════
// ROTINA MANHÃ (trigger diário — 05:30 Brasília)
// ══════════════════════════════════════════════════════════════

function rotinaManha() {
  if (!_auto21Ativa()) return;
  const salaLink   = getConfig_('sala_link')   || '';
  const audiosLink = getConfig_('audios_link') || '';

  const ss  = getSpreadsheet_();
  const aba = ss.getSheetByName(SHEET_COMPRADORES);
  if (!aba) return;

  const dados = aba.getDataRange().getValues();
  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];
    if (!linha[COL_COMP.ATIVO]) continue;
    const dia = parseInt(linha[COL_COMP.DIA_ATUAL]) || 1;
    if (dia > 21) continue;

    const nome  = String(linha[COL_COMP.NOME] || '').split(' ')[0] || 'você';
    const fone  = String(linha[COL_COMP.TELEFONE]);
    const audio = audiosLink + '/dia-' + dia;

    const msg =
      '☀️ *Dia ' + dia + ' de 21 — bom dia, ' + nome + '!*\n\n' +
      (salaLink ? '🌅 Sala de leitura em 25 min:\n' + salaLink + '\n\n' : '') +
      '🎧 Áudio de hoje:\n' + audio + '\n\n' +
      '3 pilares hoje:\n🧘 Meditação · 📖 Leitura · 🏃 Exercício';

    const envio = enviarMensagemGptV2_(fone, msg);
    registrarResultadoEnvioComprador_(aba, i + 1, 'automacao_manha', envio);
  }
}

// ══════════════════════════════════════════════════════════════
// ROTINA NOITE (trigger diário — 21:00 Brasília)
// ══════════════════════════════════════════════════════════════

function rotinaNight() {
  if (!_auto21Ativa()) return;

  const ss  = getSpreadsheet_();
  const aba = ss.getSheetByName(SHEET_COMPRADORES);
  if (!aba) return;

  const dados = aba.getDataRange().getValues();
  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];
    if (!linha[COL_COMP.ATIVO]) continue;
    const dia = parseInt(linha[COL_COMP.DIA_ATUAL]) || 1;
    if (dia > 21) continue;

    const nome = String(linha[COL_COMP.NOME] || '').split(' ')[0] || 'você';
    const fone = String(linha[COL_COMP.TELEFONE]);

    const msg =
      '🌙 *Check-in — Dia ' + dia + ', ' + nome + '*\n\n' +
      'Concluiu os 3 pilares hoje?\n\n' +
      'Responde aqui:\n' +
      '✅ *SIM* — completei tudo\n' +
      '🔄 *PARCIAL* — completei parte';

    const envio = enviarMensagemGptV2_(fone, msg);
    registrarResultadoEnvioComprador_(aba, i + 1, 'automacao_noite', envio);

    // Avança dia e registra
    if (envio.ok) {
      aba.getRange(i + 1, COL_COMP.DIA_ATUAL + 1).setValue(dia + 1);
    aba.getRange(i + 1, COL_COMP.ULT_CHECK + 1).setValue(nowISO());

    // Encerramento após dia 21
    if (dia === 21) {
      aba.getRange(i + 1, COL_COMP.ATIVO + 1).setValue(false);
      aba.getRange(i + 1, COL_COMP.DIA_CONC + 1).setValue(nowISO());
      const msgFim =
        '🏆 *PARABÉNS, ' + nome.toUpperCase() + '!*\n\n' +
        'Você completou os 21 dias! 🎉\n\n' +
        'Isso que você fez é raro. Continue. 💪\n\n' +
        '_Equipe WPK Tavares_';
        const envioFim = enviarMensagemGptV2_(fone, msgFim);
        registrarResultadoEnvioComprador_(aba, i + 1, 'automacao_finalizacao', envioFim);
      }
    } else {
      logAction('system', 'AUTO21_NIGHT_FAIL', 'comprador', String(linha[COL_COMP.ORDER_ID] || ''), JSON.stringify({
        phone: fone,
        day: dia,
        error: envio.error || ''
      }));
    }
  }
}

// ══════════════════════════════════════════════════════════════
// REGISTRAR CHECK-IN (resposta do comprador)
// ══════════════════════════════════════════════════════════════

function registrarCheckin_(telefone, resposta) {
  const ss  = getSpreadsheet_();
  const aba = ss.getSheetByName(SHEET_COMPRADORES);
  if (!aba) return { ok: false, error: 'Aba compradores não encontrada.' };

  const dados   = aba.getDataRange().getValues();
  const foneNorm = String(telefone).replace(/\D/g,'');

  for (let i = 1; i < dados.length; i++) {
    const fonePlanilha = String(dados[i][COL_COMP.TELEFONE]).replace(/\D/g,'');
    if (fonePlanilha !== foneNorm) continue;

    const dia        = parseInt(dados[i][COL_COMP.DIA_ATUAL]) || 1;
    const diaCheckin = dia - 1; // o contador foi avançado pela rotina noturna
    if (diaCheckin < 1 || diaCheckin > 21) return { ok: false, error: 'Dia inválido.' };

    const respUpper = String(resposta).toUpperCase();
    const valor = respUpper.includes('SIM')     ? 'SIM'
                : respUpper.includes('PARCIAL') ? 'PARCIAL'
                :                                 'NÃO RESPONDEU';

    const colCheckin = COL_COMP.D1 + (diaCheckin - 1);
    aba.getRange(i + 1, colCheckin + 1).setValue(valor);
    aba.getRange(i + 1, COL_COMP.ULT_CHECK + 1).setValue(nowISO());
    logAction('system', 'CHECKIN_REG', 'comprador', telefone, 'D' + diaCheckin + '=' + valor);
    return { ok: true };
  }
  return { ok: false, error: 'Comprador não encontrado.' };
}

// ══════════════════════════════════════════════════════════════
// STATUS DAS AUTOMAÇÕES (para o painel no frontend)
// ══════════════════════════════════════════════════════════════

function getAutomacaoStatus(token) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };

  const ss  = getSpreadsheet_();
  const aba = ss.getSheetByName(SHEET_COMPRADORES);

  let compradores = 0, ativos = 0, concluidos = 0;
  if (aba) {
    const dados = aba.getDataRange().getValues();
    compradores = Math.max(0, dados.length - 1);
    for (let i = 1; i < dados.length; i++) {
      if (dados[i][COL_COMP.ATIVO] === true)    ativos++;
      if (dados[i][COL_COMP.DIA_CONC] !== '') concluidos++;
    }
  }

  // Leads elegíveis para follow-up
  let followupPendente = 0;
  try {
    const crmData   = getSheet(SHEET_CRM).getDataRange().getValues();
    const headers   = crmData[0].map(h => String(h));
    const idxStatus = headers.indexOf('status');
    const idxCF     = headers.indexOf('custom_fields');
    const maxTent   = parseInt(getConfig_('followup_max_tentativas')) || 2;
    for (let i = 1; i < crmData.length; i++) {
      if (String(crmData[i][idxStatus]) !== 'Interessado') continue;
      let cf = {};
      try { cf = JSON.parse(String(crmData[i][idxCF] || '{}')); } catch(e) {}
      if ((parseInt(cf.followup_count) || 0) < maxTent) followupPendente++;
    }
  } catch(e) {}

  return { ok: true, data: { compradores, ativos, concluidos, followupPendente } };
}

// ══════════════════════════════════════════════════════════════
// SETUP TRIGGERS DE AUTOMAÇÃO
// ══════════════════════════════════════════════════════════════

function setupAutomacaoTriggers() {
  // Remove triggers antigos deste tipo para evitar duplicação
  ScriptApp.getProjectTriggers().forEach(t => {
    const fn = t.getHandlerFunction();
    if (['rotinaManha','rotinaNight','followUpLeadsSemResposta'].includes(fn)) {
      ScriptApp.deleteTrigger(t);
    }
  });

  // 05:30 Brasília
  ScriptApp.newTrigger('rotinaManha')
    .timeBased().atHour(5).nearMinute(30)
    .everyDays(1).inTimezone('America/Sao_Paulo').create();

  // 21:00 Brasília
  ScriptApp.newTrigger('rotinaNight')
    .timeBased().atHour(21).nearMinute(0)
    .everyDays(1).inTimezone('America/Sao_Paulo').create();

  // Follow-up: a cada hora
  ScriptApp.newTrigger('followUpLeadsSemResposta')
    .timeBased().everyHours(1).create();

  logAction('system','SETUP_AUTO_TRIGGERS','system','',
    'rotinaManha (05:30) + rotinaNight (21:00) + followUp (1h)');
  return { ok: true, message: 'Triggers de automação configurados.' };
}

// ── Helpers internos ─────────────────────────────────────────
function _auto21Ativa() {
  const v = getConfig_('automacao21_ativa');
  return v !== 'false' && v !== false;
}

function enviarMensagemGptV2_(telefone, mensagem) {
  const token   = String(getConfig_('gptmaker_token') || GPTMAKER_TOKEN_DEFAULT || '').trim();
  const agentId = String(getConfig_('gptmaker_bot_id') || GPTMAKER_BOT_ID_DEFAULT || '').trim();
  const digits  = _normalizarTelefoneGpt_(telefone);
  const result  = {
    ok: false,
    phone: digits,
    agentId: agentId,
    workspaceId: '',
    channelId: '',
    channelType: '',
    chatId: '',
    mode: '',
    endpoint: '',
    httpCode: 0,
    error: '',
    responseBody: ''
  };

  if (!token) {
    result.error = 'Token do GPT Maker nao configurado.';
    return _logResultadoGptMakerV2_(telefone, result);
  }
  if (!agentId) {
    result.error = 'Bot / Agent ID do GPT Maker nao configurado.';
    return _logResultadoGptMakerV2_(telefone, result);
  }
  if (!digits) {
    result.error = 'Telefone invalido para envio no GPT Maker.';
    return _logResultadoGptMakerV2_(telefone, result);
  }

  const workspaceRes = _resolverWorkspaceGptMaker_(token);
  if (!workspaceRes.ok) {
    result.error = workspaceRes.error;
    result.httpCode = workspaceRes.httpCode || 0;
    result.responseBody = workspaceRes.responseBody || '';
    result.endpoint = workspaceRes.endpoint || '';
    return _logResultadoGptMakerV2_(telefone, result);
  }
  result.workspaceId = workspaceRes.workspaceId;

  const chatRes = _buscarChatGptMakerPorTelefone_(token, result.workspaceId, agentId, digits);
  if (chatRes.ok && chatRes.chatId) {
    const sendRes = _enviarMensagemChatGptMaker_(token, chatRes.chatId, mensagem);
    result.chatId = chatRes.chatId;
    result.mode = 'send-message';
    result.endpoint = sendRes.endpoint;
    result.httpCode = sendRes.code;
    result.responseBody = sendRes.body;
    if (sendRes.ok) {
      result.ok = true;
      return _logResultadoGptMakerV2_(telefone, result);
    }

    const sendError = _extrairErroApi_(sendRes.body, 'Falha ao enviar mensagem para chat existente.');
    if (!_deveTentarStartConversation_(sendRes.code, sendError)) {
      result.error = sendError;
      return _logResultadoGptMakerV2_(telefone, result);
    }
  } else if (!chatRes.notFound) {
    result.error = chatRes.error || 'Falha ao localizar o chat no GPT Maker.';
    result.httpCode = chatRes.httpCode || result.httpCode;
    result.responseBody = chatRes.responseBody || result.responseBody;
    result.endpoint = chatRes.endpoint || result.endpoint;
    return _logResultadoGptMakerV2_(telefone, result);
  }

  const channelRes = _resolverCanalGptMaker_(token, agentId, result.workspaceId);
  if (!channelRes.ok) {
    result.error = channelRes.error;
    result.httpCode = channelRes.httpCode || result.httpCode;
    result.responseBody = channelRes.responseBody || result.responseBody;
    result.endpoint = channelRes.endpoint || result.endpoint;
    return _logResultadoGptMakerV2_(telefone, result);
  }

  result.channelId = channelRes.channelId;
  result.channelType = channelRes.channelType || '';

  const startRes = _iniciarConversaGptMaker_(token, result.channelId, digits, mensagem);
  result.mode = 'start-conversation';
  result.endpoint = startRes.endpoint;
  result.httpCode = startRes.code;
  result.responseBody = startRes.body;
  if (startRes.ok) {
    result.ok = true;
  } else {
    result.error = _extrairErroApi_(startRes.body, 'Falha ao iniciar conversa no GPT Maker.');
  }

  return _logResultadoGptMakerV2_(telefone, result);
}

function _resolverWorkspaceGptMaker_(token) {
  const cachedWorkspace = String(getConfig_('gptmaker_workspace_id') || '').trim();
  const endpoint = 'https://api.gptmaker.ai/v2/workspaces';
  const apiRes = _callGptMakerApiV2_('GET', endpoint, token);
  if (!apiRes.ok) {
    return {
      ok: false,
      error: _extrairErroApi_(apiRes.body, 'Falha ao listar workspaces do GPT Maker.'),
      httpCode: apiRes.code,
      responseBody: apiRes.body,
      endpoint: endpoint
    };
  }

  let workspaces = [];
  try { workspaces = JSON.parse(apiRes.body) || []; } catch (e) {}
  const matchedWorkspace = workspaces.find(item => String(item.id || '') === cachedWorkspace) || workspaces[0];
  if (!matchedWorkspace || !matchedWorkspace.id) {
    return { ok: false, error: 'Nenhum workspace encontrado para o token do GPT Maker.', endpoint: endpoint };
  }

  setConfig_('gptmaker_workspace_id', matchedWorkspace.id);
  return { ok: true, workspaceId: matchedWorkspace.id };
}

function _resolverCanalGptMaker_(token, agentId, workspaceId) {
  const cachedChannel = String(getConfig_('gptmaker_channel_id') || '').trim();
  const endpoint = 'https://api.gptmaker.ai/v2/workspace/' + encodeURIComponent(workspaceId) + '/channels';
  const apiRes = _callGptMakerApiV2_('GET', endpoint, token);
  if (!apiRes.ok) {
    return {
      ok: false,
      error: _extrairErroApi_(apiRes.body, 'Falha ao listar canais do GPT Maker.'),
      httpCode: apiRes.code,
      responseBody: apiRes.body,
      endpoint: endpoint
    };
  }

  let json = {};
  try { json = JSON.parse(apiRes.body) || {}; } catch (e) {}
  const channels = Array.isArray(json) ? json : (json.data || []);
  const connectedChannels = channels.filter(channel =>
    channel && channel.connected && /WHATSAPP|CLOUD_API|Z_API/i.test(String(channel.type || ''))
  );
  const matchedChannel = connectedChannels.find(channel => String(channel.id || '') === cachedChannel)
    || connectedChannels.find(channel => String(channel.agentId || '') === String(agentId))
    || connectedChannels[0];

  if (!matchedChannel || !matchedChannel.id) {
    return {
      ok: false,
      error: 'Nenhum canal WhatsApp conectado encontrado para o bot/agente informado.',
      endpoint: endpoint
    };
  }

  setConfig_('gptmaker_channel_id', matchedChannel.id);
  return {
    ok: true,
    channelId: matchedChannel.id,
    channelType: String(matchedChannel.type || '')
  };
}
