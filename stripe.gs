// ============================================================
// stripe.gs — Integração Stripe (assinaturas) — Desafio 21 Dias
// Migração Cakto → Stripe. Reaproveita a máquina de estados de
// assinaturas.gs (AS.* / _upsertAssinatura_ / _syncAcesso_).
// ------------------------------------------------------------
// Config (PropertiesService, NUNCA no fonte):
//   STRIPE_SECRET_KEY  = sk_live_... ou rk_live_... (restrita com escrita
//                        em Products/Prices/Subscriptions/Checkout/Portal/Webhooks)
// Verificação de webhook: o GAS não expõe headers, então autenticamos
// RE-BUSCANDO o evento na API (GET /v1/events/{id}) — método oficial.
// Dev: Claude Code, sob comando de David Ramon.
// ============================================================

var STRIPE_API = 'https://api.stripe.com';

// Price IDs (identificadores públicos, não são segredo) — conta WPK Tavares
var STRIPE_PRICES = {
  monthly:   'price_1TpShoFbaBx75eKpYMOjvdmO',  // R$17/mês
  quarterly: 'price_1TpShpFbaBx75eKpYfCFZbaZ',  // R$47/trim
  yearly:    'price_1TpShqFbaBx75eKpiExujEAS',  // R$177/ano
};
var STRIPE_RETURN_URL       = 'https://app.wpktavares.com.br/app?view=assinatura';
var STRIPE_SUCCESS_URL      = 'https://app.wpktavares.com.br/app?view=assinatura&checkout=sucesso&provider=stripe';
var STRIPE_CANCEL_URL       = 'https://app.wpktavares.com.br/app?view=assinatura&checkout=cancelado&provider=stripe';
// v99: URLs para /planos (iniciadas da pagina de planos, nao da SPA)
var STRIPE_PLANOS_SUCCESS_URL = 'https://wpktavares.com.br/planos?checkout=sucesso&provider=stripe';
var STRIPE_PLANOS_CANCEL_URL  = 'https://wpktavares.com.br/planos?checkout=cancelado';
// v106: pagina de obrigado do comprador novo (confirma a compra + proximos passos)
var STRIPE_OBRIGADO_URL       = 'https://wpktavares.com.br/obrigado/';

// ── Config / setup ───────────────────────────────────────────
function _stripeKey_() {
  return PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY') || '';
}
function stripeConfigurado_() { return !!_stripeKey_(); }

// ── Chamada à API Stripe (form-encoded) ──────────────────────
function _stripeEncode_(obj) {
  if (typeof obj === 'string') return obj;
  return Object.keys(obj).map(function(k){
    return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]);
  }).join('&');
}
function _stripeCall_(method, path, params) {
  var key = _stripeKey_();
  if (!key) return { _error: true, message: 'STRIPE_SECRET_KEY não configurada.' };
  var opts = { method: method, headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true };
  if (params) { opts.contentType = 'application/x-www-form-urlencoded'; opts.payload = _stripeEncode_(params); }
  var resp = UrlFetchApp.fetch(STRIPE_API + path, opts);
  var code = resp.getResponseCode();
  var json; try { json = JSON.parse(resp.getContentText()); } catch (e) { json = {}; }
  if (code >= 200 && code < 300) return json;
  return { _error: true, code: code, message: (json.error && json.error.message) || ('HTTP ' + code) };
}

