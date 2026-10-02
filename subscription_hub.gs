// ============================================================
// subscription_hub.gs — Gateway Agnostic Subscription Hub (v96)
// Camada acima de cakto_portal.gs + stripe.gs. Decide qual
// provider usar e expõe um unico endpoint pro app:
//   getAssinaturaHub(token) -> { provider, status, plano, trial,
//                                urls: { manager, migrate } }
//
// Migracao unidirecional: Cakto -> Stripe (nova assinatura Stripe
// e cancelamento da Cakto via API pos-pagamento).
// ============================================================

// Helper: detecta provider da assinatura atual (pelo sheet local)
function _hubProvider_(email) {
  var row = _getAssinaturaRow_(email);
  if (!row) return 'cakto'; // default: novos usuarios vem pela Cakto ate migrar
  // Coluna "Provider" opcional (criada via ensureSubscriptionHubColumns_).
  // Se nao existir, tenta inferir pela existencia de StripeSubId.
  var colProvider = _hubColumnIndex_(row, 'Provider');
  if (colProvider >= 0 && row[colProvider]) return String(row[colProvider]).toLowerCase();
  // Heuristica legado
  var stripeCol = _hubColumnIndex_(row, 'StripeSubId');
  if (stripeCol >= 0 && row[stripeCol]) return 'stripe';
  return 'cakto';
}

// Garante coluna 'Provider' (e extras do hub). Idempotente.
function ensureSubscriptionHubColumns_() {
  var sh = initAssinaturasSheet_();
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var extras = ['Provider', 'StripeCustomerId', 'StripeSubId', 'MigradoEm', 'CaktoSubLegacy'];
  var added = 0;
  extras.forEach(function(h) {
    if (headers.indexOf(h) === -1) {
      sh.getRange(1, headers.length + 1 + added).setValue(h);
      added++;
    }
  });
  if (added > 0) {
    sh.getRange(1, 1, 1, sh.getLastColumn())
      .setFontWeight('bold').setBackground('#4a148c').setFontColor('#ffffff');
  }
}

// Helper de indice de coluna por nome (ou -1 se nao existe)
function _hubColumnIndex_(row, name) {
  // row is array of headers (1a linha da aba)
  // Aqui row == headers[] direto
  if (!Array.isArray(row)) return -1;
  return row.indexOf(name);
}

// ============================================================
// ROTA: getAssinaturaHub — retorna o estado unificado + URLs
// ============================================================
function getAssinaturaHub(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };

  ensureSubscriptionHubColumns_();
  var sh = initAssinaturasSheet_();
  var data = sh.getDataRange().getValues();
  var headers = data[0];

  // Encontra linha do usuario
  var rowIdx = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').toLowerCase() === String(user.email || '').toLowerCase()) {
      rowIdx = i; break;
    }
  }
  var row = rowIdx >= 0 ? data[rowIdx] : [];
  var colByName = function(name) { return headers.indexOf(name); };

  // Provider
  var providerCol = colByName('Provider');
  var provider = (providerCol >= 0 && row[providerCol]) ? String(row[providerCol]).toLowerCase() : 'cakto';

  // Dados basicos
  var local = checkAcessoPremium_(user.email);
  var out = {
    ok: true,
    provider: provider,
    status: local.status || (row[1] ? String(row[1]) : ''),
    appStatus: local.status,
    plano: local.plan || (row[4] ? String(row[4]) : ''),
    trialEnd: local.trialEnd || (row[6] ? String(row[6]) : ''),
    trialRestantes: local.trialRemaining || (row[8] ? Number(row[8]) : 0),
    proxCobranca: local.nextBilling || '',
    valor: local.amount || (row[14] ? String(row[14]) : ''),
    banner: local.banner || null,
    cakto: { ativo: false, portalUrl: '' },
    stripe: { ativo: false, checkoutUrl: '', portalUrl: '' }
  };

  // URLs
  var CAKTO_PORTAL_URL_DEFIN = (typeof CAKTO_PORTAL_URL !== 'undefined') ? CAKTO_PORTAL_URL : '';
  out.cakto.portalUrl = CAKTO_PORTAL_URL_DEFIN;
  if (provider === 'cakto') {
    out.cakto.ativo = true;
  } else if (provider === 'stripe') {
    out.stripe.ativo = true;
    if (typeof getStripePortal === 'function') {
      try {
        var p = getStripePortal(token);
        if (p && p.ok && p.data && p.data.url) out.stripe.portalUrl = p.data.url;
      } catch (e) { /* silencioso */ }
    }
  }

  return { ok: true, data: out };
}

// ============================================================
// ROTA: iniciarMigracaoStripe — gera URL de checkout Stripe
// para migrar usuario Cakto → Stripe (mesmo produto, mesmo valor)
// ============================================================
function iniciarMigracaoStripe(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  if (typeof criarCheckoutStripe !== 'function') return { ok: false, error: 'Stripe nao configurado.' };

  // Detecta plano atual da assinatura Cakto
  var local = checkAcessoPremium_(user.email);
  var planoAtual = local.plan || '';
  var planoMap = { 'Mensal': 'monthly', 'mensal': 'monthly', 'Trimestral': 'quarterly', 'trimestral': 'quarterly', 'Anual': 'yearly', 'anual': 'yearly' };
  var planKey = planoMap[planoAtual] || (data && data.plan) || 'monthly';

  // Mesmo trial zero (usuario ja usou, nao ganha novo)
  var args = { plan: planKey, trialDays: 0, email: user.email };
  var res = criarCheckoutStripe(args);
  if (!res || !res.ok) return res;

  // Marcar como "em migracao" para o webhook saber o que fazer
  ensureSubscriptionHubColumns_();
  try {
    var cache = CacheService.getScriptCache();
    cache.put('migrating_' + user.email, JSON.stringify({
      from: 'cakto',
      plan: planKey,
      ts: Date.now()
    }), 3600); // 1h TTL
  } catch (e) {}

  return { ok: true, url: res.url || res.checkout_url, sessionId: res.sessionId, plano: planKey };
}
