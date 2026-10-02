// ============================================================
// wa_webhook.gs — o que acontece DEPOIS do "aceito" (v173)
// ------------------------------------------------------------
// A API da Meta só diz que ACEITOU a mensagem. Se ela chegou, foi
// lida ou falhou (e por quê), e se a pessoa respondeu, vem depois,
// por webhook. Até a v172 esses avisos iam só para o app dono do
// token (GPT Maker): o sistema dizia "enviado" sem saber se a
// mensagem tinha chegado — e 9 de 10 boas-vindas morreram assim
// entre 01 e 02/10 sem ninguém ver.
//
// Aqui: cada envio aceito vira uma linha em wa_envios; o webhook
// atualiza essa linha (entregue / lido / não chegou + motivo), o
// histórico do lead e o aviso do Telegram; e a primeira resposta da
// pessoa avisa o grupo (a conversa está aberta).
//
// O Apps Script não expõe headers, então não dá para conferir a
// assinatura X-Hub-Signature-256. Por isso: status só vale para
// mensagem que NÓS enviamos (wamid em wa_envios) e mensagem recebida
// só vale se veio para o NOSSO número (phone_number_id). A Meta
// reenvia o aviso quando não recebe 200 (o Apps Script responde 302):
// tudo aqui é idempotente.
// ============================================================

var WA_ENVIOS = 'wa_envios';
var WA_ENVIOS_CAB = ['quando', 'wamid', 'para', 'wa_id', 'template', 'tipo', 'email', 'nome', 'lead_id',
                     'status', 'status_em', 'erro_codigo', 'erro_motivo', 'tg_msg_id', 'tg_texto'];
var WE = { QUANDO: 0, WAMID: 1, PARA: 2, WAID: 3, TPL: 4, TIPO: 5, EMAIL: 6, NOME: 7, LEAD: 8,
           STATUS: 9, STATUS_EM: 10, ERRO_COD: 11, ERRO_MOT: 12, TG_ID: 13, TG_TXT: 14 };