function _stripeResp_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────
// WEBHOOK — chamado de code.gs quando o payload é um evento Stripe
// (raw.object === 'event'). Autentica re-buscando o evento na API.
// ─────────────────────────────────────────────────────────────
function processStripeEvent_(raw) {
  var eventId = raw && raw.id;
  if (!eventId || !stripeConfigurado_()) {
    return _stripeResp_({ ok: false, error: 'nao verificado' });
  }
  // Re-fetch = autenticação (id inexistente na conta => forjado => rejeita)
  var ev = _stripeCall_('get', '/v1/events/' + encodeURIComponent(eventId));
  if (!ev || ev._error || !ev.type) {
    try { if (typeof tgEnviarErro_ === 'function') tgEnviarErro_('Stripe webhook', '🚨 Evento não verificado (' + eventId + ')'); } catch (_t) {}
    return _stripeResp_({ ok: false, error: 'unauthorized' });
  }
  // Dedup (Stripe reenvia em falha)
  if (_dedupWebhook_(ev.type, ev.id)) return _stripeResp_({ ok: true, dedup: true });

  var obj = (ev.data && ev.data.object) || {};
  try {
    switch (ev.type) {
      case 'checkout.session.completed':        _stripeOnCheckout_(obj); break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.resumed':     _stripeOnSubSync_(obj); break;
      case 'customer.subscription.deleted':     _stripeOnSubDeleted_(obj); break;
      case 'customer.subscription.paused':      _stripeOnSubPaused_(obj); break;
      case 'customer.subscription.trial_will_end': _stripeOnTrialWillEnd_(obj); break;
      case 'invoice.paid':                      _stripeOnInvoicePaid_(obj); break;
      case 'invoice.payment_failed':            _stripeOnInvoiceFailed_(obj); break;
      // v141: confirma que o cartao ficou salvo no Customer
      case 'payment_method.attached':           _stripeOnPmAttached_(obj); break;
      default: /* ignora */ break;
    }
  } catch (e) {
    logAction('system', 'STRIPE_EVENT_ERRO', 'webhook', ev.type, e.message);
    try { if (typeof tgEnviarErro_ === 'function') tgEnviarErro_('Stripe ' + ev.type, e.message); } catch (_t) {}
  }
  return _stripeResp_({ ok: true, type: ev.type });
}

// ── Handlers de evento ───────────────────────────────────────
function _stripeOnCheckout_(session) {
  if (session.mode && session.mode !== 'subscription') return;
  var email = (session.customer_details && session.customer_details.email) || session.customer_email || '';
  var subId = session.subscription;
  if (!subId) return;
  var sub = _stripeCall_('get', '/v1/subscriptions/' + encodeURIComponent(subId) + '?expand[]=items.data.price');
  if (!sub || sub._error) return;
  if (!email && sub.customer) {
    var cus = _stripeCall_('get', '/v1/customers/' + encodeURIComponent(sub.customer));
    email = (cus && cus.email) || '';
  }
  _stripeSyncAssinatura_(email, sub, true);
}

function _stripeOnSubSync_(sub)    { _stripeSyncAssinatura_(_stripeEmailDaSub_(sub), sub, false); }
function _stripeOnSubDeleted_(sub) {
  var email = _stripeEmailDaSub_(sub);
  if (!email) return;
  _upsertAssinatura_(email, { cakto_status: 'canceled', app_status: AS.CANCELLED, blocked_at: new Date().toISOString() });
  _syncAcesso_(email, AS.CANCELLED);
  logAction('system', 'STRIPE_CANCELADA', 'assinatura', email, sub.id || '');
  _stripeNotif_('🚫 Assinatura CANCELADA\n' + email);
}
function _stripeOnSubPaused_(sub) {
  var email = _stripeEmailDaSub_(sub);
  if (!email) return;
  _upsertAssinatura_(email, { cakto_status: 'paused', app_status: AS.PAUSED });
  _syncAcesso_(email, AS.PAUSED);
  _stripeNotif_('⏸️ Assinatura PAUSADA\n' + email);
}
function _stripeOnTrialWillEnd_(sub) {
  var email = _stripeEmailDaSub_(sub);
  if (email) _stripeNotif_('⏰ Trial terminando em breve\n' + email);
}
function _stripeOnInvoicePaid_(inv) {
  // Só renovação (a 1ª compra é tratada no checkout.session.completed)
  if (String(inv.billing_reason || '') !== 'subscription_cycle') return;
  var email = inv.customer_email || '';
  var subId = inv.subscription;
  if (!subId) return;
  var sub = _stripeCall_('get', '/v1/subscriptions/' + encodeURIComponent(subId) + '?expand[]=items.data.price');
  if (sub && !sub._error) {
    if (!email) email = _stripeEmailDaSub_(sub);
    _stripeSyncAssinatura_(email, sub, false);
  }
  _stripeNotif_('🔁 Assinatura RENOVADA\n' + (email || '') + '  ·  R$ ' + ((inv.amount_paid || 0) / 100).toFixed(2).replace('.', ','));
}
function _stripeOnInvoiceFailed_(inv) {
  var email = inv.customer_email || '';
  var subId = inv.subscription;
  if (subId) {
    var sub = _stripeCall_('get', '/v1/subscriptions/' + encodeURIComponent(subId) + '?expand[]=items.data.price');
    if (sub && !sub._error) { if (!email) email = _stripeEmailDaSub_(sub); _stripeSyncAssinatura_(email, sub, false); }
  }
  _stripeNotif_('⚠️ Falha de pagamento\n' + (email || ''));
}

