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
var STRIPE_RETURN_URL  = 'https://app.wpktavares.com.br';
var STRIPE_SUCCESS_URL = 'https://app.wpktavares.com.br/?assinatura=sucesso';
var STRIPE_CANCEL_URL  = 'https://wpktavares.com.br/planos/';

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
  _syncAcesso_(email, appStatus);

  // Migração: apos Stripe ativo, cancela Cakto na origem
  if (isMigrating && appStatus === AS.ACTIVE) {
    try {
      if (typeof _cancelarCaktoPorEmail_ === 'function') _cancelarCaktoPorEmail_(email);
    } catch (e) { logAction('system', 'MIGRATE_CAKTO_CANCEL_ERR', 'assinatura', email, e.message); }
  }

  if (isNew) {
    try { _garantirLoginAluno_(email); } catch (e) { logAction('system', 'STRIPE_LOGIN_ERRO', 'assinatura', email, e.message); }
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
    customer: sub.customer, return_url: STRIPE_RETURN_URL, locale: 'pt-BR',
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
// data: { plan:'monthly|quarterly|yearly', trialDays:0|7|14|21, email? }
// ─────────────────────────────────────────────────────────────
function criarCheckoutStripe(data) {
  if (!stripeConfigurado_()) return { ok: false, error: 'Pagamento indisponível no momento.' };
  var plan  = String((data && data.plan) || 'monthly');
  var price = STRIPE_PRICES[plan] || STRIPE_PRICES.monthly;
  var trial = parseInt((data && data.trialDays) || 0);
  if ([7, 14, 21].indexOf(trial) < 0) trial = 0;

  var params = {
    'mode': 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    'success_url': STRIPE_SUCCESS_URL,
    'cancel_url': STRIPE_CANCEL_URL,
    'allow_promotion_codes': 'true',
    'locale': 'pt-BR',
    'billing_address_collection': 'auto',
  };
  if (data && data.email) params['customer_email'] = String(data.email);
  if (trial > 0) params['subscription_data[trial_period_days]'] = String(trial);

  var resp = _stripeCall_('post', '/v1/checkout/sessions', params);
  if (resp._error) return { ok: false, error: resp.message || 'Erro ao abrir checkout.' };
  if (!resp.id || !resp.url) return { ok: false, error: 'Resposta invalida do Stripe.' };
  return { ok: true, sessionId: resp.id, url: resp.url };
}