var WA_ST_ORDEM = { aceito: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
var WA_ENVIOS_MAX = 3000;

function _waEnviosAba_() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(WA_ENVIOS);
  if (!sh) {
    sh = ss.insertSheet(WA_ENVIOS);
    sh.appendRow(WA_ENVIOS_CAB);
    sh.getRange(1, 1, 1, WA_ENVIOS_CAB.length).setFontWeight('bold')
      .setBackground('#1b5e20').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Chamado por _waEnviarTemplate_ quando a Meta ACEITA o pedido
function _waEnvioRegistrar_(d) {
  try {
    if (!d || !d.wamid) return;
    var sh = _waEnviosAba_();
    sh.appendRow([nowISO(), d.wamid, String(d.para || ''), String(d.waId || ''), d.template || '', d.tipo || '',
                  d.email || '', d.nome || '', d.leadId || '', 'aceito', nowISO(), '', '', '', '']);
    var ult = sh.getLastRow();
    if (ult > WA_ENVIOS_MAX + 500) sh.deleteRows(2, ult - 1 - WA_ENVIOS_MAX);
  } catch (e) {}
}

function _waEnvioAchar_(sh, wamid) {
  var ult = sh.getLastRow();
  if (ult < 2 || !wamid) return 0;
  var de = Math.max(2, ult - 1500);
  var ids = sh.getRange(de, WE.WAMID + 1, ult - de + 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === String(wamid)) return de + i;
  return 0;
}

// O aviso do Telegram sai logo depois do envio: guarda o id dele para
// editar a linha do WhatsApp quando a Meta disser o que aconteceu.
function _waEnvioVincularTg_(wamid, msgId, texto) {
  if (!wamid || !msgId) return;
  var lock = LockService.getScriptLock();
  try { lock.waitLock(8000); } catch (e) { return; }
  try {
    var sh = _waEnviosAba_(), linha = _waEnvioAchar_(sh, wamid);
    if (!linha) return;
    sh.getRange(linha, WE.TG_ID + 1, 1, 2).setValues([[String(msgId), String(texto || '')]]);
    // o webhook pode ter chegado antes do aviso: já mostra o estado real
    var row = sh.getRange(linha, 1, 1, WA_ENVIOS_CAB.length).getValues()[0];
    var st = String(row[WE.STATUS] || 'aceito');
    if (st !== 'aceito' && typeof tgEditar_ === 'function') {
      tgEditar_(msgId, String(texto).replace('{{WA}}', _waLinhaTg_(st, row[WE.ERRO_MOT], row[WE.STATUS_EM])));
    }
  } catch (e) {
  } finally { try { lock.releaseLock(); } catch (e2) {} }
}

// ── Linha do WhatsApp no aviso do Telegram ───────────────────
function _waLinhaTg_(status, motivo, quando) {
  var h = '';
  try { h = quando ? ' (' + Utilities.formatDate(new Date(quando), 'America/Sao_Paulo', 'HH:mm') + ')' : ''; } catch (e) {}
  switch (String(status)) {
    case 'sent':      return '📤 WhatsApp saiu da Meta — ainda não chegou no celular da pessoa' + h;
    case 'delivered': return '✅ WhatsApp ENTREGUE' + h;
    case 'read':      return '✅ WhatsApp entregue e LIDO' + h;
    case 'failed':    return '❌ WhatsApp NÃO chegou — ' + _tgEscWa_(motivo || 'a Meta não entregou');
    default:
      return _waWebhookAtivo_()
        ? '📤 WhatsApp aceito pela Meta — confirmando a entrega…'
        : '📤 WhatsApp aceito pela Meta — entrega NÃO confirmada (o sistema ainda não recebe o aviso de entrega)';
  }
}
function _tgEscWa_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// O motivo de não ter chegado, em português (códigos da entrega)
function waMotivoEntrega_(erro) {
  var cod = String((erro && erro.code) || '');
  var extra = {
    '131042': 'problema de pagamento na conta do WhatsApp (sem forma de pagamento válida no WhatsApp Manager)',
    '131045': 'o número de envio ainda não está registrado na API',
    '131048': 'a Meta limitou os envios: muitas mensagens bloqueadas ou denunciadas',
    '131050': 'a pessoa pediu para não receber mensagens de marketing desta empresa',
    '131051': 'tipo de mensagem não suportado',
    '131052': 'falha ao baixar a mídia da mensagem',
    '131053': 'falha na mídia (imagem/vídeo) do template',
    '131021': 'o número de destino é o próprio número da empresa',
    '131031': 'a conta do WhatsApp está bloqueada pela Meta',
    '130497': 'a conta não pode enviar para esse país',
    '368': 'conta temporariamente bloqueada por violação de política',
    '131000': 'erro interno da Meta — tente de novo mais tarde',
    '135000': 'erro genérico da Meta ao entregar'
  }[cod];
  if (extra) return extra + ' (#' + cod + ')';
  var texto = '(#' + cod + ') ' + String((erro && (erro.title || erro.message)) || '') +
              ((erro && erro.error_data && erro.error_data.details) ? ' — ' + erro.error_data.details : '');
  var pt = (typeof ritoMotivo_ === 'function') ? ritoMotivo_(texto) : texto;
  return /^a Meta recusou/.test(pt) ? texto.slice(0, 200) : pt + (cod ? ' (#' + cod + ')' : '');
}

// ── Verificação (GET) ────────────────────────────────────────
// A Meta chama ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…
function waWebhookVerificar_(e) {
  var p = (e && e.parameter) || {};
  var esperado = _waWebhookToken_(false);
  if (p['hub.mode'] === 'subscribe' && esperado && String(p['hub.verify_token'] || '') === esperado) {
    try { PropertiesService.getScriptProperties().setProperty('WA_WEBHOOK_VERIFICADO_EM', nowISO()); } catch (x) {}
    return ContentService.createTextOutput(String(p['hub.challenge'] || ''));
  }
  return ContentService.createTextOutput('forbidden');
}

function _waWebhookToken_(criar) {
  var pr = PropertiesService.getScriptProperties();
  var t = pr.getProperty('WA_WEBHOOK_VERIFY');
  if (!t && criar) { t = 'wpk' + Utilities.getUuid().replace(/-/g, ''); pr.setProperty('WA_WEBHOOK_VERIFY', t); }
  return t || '';
}

function _waWebhookAtivo_() {
  try {
    var u = PropertiesService.getScriptProperties().getProperty('WA_WEBHOOK_ULTIMO');
    return !!u && (Date.now() - new Date(u).getTime()) < 7 * 86400000;
  } catch (e) { return false; }
}

// ── Avisos (POST) ────────────────────────────────────────────
function waWebhookProcessar_(raw) {
  var out = ContentService.createTextOutput(JSON.stringify({ ok: true }));
  out.setMimeType(ContentService.MimeType.JSON);
  try {
    var meuNumero = _waPhone_();
    var valeu = false;
    (raw.entry || []).forEach(function (en) {
      (en.changes || []).forEach(function (ch) {
        if (!ch || ch.field !== 'messages' || !ch.value) return;
        var v = ch.value;
        var pid = v.metadata && v.metadata.phone_number_id;
        if (!pid || String(pid) !== String(meuNumero)) return;   // só o nosso número
        valeu = true;
        (v.statuses || []).forEach(function (st) { try { _waWebhookStatus_(st); } catch (e1) {} });
        var perfis = {};
        (v.contacts || []).forEach(function (c) { if (c && c.wa_id) perfis[c.wa_id] = (c.profile && c.profile.name) || ''; });
        (v.messages || []).forEach(function (m) { try { _waWebhookMensagem_(m, perfis[m.from] || ''); } catch (e2) {} });
      });
    });
    if (valeu) PropertiesService.getScriptProperties().setProperty('WA_WEBHOOK_ULTIMO', nowISO());
  } catch (e) {
    try { logAction('system', 'WA_WEBHOOK_ERRO', 'whatsapp', '', String(e.message || e)); } catch (x) {}
  }
  return out;
}

function _waWebhookStatus_(st) {
  var wamid = String((st && st.id) || ''), status = String((st && st.status) || '');
  if (!wamid || !(status in WA_ST_ORDEM) || status === 'aceito') return;
  var cache = CacheService.getScriptCache(), chave = 'wa_st_' + wamid.slice(-60) + '_' + status;
  if (cache.get(chave)) return;                       // a Meta reenviou o mesmo aviso

  var lock = LockService.getScriptLock();
  try { lock.waitLock(8000); } catch (e) { return; }  // sem a trava, a Meta manda de novo depois
  var envio = null, mudou = false;
  try {
    var sh = _waEnviosAba_(), linha = _waEnvioAchar_(sh, wamid);
    if (!linha) { cache.put(chave, '1', 21600); return; }   // não fomos nós que mandamos
    var row = sh.getRange(linha, 1, 1, WA_ENVIOS_CAB.length).getValues()[0];
    var atual = String(row[WE.STATUS] || 'aceito');
    // a ordem pode chegar trocada (lido antes de entregue): só anda para frente
    if (atual === 'failed' || (status !== 'failed' && WA_ST_ORDEM[status] <= (WA_ST_ORDEM[atual] || 0))) {
      cache.put(chave, '1', 21600);
      return;
    }
    var erro = (st.errors && st.errors[0]) || null;
    var cod = erro ? String(erro.code || '') : '', motivo = erro ? waMotivoEntrega_(erro) : '';
    var quando = st.timestamp ? new Date(Number(st.timestamp) * 1000).toISOString() : nowISO();
    sh.getRange(linha, WE.STATUS + 1, 1, 4).setValues([[status, quando, cod, motivo]]);
    if (st.recipient_id && !row[WE.WAID]) sh.getRange(linha, WE.WAID + 1).setValue(String(st.recipient_id));
    envio = { para: String(row[WE.PARA]), template: String(row[WE.TPL]), tipo: String(row[WE.TIPO]),
              email: String(row[WE.EMAIL]), nome: String(row[WE.NOME]), lead: String(row[WE.LEAD]),
              tgId: String(row[WE.TG_ID] || ''), tgTxt: String(row[WE.TG_TXT] || ''), quando: quando, motivo: motivo };
    mudou = true;
    cache.put(chave, '1', 21600);
  } finally { try { lock.releaseLock(); } catch (e3) {} }
  if (!mudou || !envio) return;

  // Histórico do lead: entregue, lido e falhou (o "saiu" seria ruído)
  if (status !== 'sent') {
    var texto = status === 'delivered' ? 'WhatsApp: "' + envio.template + '" ENTREGUE'
              : status === 'read'      ? 'WhatsApp: "' + envio.template + '" entregue e LIDO'
              : 'WhatsApp: "' + envio.template + '" NÃO chegou — ' + envio.motivo;
    var lead = _waAcharLeadCrm_(envio.lead, envio.email, envio.para);
    if (lead && typeof _crmHistorico_ === 'function') _crmHistorico_(lead.linha, texto, 'WhatsApp');
  }
  // Telegram: a linha do aviso original muda; falha também avisa de novo
  if (envio.tgId && envio.tgTxt && typeof tgEditar_ === 'function') {
    tgEditar_(envio.tgId, envio.tgTxt.replace('{{WA}}', _waLinhaTg_(status, envio.motivo, envio.quando)));
  }
  if (status === 'failed' && envio.tipo !== 'teste do painel' && typeof tgEnviar_ === 'function') {
    var fone = envio.para.replace(/\D/g, '');
    tgEnviar_('❌ <b>WhatsApp NÃO chegou</b>' + (envio.nome ? ' — ' + _tgEscWa_(envio.nome) : '') + '\n' +
              '📱 +' + _tgEscWa_(fone) + (envio.template ? ' · ' + _tgEscWa_(envio.template) : '') + '\n' +
              'Motivo: ' + _tgEscWa_(envio.motivo) + '\n' +
              '👉 Fale com a pessoa: https://wa.me/' + fone);
  }
}

function _waWebhookMensagem_(m, nomePerfil) {
  var id = String((m && m.id) || ''), de = String((m && m.from) || '').replace(/\D/g, '');
  if (!id || !de) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('wa_in_' + id.slice(-60))) return;
  cache.put('wa_in_' + id.slice(-60), '1', 21600);

  var tipo = String(m.type || '');
  var texto = tipo === 'text' ? (m.text && m.text.body)
            : tipo === 'button' ? (m.button && (m.button.text || m.button.payload))
            : tipo === 'interactive' ? ((m.interactive && (m.interactive.button_reply || m.interactive.list_reply) || {}).title)
            : tipo === 'reaction' ? ('reagiu ' + ((m.reaction && m.reaction.emoji) || ''))
            : '[' + (tipo || 'mensagem') + ']';
  texto = String(texto || '').replace(/\s+/g, ' ').trim().slice(0, 300);

  // Só a primeira mensagem da conversa avisa (6 h): o grupo não vira chat
  var chave = 'wa_conv_' + _waNormBr_(de);
  if (cache.get(chave)) return;
  cache.put(chave, '1', 21600);

  var lead = _waAcharLeadCrm_('', '', de);
  var nome = (lead && lead.nome) || nomePerfil || '';
  if (lead && typeof _crmHistorico_ === 'function') _crmHistorico_(lead.linha, 'WhatsApp: respondeu — "' + texto.slice(0, 160) + '"', 'WhatsApp');
  if (typeof tgEnviar_ === 'function') {
    tgEnviar_('💬 <b>' + (_tgEscWa_(nome) || 'Alguém') + ' respondeu no WhatsApp</b>' + (lead ? '' : ' (não está no CRM)') + '\n' +
              '“' + _tgEscWa_(texto) + '”\n' +
              '📱 +' + _tgEscWa_(de) + '\n' +
              'A conversa está aberta (24 h): responda pelo WhatsApp Business.\nhttps://wa.me/' + de);
  }
}

// ── Número e lead ────────────────────────────────────────────
// No Brasil o WhatsApp pode identificar o celular SEM o 9 (wa_id de 12
// dígitos). Compara sempre na forma com o 9.
function _waNormBr_(d) {
  d = String(d || '').replace(/\D/g, '');
  if (d.indexOf('55') === 0 && d.length === 12 && /[6-9]/.test(d.charAt(4))) d = d.slice(0, 4) + '9' + d.slice(4);
  return d;
}

function _waAcharLeadCrm_(leadId, email, fone) {
  try {
    var sh = getSheet(SHEET_CRM);
    var dados = sh.getDataRange().getValues();
    if (dados.length < 2) return null;
    var cab = dados[0].map(String);
    var iId = cab.indexOf('id'), iNome = cab.indexOf('name'), iEmail = cab.indexOf('email'), iFone = cab.indexOf('phone');
    var em = String(email || '').toLowerCase().trim(), fn = _waNormBr_(fone);
    var porEmail = 0, porFone = 0;
    for (var i = dados.length - 1; i >= 1; i--) {
      if (leadId && iId >= 0 && String(dados[i][iId]) === String(leadId)) return { linha: i + 1, nome: String(dados[i][iNome] || '') };
      if (!porEmail && em && iEmail >= 0 && String(dados[i][iEmail]).toLowerCase().trim() === em) porEmail = i;
      if (!porFone && fn.length >= 12 && iFone >= 0 && _waNormBr_(dados[i][iFone]) === fn) porFone = i;
    }
    var k = porEmail || porFone;
    return k ? { linha: k + 1, nome: String(dados[k][iNome] || '') } : null;
  } catch (e) { return null; }
}

// ── Rotas do admin ───────────────────────────────────────────
// Últimos envios com o estado REAL de cada um
function waEnvios(token, data) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  var sh = _waEnviosAba_(), ult = sh.getLastRow();
  var lim = Math.min(Number((data && data.limite) || 40), 200);
  var lista = [];
  if (ult >= 2) {
    var de = Math.max(2, ult - lim + 1);
    sh.getRange(de, 1, ult - de + 1, WA_ENVIOS_CAB.length).getValues().reverse().forEach(function (r) {
      lista.push({ quando: r[WE.QUANDO], para: String(r[WE.PARA]), waId: String(r[WE.WAID]), template: String(r[WE.TPL]),
                   tipo: String(r[WE.TIPO]), nome: String(r[WE.NOME]), status: String(r[WE.STATUS] || 'aceito'),
                   statusEm: r[WE.STATUS_EM], motivo: String(r[WE.ERRO_MOT] || '') });
    });
  }
  return { ok: true, data: lista, webhookAtivo: _waWebhookAtivo_() };
}