// ── Sincroniza uma subscription Stripe → aba assinaturas ─────
function _stripeSyncAssinatura_(email, sub, isNew) {
  email = String(email || '').toLowerCase().trim();
  if (!email) return;

  var appStatus = _stripeMapStatus_(sub.status);
  var item      = (sub.items && sub.items.data && sub.items.data[0]) || {};
  var price     = item.price || {};
  var plan      = _stripePlanFromPrice_(price.id);
  var amount    = (price.unit_amount != null) ? (price.unit_amount / 100) : '';
  var nextBill  = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : '';
  var trialEnd  = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : '';

  // v96: idempotencia + suporte a migracao Cakto -> Stripe
  // Se estamos migrando (cache hit em CacheService) E a assinatura Cakto do mesmo
  // email ja existe: cancelamos a Cakto via API (idempotente) depois de salvar
  // a Stripe. Evita dupla cobranca.
  var isMigrating = false;
  try {
    var rawMig = CacheService.getScriptCache().get('migrating_' + email);
    if (rawMig) {
      isMigrating = true;
      // invalida apos usar — webhook so consome 1x
      CacheService.getScriptCache().remove('migrating_' + email);
    }
  } catch (e) {}

  var upd = {
    sub_id:       sub.id,
    cakto_status: sub.status,      // reusa a coluna p/ status bruto do gateway
    app_status:   appStatus,
    plan:         plan,
    next_billing: nextBill,
    amount:       amount,
  };
  if (appStatus === AS.TRIAL) {
    upd.trial_end = trialEnd || nextBill;
    upd.trial_rem = _calcTrialRemaining_(upd.trial_end);
  }
  if (appStatus === AS.ACTIVE) { upd.failed_at = ''; upd.grace_day = 0; upd.blocked_at = ''; }

  // Marca Provider=stripe via subscription_hub (idempotente — se já criado a aba)
  try {
    if (typeof ensureSubscriptionHubColumns_ === 'function') ensureSubscriptionHubColumns_();
    upd.provider = 'stripe';
  } catch (e) {}

  _upsertAssinatura_(email, upd);

  // v105 (P0): garante a linha em `compradores` ANTES do _syncAcesso_.
  // _syncAcesso_ so ATUALIZA linha existente; e getAlunoByToken_ exige essa
  // linha. Sem ela o aluno paga, recebe a senha, loga — e trava em
  // "comprador nao encontrado". So cria quando o status da acesso.
  if ([AS.TRIAL, AS.ACTIVE, AS.GRACE, AS.GRACE_FINAL].indexOf(appStatus) !== -1) {
    try { _garantirCompradorStripe_(email, sub); }
    catch (e) { logAction('system', 'STRIPE_COMPRADOR_ERRO', 'assinatura', email, e.message); }
  }

  _syncAcesso_(email, appStatus);

  // Migração: apos Stripe ativo, cancela Cakto na origem
  if (isMigrating && appStatus === AS.ACTIVE) {
    try {
      if (typeof _cancelarCaktoPorEmail_ === 'function') _cancelarCaktoPorEmail_(email);
    } catch (e) { logAction('system', 'MIGRATE_CAKTO_CANCEL_ERR', 'assinatura', email, e.message); }
  }

  if (isNew) {
    try {
      var criouLogin = _garantirLoginAluno_(email);
      // v106: quem JA tinha conta nao recebia comunicacao nenhuma ao assinar.
      // Agora recebe confirmacao — sem tocar na senha dele.
      if (!criouLogin && typeof _enviarConfirmacaoAssinatura_ === 'function') {
        var nomeAtual = '';
        try {
          var us = sheetToObjects(getSheet(SHEET_USERS));
          var uu = us.find(function (x) {
            return String(x.email || '').toLowerCase().trim() === email;
          });
          if (uu) nomeAtual = String(uu.name || '');
        } catch (e2) {}
        _enviarConfirmacaoAssinatura_(email, nomeAtual, plan);
      }
    } catch (e) { logAction('system', 'STRIPE_LOGIN_ERRO', 'assinatura', email, e.message); }
    if (appStatus === AS.TRIAL) _stripeNotif_('🎁 NOVO TRIAL (' + (plan || '') + ')\n' + email);
    else                        _stripeNotif_('🎉 NOVA ASSINATURA (' + (plan || '') + ')\n' + email + '  ·  R$ ' + (amount || '0'));
    // Meta CAPI — evento de compra server-side
    try {
      if (appStatus !== AS.TRIAL && typeof enviarEventoCapi_ === 'function') {
        enviarEventoCapi_('Purchase', { email: email, event_id: 'stripe_' + sub.id,
          custom: { content_name: 'Desafio 21 Dias ' + (plan || ''), currency: 'BRL', value: amount || 0 } });
      }
    } catch (e) {}
  }
  logAction('system', 'STRIPE_SYNC_' + appStatus.toUpperCase(), 'assinatura', email, plan || sub.status);
}

