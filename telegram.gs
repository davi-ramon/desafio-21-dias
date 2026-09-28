// ============================================================
// telegram.gs — Bot de notificações + comandos (Desafio 21 Dias)
// Camada 1: notificações automáticas (trials, vendas, erros)
// Camada 2: comandos /status /vendas /trials
//
// SETUP (rodar 1x no editor): setupTelegram()  → grava token+chat
//                             tgConfigurarWebhook() → ativa comandos
// ============================================================

var TG_CHAT_PADRAO = '-5169638006'; // grupo "App Desafio 21 Dias - Atualizações"

// ─────────────────────────────────────────────────────────────
// SETUP — grava token do bot no PropertiesService (rodar 1x)
// ─────────────────────────────────────────────────────────────
function setupTelegram() {
  var TOKEN = 'COLE_O_TOKEN_DO_BOT_AQUI'; // ⬅️ cole o token @waguin2_bot e execute
  var CHAT  = '-5169638006';

  if (TOKEN === 'COLE_O_TOKEN_DO_BOT_AQUI') {
    Logger.log('⚠️ Cole o token do bot na variável TOKEN antes de executar.');
    return;
  }
  var p = PropertiesService.getScriptProperties();
  p.setProperty('TG_TOKEN', TOKEN);
  p.setProperty('TG_CHAT', CHAT);
  Logger.log('✅ Telegram configurado (chat ' + CHAT + ').');
  Logger.log('→ Agora rode tgConfigurarWebhook() p/ ativar os comandos.');
  return 'OK';
}

function _tgToken_() { return PropertiesService.getScriptProperties().getProperty('TG_TOKEN') || ''; }
function _tgChat_()  { return PropertiesService.getScriptProperties().getProperty('TG_CHAT') || TG_CHAT_PADRAO; }

// ─────────────────────────────────────────────────────────────
// ENVIO de mensagem (HTML)
// ─────────────────────────────────────────────────────────────
function tgEnviar_(texto, chatId) {
  try {
    var token = _tgToken_();
    if (!token) return;
    UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        chat_id: chatId || _tgChat_(),
        text: texto,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      muteHttpExceptions: true,
    });
  } catch(e) { /* nunca quebra o fluxo principal por causa de notificação */ }
}

// Notificação de ERRO (usada nos catch do sistema)
function tgEnviarErro_(contexto, mensagem) {
  tgEnviar_('🔴 <b>ERRO no sistema</b>\n<b>Onde:</b> ' + _tgEsc_(contexto) +
            '\n<b>Detalhe:</b> ' + _tgEsc_(String(mensagem).slice(0, 400)) +
            '\n<i>' + _tgAgora_() + '</i>');
}