// Liga a conta do WhatsApp (WABA) ao app do token: sem isso a Meta não
// manda os avisos desse número para o app (POST subscribed_apps).
function waWebhookAssinar(token) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  if (!_waPronto_()) return { ok: false, error: 'Configure token, WABA ID e Phone ID antes.' };
  var r = _waCall_('post', '/' + encodeURIComponent(_waWaba_()) + '/subscribed_apps');
  if (r._error) return { ok: false, error: 'A Meta recusou: ' + r.message };
  try { CacheService.getScriptCache().remove(WA_SAUDE_CACHE); } catch (e) {}
  logAction(user.email, 'WA_WEBHOOK_ASSINADO', 'whatsapp', _waWaba_(), JSON.stringify(r).slice(0, 200));
  return { ok: true, message: 'Conta do WhatsApp ligada ao app do token. Os avisos de entrega começam a chegar nos próximos envios.' };
}

// O que colar na Meta para o sistema receber os avisos de entrega
function waWebhookInfo(token) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  var pr = PropertiesService.getScriptProperties();
  return { ok: true, data: {
    url: (typeof _waSaudeUrlExec_ === 'function' && _waSaudeUrlExec_()) || '',
    verifyToken: _waWebhookToken_(true),
    verificadoEm: pr.getProperty('WA_WEBHOOK_VERIFICADO_EM') || '',
    ultimoAviso: pr.getProperty('WA_WEBHOOK_ULTIMO') || '',
    ativo: _waWebhookAtivo_()
  } };
}