// Idempotente: cancela a assinatura Cakto ativa do email (se houver)
// chamado apos Stripe confirmar a migracao. Falhas sao logadas, nao quebram o flow.
function _cancelarCaktoPorEmail_(email) {
  if (!_caktoApiConfigurado_) return;
  var row = _getAssinaturaRow_(email);
  if (!row) return;
  var subId = String(row[_ASS_.SUB_ID] || '');
  if (!_subIdReal_(subId)) return;
  try {
    var r = _caktoApiCall_('post', '/public_api/subscriptions/' + encodeURIComponent(subId) + '/cancel/');
    logAction(email, 'CAKTO_MIGRATED_CANCEL', 'assinatura', subId, 'code=' + r.code);
  } catch (e) {
    logAction(email, 'CAKTO_MIGRATED_CANCEL_ERR', 'assinatura', subId, e.message);
  }
}

function _stripeEmailDaSub_(sub) {
  if (!sub) return '';
  if (sub.customer_email) return sub.customer_email;
  var custId = (typeof sub.customer === 'string') ? sub.customer : (sub.customer && sub.customer.id);
  if (!custId) return '';
  var cus = _stripeCall_('get', '/v1/customers/' + encodeURIComponent(custId));
  return (cus && !cus._error && cus.email) ? cus.email : '';
}