function _tgEsc_(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function _tgAgora_() {
  return Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM HH:mm');
}
function _tgPlanoNome_(plan) {
  var m = { monthly:'Mensal (R$17)', quarterly:'Trimestral (R$47)', yearly:'Anual (R$177)' };
  return m[plan] || plan || '—';
}

// ─────────────────────────────────────────────────────────────
// CAMADA 1 — Notificações automáticas
// ─────────────────────────────────────────────────────────────

// Novo trial gratuito (chamado por registrarTrial_)
// v166: `extra` opcional diz por onde a pessoa entrou (rota, aparelho,
// campanha) e se autorizou contato. Sem ele, a mensagem é a de sempre.
function tgNotificarTrial_(nome, email, whatsapp, dias, extra) {
  var origem = '';
  if (extra && extra.rota) {
    origem = '🧭 ' + _tgEsc_(extra.rotaNome || extra.rota) +
             (extra.dispositivo ? ' · ' + _tgEsc_(extra.dispositivo) : '') + '\n' +
             (extra.campanha ? '📣 ' + _tgEsc_(extra.campanha) + '\n' : '') +
             (extra.consentiu ? '' : '⚠️ Sem autorização de contato — WhatsApp não enviado\n');
  }
  tgEnviar_('🎁 <b>Novo Trial — ' + dias + ' dias grátis</b>\n' +
            '👤 ' + _tgEsc_(nome) + '\n' +
            '📧 ' + _tgEsc_(email) + '\n' +
            '📱 +' + _tgEsc_(String(whatsapp || '').replace(/^\+/, '')) + '\n' +
            origem +
            '<i>' + _tgAgora_() + '</i>');
}

// Eventos de assinatura (chamado por processWebhookAssinatura_)
function tgNotificarAssinatura_(eventType, email, d, sub) {
  try {
    var nome  = (d && (d.customer && d.customer.name || d.name)) || email;
    var plan  = (sub && sub.plan) || (d && d.plan) || '';
    var msg = null;

    switch (eventType) {
      case 'purchase_approved':
      case 'subscription_created':
        msg = '💰 <b>NOVA VENDA — Assinatura</b>\n👤 ' + _tgEsc_(nome) + '\n📧 ' + _tgEsc_(email);
        break;
      case 'subscription_renewed':
        msg = '🔄 <b>Assinatura Renovada</b>\n👤 ' + _tgEsc_(nome) + '\n📧 ' + _tgEsc_(email);
        break;
      case 'subscription_renewal_refused':
      case 'purchase_refused':
      case 'payment_failed':
      case 'subscription_payment_failed':
        msg = '⚠️ <b>Pagamento Recusado</b>\n👤 ' + _tgEsc_(nome) + '\n📧 ' + _tgEsc_(email);
        break;
      case 'subscription_canceled':
      case 'subscription_cancelled':
      case 'purchase_cancelled':
        msg = '❌ <b>Assinatura Cancelada</b>\n👤 ' + _tgEsc_(nome) + '\n📧 ' + _tgEsc_(email);
        break;
      case 'chargeback':
        msg = '🔴 <b>CHARGEBACK</b>\n👤 ' + _tgEsc_(nome) + '\n📧 ' + _tgEsc_(email);
        break;
      case 'refund':
      case 'subscription_refunded':
        msg = '↩️ <b>Reembolso</b>\n👤 ' + _tgEsc_(nome) + '\n📧 ' + _tgEsc_(email);
        break;
    }
    if (msg) tgEnviar_(msg + '\n<i>' + _tgAgora_() + '</i>');
  } catch(e) {}
}

// ─────────────────────────────────────────────────────────────
// CAMADA 2 — Comandos (/status /vendas /trials)
// Recebe o update do Telegram via doPost (webhook)
// ─────────────────────────────────────────────────────────────
function tgProcessarUpdate_(update) {
  try {
    var msg = update.message || update.edited_message;
    if (!msg || !msg.text) return ContentService.createTextOutput('ok');
    var texto  = String(msg.text).trim().toLowerCase();
    var chatId = msg.chat.id;
    var cmd = texto.split('@')[0].split(' ')[0]; // /status@bot → /status

    var resposta;
    if (cmd === '/status')      resposta = _tgRelatorioStatus_();
    else if (cmd === '/vendas') resposta = _tgRelatorioVendas_();
    else if (cmd === '/trials') resposta = _tgRelatorioTrials_();
    else if (cmd === '/start' || cmd === '/ajuda' || cmd === '/help')
      resposta = '🤖 <b>Bot Desafio 21 Dias</b>\n\nComandos:\n' +
                 '/status — visão geral\n/vendas — vendas e receita\n/trials — trials ativos';
    else return ContentService.createTextOutput('ok');

    tgEnviar_(resposta, chatId);
    return ContentService.createTextOutput('ok');
  } catch(e) {
    return ContentService.createTextOutput('ok');
  }
}

// lê a aba assinaturas e agrega
function _tgAgregarAssinaturas_() {
  var r = { trial:0, active:0, grace:0, blocked:0, cancelled:0, t7:0, t14:0, t21:0, mrr:0 };
  try {
    var sh = getSheet(SHEET_ASSINATURAS);
    var rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var st  = String(rows[i][_ASS_.APP_STATUS] || '');
      var dd  = parseInt(rows[i][_ASS_.TRIAL_DAYS] || 0);
      var amt = parseFloat(rows[i][_ASS_.AMOUNT] || 0) || 0;
      if (st === AS.TRIAL)        { r.trial++; if(dd===7)r.t7++; else if(dd===14)r.t14++; else if(dd===21)r.t21++; }
      else if (st === AS.ACTIVE)  { r.active++; r.mrr += amt; }
      else if (st === AS.GRACE || st === AS.GRACE_FINAL) r.grace++;
      else if (st === AS.BLOCKED) r.blocked++;
      else if (st === AS.CANCELLED) r.cancelled++;
    }
  } catch(e) {}
  return r;
}