// ─────────────────────────────────────────────────────────────
// v105 (P0): assinante Stripe PRECISA de linha na aba compradores.
// O fluxo Cakto criava via processWebhookCakto_; o Stripe nunca criou.
// Idempotente por e-mail (nao duplica quem veio da Cakto).
// ─────────────────────────────────────────────────────────────
function _garantirCompradorStripe_(email, sub) {
  email = String(email || '').toLowerCase().trim();
  if (!email) return false;

  var aba = getSpreadsheet_().getSheetByName(SHEET_COMPRADORES) || initCompradoresSheet_();
  if (aba.getLastRow() >= 2) {
    var dados = aba.getDataRange().getValues();
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][COL_COMP.EMAIL] || '').toLowerCase().trim() === email) return false;
    }
  }

  var info = _stripeCustomerInfo_(sub);
  salvarComprador_(
    (sub && sub.id) || ('stripe_' + email),   // OrderId = id da subscription
    email, 'paid', info.nome, info.telefone, nowISO(), 'Desafio 21 Dias'
  );
  logAction('system', 'STRIPE_COMPRADOR_CRIADO', 'comprador', email, (sub && sub.id) || '');
  return true;
}

// Nome/telefone do customer Stripe (para preencher a linha de comprador).
function _stripeCustomerInfo_(sub) {
  var out = { nome: '', telefone: '' };
  try {
    var custId = sub && ((typeof sub.customer === 'string') ? sub.customer
                                                            : (sub.customer && sub.customer.id));
    if (!custId) return out;
    var cus = _stripeCall_('get', '/v1/customers/' + encodeURIComponent(custId));
    if (cus && !cus._error) {
      out.nome     = String(cus.name  || '');
      out.telefone = String(cus.phone || '');
    }
  } catch (e) {}
  return out;
}

// ─────────────────────────────────────────────────────────────
// v105: DIAGNOSTICO (somente leitura) — quem tem assinatura com
// acesso liberado mas NAO tem linha em compradores, ou seja, esta
// trancado fora do app agora. Rode no editor GAS.
// ─────────────────────────────────────────────────────────────
function diagnosticarCompradoresFaltando() {
  var r = _varrerCompradoresFaltando_(false);
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}

// v105: REPARO — cria a linha de comprador que falta. Aditivo:
// nunca altera nem apaga linha existente. Rode no editor GAS.
function repararCompradoresFaltando() {
  var r = _varrerCompradoresFaltando_(true);
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}

function _varrerCompradoresFaltando_(aplicar) {
  var ss  = getSpreadsheet_();
  var aSh = ss.getSheetByName(SHEET_ASSINATURAS);
  if (!aSh) return { ok: false, error: 'Aba assinaturas ausente.' };

  var cSh = ss.getSheetByName(SHEET_COMPRADORES) || initCompradoresSheet_();
  var comprEmails = {};
  if (cSh.getLastRow() >= 2) {
    var cRows = cSh.getDataRange().getValues();
    for (var i = 1; i < cRows.length; i++) {
      var ce = String(cRows[i][COL_COMP.EMAIL] || '').toLowerCase().trim();
      if (ce) comprEmails[ce] = true;
    }
  }

  var comAcesso = [AS.TRIAL, AS.ACTIVE, AS.GRACE, AS.GRACE_FINAL];
  var aRows = aSh.getDataRange().getValues();
  var faltando = [], reparados = [];
  var totalAssinaturas = Math.max(0, aRows.length - 1);
  var totalComAcesso = 0, statusVistos = {};

  for (var j = 1; j < aRows.length; j++) {
    var email  = String(aRows[j][_ASS_.EMAIL] || '').toLowerCase().trim();
    var status = String(aRows[j][_ASS_.APP_STATUS] || '');
    statusVistos[status || '(vazio)'] = (statusVistos[status || '(vazio)'] || 0) + 1;
    if (!email || comAcesso.indexOf(status) === -1) continue;
    totalComAcesso++;
    if (comprEmails[email]) continue;

    var subId = String(aRows[j][_ASS_.SUB_ID] || '');
    faltando.push({ email: email, status: status, sub_id: subId });

    if (aplicar) {
      try {
        var sub = null;
        if (subId.indexOf('sub_') === 0) {
          var s = _stripeCall_('get', '/v1/subscriptions/' + encodeURIComponent(subId));
          if (s && !s._error) sub = s;
        }
        if (!sub) sub = { id: subId || ('stripe_' + email) };
        _garantirCompradorStripe_(email, sub);
        comprEmails[email] = true;
        reparados.push(email);
      } catch (e) {
        logAction('system', 'REPARO_COMPRADOR_ERRO', 'comprador', email, e.message);
      }
    }
  }

  return {
    ok: true,
    modo: aplicar ? 'reparo' : 'diagnostico',
    // Totais: distinguem "ninguem trancado" de "nada foi examinado".
    // Se totalAssinaturas=0, o scan nao viu nada — resultado NAO conclusivo.
    totalAssinaturas: totalAssinaturas,
    totalComprado: Object.keys(comprEmails).length,
    totalComAcesso: totalComAcesso,
    statusEncontrados: statusVistos,
    totalTrancados: faltando.length,
    trancados: faltando,
    reparados: reparados
  };
}

function _stripeMapStatus_(s) {
  switch (String(s || '')) {
    case 'trialing':  return AS.TRIAL;
    case 'active':    return AS.ACTIVE;
    case 'past_due':  return AS.GRACE;
    case 'paused':    return AS.PAUSED;
    case 'canceled':  return AS.CANCELLED;
    case 'unpaid':    return AS.BLOCKED;
    default:          return AS.BLOCKED; // incomplete / incomplete_expired
  }
}
function _stripePlanFromPrice_(priceId) {
  for (var k in STRIPE_PRICES) if (STRIPE_PRICES[k] === priceId) return k;
  return '';
}
function _stripeNotif_(msg) {
  try { if (typeof tgEnviar_ === 'function') tgEnviar_('💳 *Stripe*\n' + msg); } catch (e) {}
}

// ─────────────────────────────────────────────────────────────
// ROTA (auth): getStripePortal — abre o Billing Portal oficial
// (com return_url — o usuário volta pro app automaticamente)
// ─────────────────────────────────────────────────────────────
function getStripePortal(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  if (!stripeConfigurado_()) return { ok: false, error: 'Pagamento indisponível no momento.' };

  var row   = _getAssinaturaRow_(user.email);
  var subId = row ? String(row[_ASS_.SUB_ID] || '') : '';
  if (!/^sub_/.test(subId)) return { ok: false, error: 'Nenhuma assinatura Stripe ativa encontrada.' };

  var sub = _stripeCall_('get', '/v1/subscriptions/' + encodeURIComponent(subId));
  if (sub._error) return { ok: false, error: 'Não foi possível abrir o portal agora. Tente novamente.' };

  var sess = _stripeCall_('post', '/v1/billing_portal/sessions', {
    customer: sub.customer, return_url: STRIPE_SUCCESS_URL, locale: 'pt-BR',
  });
  if (sess._error) {
    var precisaConfig = /configuration/i.test(sess.message || '');
    return { ok: false, error: precisaConfig
      ? 'Portal ainda não ativado no Stripe (ative em Configurações → Billing → Portal do cliente).'
      : (sess.message || 'Portal indisponível.') };
  }
  return { ok: true, url: sess.url };
}

// ─────────────────────────────────────────────────────────────
// ROTA: setupStripeStatus — retorna diagnostico (sem expor secrets)
// Use para confirmar se STRIPE_SECRET_KEY esta persistida.
// Ex.: { ok: true, hasKey: true, keyPrefix: 'sk_live_xxxxx', pricesConfigured: 3, webhookConfigured: false }
// ─────────────────────────────────────────────────────────────
function setupStripeStatus() {
  var key = _stripeKey_();
  var prefix = key ? key.slice(0, 10) + '...' + key.slice(-4) : '';
  return {
    ok: true,
    hasKey: !!key,
    isLive: key ? key.indexOf('sk_live_') === 0 || key.indexOf('rk_live_') === 0 : false,
    isTest: key ? key.indexOf('sk_test_') === 0 || key.indexOf('rk_test_') === 0 : false,
    keyPrefix: prefix,
    pricesConfigured: Object.keys(STRIPE_PRICES).length,
    priceValues: STRIPE_PRICES,
    urls: {
      success: STRIPE_SUCCESS_URL,
      cancel:  STRIPE_CANCEL_URL,
      return:  STRIPE_RETURN_URL
    }
  };
}