// novos cadastros de hoje (aba compradores, CREATED_AT)
function _tgNovosHoje_() {
  var n = 0;
  try {
    var hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
    var comp = getSpreadsheet_().getSheetByName(SHEET_COMPRADORES);
    if (!comp) return 0;
    var rows = comp.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var c = String(rows[i][COL_COMP.CREATED_AT] || '');
      if (c.slice(0,10) === hoje) n++;
    }
  } catch(e) {}
  return n;
}

function _tgRelatorioStatus_() {
  var a = _tgAgregarAssinaturas_();
  return '📊 <b>Status — Desafio 21 Dias</b>\n' +
         '<i>' + _tgAgora_() + '</i>\n\n' +
         '🎁 Trials ativos: <b>' + a.trial + '</b>\n' +
         '✅ Assinantes pagos: <b>' + a.active + '</b>\n' +
         '🟡 Em atraso (grace): <b>' + a.grace + '</b>\n' +
         '🔒 Bloqueados: <b>' + a.blocked + '</b>\n' +
         '❌ Cancelados: <b>' + a.cancelled + '</b>\n' +
         '🆕 Novos cadastros hoje: <b>' + _tgNovosHoje_() + '</b>\n' +
         '💵 Receita recorrente estimada: <b>R$ ' + a.mrr.toFixed(0) + '/mês</b>';
}
function _tgRelatorioVendas_() {
  var a = _tgAgregarAssinaturas_();
  return '💰 <b>Vendas — Desafio 21 Dias</b>\n' +
         '<i>' + _tgAgora_() + '</i>\n\n' +
         '✅ Assinantes pagos: <b>' + a.active + '</b>\n' +
         '🆕 Novos cadastros hoje: <b>' + _tgNovosHoje_() + '</b>\n' +
         '💵 MRR estimado: <b>R$ ' + a.mrr.toFixed(0) + '/mês</b>';
}
function _tgRelatorioTrials_() {
  var a = _tgAgregarAssinaturas_();
  return '🎁 <b>Trials ativos</b>\n' +
         '<i>' + _tgAgora_() + '</i>\n\n' +
         '7 dias: <b>' + a.t7 + '</b>\n' +
         '14 dias: <b>' + a.t14 + '</b>\n' +
         '21 dias: <b>' + a.t21 + '</b>\n' +
         '— — —\nTotal: <b>' + a.trial + '</b>';
}

// ─────────────────────────────────────────────────────────────
// WEBHOOK — aponta o bot pro Web App do GAS (rodar 1x)
// ─────────────────────────────────────────────────────────────
function tgConfigurarWebhook() {
  var token = _tgToken_();
  if (!token) { Logger.log('❌ Rode setupTelegram() primeiro.'); return; }
  var url = ScriptApp.getService().getUrl(); // URL do Web App atual
  var resp = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/setWebhook', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ url: url, allowed_updates: ['message'] }),
    muteHttpExceptions: true,
  });
  Logger.log('Webhook → ' + url + '\n' + resp.getContentText());
}

// Teste manual
function tgTeste() {
  tgEnviar_('🤖 Teste manual do bot — ' + _tgAgora_());
  return 'enviado';
}