// ─────────────────────────────────────────────────────────────
// ROTA (pública): criarCheckoutStripe — cria sessão de checkout
// data: { plan:'monthly|quarterly|yearly', trialDays:0|7|14|21,
//         email?, origin?: 'app'|'planos', intent?: 'new'|'migration'|'upgrade' }
// ─────────────────────────────────────────────────────────────
function criarCheckoutStripe(data) {
  if (!stripeConfigurado_()) return { ok: false, error: 'Pagamento indisponível no momento.' };
  var plan  = String((data && data.plan) || 'monthly');
  var price = STRIPE_PRICES[plan] || STRIPE_PRICES.monthly;
  var trial = parseInt((data && data.trialDays) || 0);
  // v141: 30 dias entrou na spec do trial com cartao
  if (TC_TRIALS_VALIDOS.indexOf(trial) < 0) trial = 0;

  // v101: URLs dinamicas baseadas na origem.
  //   origin 'app'     = SPA (usa STRIPE_SUCCESS_URL com view=assinatura)
  //   origin 'planos'  = URL absoluta para /planos
  //   origin 'custom'  = URL passada via data.returnUrl (landing envia sua propria URL exata)
  // Cada landing agora pode voltar PRA ELA MESMA ao cancelar/sucesso.
  var origin = String((data && data.origin) || 'app').toLowerCase();
  var intent = String((data && data.intent) || 'new').toLowerCase();
  var successUrl, cancelUrl;
  if (origin === 'planos') {
    successUrl = STRIPE_PLANOS_SUCCESS_URL;
    cancelUrl = STRIPE_PLANOS_CANCEL_URL;
  } else if (origin === 'custom' && data && data.returnUrl) {
    // v101: valida dominio confiavel (whitelist).
    var _u = String(data.returnUrl);
    if (function(_u){ try { var _h = new URL(_u); return _h.protocol === 'https:' && new RegExp('//(app|www)?.?wpktavares.com.br/?').test(_h.host); } catch (e) { return false; } }(_u)) {
      var _sep = _u.indexOf(String.fromCharCode(63)) >= 0 ? '&' : String.fromCharCode(63);
      successUrl = _u + _sep + 'checkout=sucesso&provider=stripe';
      cancelUrl  = _u + _sep + 'checkout=cancelado&provider=stripe';
    } else {
      // dominio nao confiavel -> cai no default app
      successUrl = STRIPE_SUCCESS_URL;
      cancelUrl  = STRIPE_CANCEL_URL;
    }
  } else {
    successUrl = STRIPE_SUCCESS_URL;
    cancelUrl = STRIPE_CANCEL_URL;
  }

  // v106: comprador NOVO cai na pagina de obrigado (confirma a compra, mostra
  // os proximos passos e deixa criar a senha na hora). Upgrade/migracao voltam
  // pro app — quem ja esta logado nao precisa de onboarding.
  if (intent === 'new') {
    successUrl = STRIPE_OBRIGADO_URL + '?session_id={CHECKOUT_SESSION_ID}';
  }

  var params = {
    'mode': 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    'success_url': successUrl,
    'cancel_url': cancelUrl,
    'allow_promotion_codes': 'true',
    'locale': 'pt-BR',
    'billing_address_collection': 'auto',
  };
  if (data && data.email) params['customer_email'] = String(data.email);
  if (trial > 0) params['subscription_data[trial_period_days]'] = String(trial);

  // v99: metadata para o webhook saber o que fazer (origem + intent)
  if (data && data.email) {
    params['metadata[email]'] = String(data.email);
  }
  params['metadata[origin]'] = origin;
  params['metadata[intent]'] = intent;
  params['metadata[plan]']   = plan;

  var resp = _stripeCall_('post', '/v1/checkout/sessions', params);
  if (resp._error) return { ok: false, error: resp.message || 'Erro ao abrir checkout.' };
  if (!resp.id || !resp.url) return { ok: false, error: 'Resposta invalida do Stripe.' };
  return { ok: true, sessionId: resp.id, url: resp.url };
}

// ─────────────────────────────────────────────────────────────
// v106 ROTA (pública): confirmarCheckoutStripe — a página
// /obrigado/ chama com o session_id devolvido pelo Stripe.
// Valida a sessão NA API (não confia no que vem pela URL) e diz
// à página o que mostrar.
//
// Retorna:
//   pago              — pagamento confirmado (ou trial sem cobrança)
//   nome/email/plano  — para personalizar a tela
//   precisaCriarSenha — há link de acesso pendente (comprador novo)
//   prontoNoApp       — já existe login (webhook processou)
// ─────────────────────────────────────────────────────────────
function confirmarCheckoutStripe(sessionId) {
  sessionId = String(sessionId || '').trim();
  if (!sessionId || sessionId.indexOf('cs_') !== 0) {
    return { ok: false, error: 'Sessão inválida.' };
  }
  if (!stripeConfigurado_()) return { ok: false, error: 'Pagamento indisponível no momento.' };

  var s = _stripeCall_('get', '/v1/checkout/sessions/' + encodeURIComponent(sessionId));
  if (!s || s._error) return { ok: false, error: 'Não encontramos essa compra.' };

  // 'paid' = cobrado · 'no_payment_required' = trial sem cartão
  var pago = (String(s.status || '') === 'complete') &&
             (['paid', 'no_payment_required'].indexOf(String(s.payment_status || '')) !== -1);

  var email = String((s.customer_details && s.customer_details.email) || s.customer_email || '')
                .toLowerCase().trim();
  var nome  = String((s.customer_details && s.customer_details.name) || '');
  var plano = String((s.metadata && s.metadata.plan) || '');

  var temLogin = false;
  if (email) {
    try {
      var users = sheetToObjects(getSheet(SHEET_USERS));
      temLogin = !!users.find(function (u) {
        return String(u.email || '').toLowerCase().trim() === email;
      });
    } catch (e) {}
  }

  return {
    ok: true,
    pago: pago,
    nome: nome,
    email: email,
    plano: plano,
    precisaCriarSenha: email ? _temTokenAcessoPendente_(email) : false,
    prontoNoApp: temLogin
  };
}

// Há link de "criar senha" ainda válido e não usado para este e-mail?
function _temTokenAcessoPendente_(email) {
  try {
    email = String(email || '').toLowerCase().trim();
    var sh = getSpreadsheet_().getSheetByName(SHEET_RESET_CODES);
    if (!sh || sh.getLastRow() < 2) return false;

    var dados   = sh.getDataRange().getValues();
    var headers = dados[0].map(function (h) { return String(h); });
    var iEmail  = headers.indexOf('email');
    var iCode   = headers.indexOf('code');
    var iExp    = headers.indexOf('expires_at');
    var iUsed   = headers.indexOf('used');
    var agora   = new Date();

    for (var i = dados.length - 1; i >= 1; i--) {
      if (String(dados[i][iEmail] || '').toLowerCase().trim() !== email) continue;
      if (String(dados[i][iCode] || '').length < 20) continue;   // ignora código de 6 dígitos
      if (dados[i][iUsed] === true) continue;
      if (new Date(dados[i][iExp]) > agora) return true;
    }
  } catch (e) {}
  return false;
}
