// ============================================================
// billing.gs — Visão unificada de assinatura (v150)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// getAssinaturaDetalhe (cakto_portal.gs) nasceu focado na Cakto:
// para assinante Stripe ele só devolve o que está na planilha,
// sem bandeira do cartão, últimos 4 dígitos ou periodicidade —
// justamente os campos que a tela nova precisa mostrar.
//
// Esta rota fala com o provedor CERTO de cada aluno e devolve um
// formato único, para a tela não ter que saber de qual gateway o
// dado veio.
// ============================================================

function _blNorm_(e) { return String(e || '').toLowerCase().trim(); }

function _blDataBR_(v) {
  if (!v) return '';
  try {
    var d = (typeof v === 'number') ? new Date(v * 1000) : new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return Utilities.formatDate(d, 'America/Sao_Paulo', 'dd/MM/yyyy');
  } catch (e) { return String(v); }
}

// Qual gateway manda na assinatura deste aluno
function _blProvedor_(email, linha) {
  // Uma assinatura Stripe viva é a fonte mais confiável: se existe,
  // é ela que cobra, mesmo que a linha antiga da Cakto ainda esteja lá.
  try {
    if (stripeConfigurado_()) {
      var cli = _stripeCall_('get', '/v1/customers?email=' + encodeURIComponent(email) + '&limit=1');
      if (cli && cli.data && cli.data.length) {
        var subs = _stripeCall_('get', '/v1/subscriptions?customer=' +
          encodeURIComponent(cli.data[0].id) + '&status=all&limit=5&expand[]=data.default_payment_method');
        if (subs && subs.data && subs.data.length) {
          var viva = subs.data.filter(function (s) {
            return ['active', 'trialing', 'past_due', 'unpaid', 'paused'].indexOf(s.status) >= 0;
          })[0] || subs.data[0];
          if (viva) return { nome: 'stripe', customer: cli.data[0], sub: viva };
        }
        return { nome: 'stripe', customer: cli.data[0], sub: null };
      }
    }
  } catch (e) {}
  if (linha) return { nome: 'cakto' };
  return { nome: 'nenhum' };
}

// ─────────────────────────────────────────────────────────────
// ROTA: getBillingDetalhe
// ─────────────────────────────────────────────────────────────
function getBillingDetalhe(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  var email = _blNorm_(user.email);

  var out = {
    assinante: {
      nome: String(user.name || ''),
      email: user.email,
      id: String(user.id || ''),
      cadastro: _blDataBR_(user.created_at)
    },
    assinatura: null,
    provedor: 'nenhum',
    provedores: [],
    podeCancelarNoApp: false,
    portalDisponivel: false,
    avisos: []
  };

  var linha = null;
  try { linha = _getAssinaturaRow_(email); } catch (e) {}

  var prov = _blProvedor_(email, linha);
  out.provedor = prov.nome;

  // ── Stripe ────────────────────────────────────────────────
  if (prov.nome === 'stripe' && prov.sub) {
    var s = prov.sub;
    var item = (s.items && s.items.data && s.items.data[0]) || {};
    var price = item.price || {};
    var pm = s.default_payment_method || null;
    if (typeof pm === 'string') {
      try { pm = _stripeCall_('get', '/v1/payment_methods/' + encodeURIComponent(pm)); } catch (e) { pm = null; }
    }
    var card = (pm && pm.card) || null;

    out.assinatura = {
      status: s.status,
      statusLabel: _blLabelStatus_(s.status),
      plano: (price.nickname || _stripePlanFromPrice_(price.id) || 'Mensal'),
      preco: price.unit_amount != null ? (price.unit_amount / 100).toFixed(2).replace('.', ',') : '',
      moeda: String(price.currency || 'brl').toUpperCase(),
      periodicidade: _blPeriodo_(price.recurring),
      inicio: _blDataBR_(s.start_date),
      trialFim: s.trial_end ? _blDataBR_(s.trial_end) : '',
      emTrial: s.status === 'trialing',
      proximaCobranca: _blDataBR_(s.current_period_end),
      metodo: card ? 'Cartão' : (pm ? String(pm.type) : ''),
      bandeira: card ? String(card.brand || '').toUpperCase() : '',
      ultimos4: card ? String(card.last4 || '') : '',
      cancelaNoFim: !!s.cancel_at_period_end,
      pausada: !!(s.pause_collection),
      id: s.id
    };
    out.podeCancelarNoApp = true;
    out.portalDisponivel = true;
    if (s.cancel_at_period_end) {
      out.avisos.push('Sua assinatura será encerrada em ' + _blDataBR_(s.current_period_end) +
                      '. Até lá o acesso continua.');
    }

  // ── Cakto ─────────────────────────────────────────────────
  } else if (prov.nome === 'cakto') {
    var det = null;
    try { det = getAssinaturaDetalhe(token); } catch (e) {}
    var d = (det && det.data) || {};
    out.assinatura = {
      status: d.status || '',
      statusLabel: _blLabelStatus_(d.status),
      plano: _blPlanoLabel_(d.plan),
      preco: d.amount ? String(d.amount).replace('.', ',') : '',
      moeda: 'BRL',
      periodicidade: d.recurrencePeriod ? (d.recurrencePeriod + ' dias') : _blPeriodoDoPlano_(d.plan),
      inicio: '',
      trialFim: d.trialEnd ? _blDataBR_(d.trialEnd) : '',
      emTrial: String(d.status) === 'trial',
      trialRestante: d.trialRemaining,
      proximaCobranca: d.nextBilling ? _blDataBR_(d.nextBilling) : '',
      metodo: d.paymentMethod || '',
      bandeira: '', ultimos4: '',
      cancelaNoFim: false,
      pausada: String(d.status) === 'paused',
      id: ''
    };
    out.podeCancelarNoApp = !!d.podeCancelarNoApp;
    out.portalDisponivel = !!d.portalUrl;
    out.portalUrl = d.portalUrl || '';
    if (d.notaApi) out.avisos.push(d.notaApi);
    if (!d.live) out.avisos.push('Mostrando os dados do nosso registro. A Cakto não respondeu agora.');
  }

  // v156: a tela le a Stripe ao vivo; o resto do app le a planilha.
  // Quando os dois discordam, quem paga fica vendo "Ativa" aqui e
  // "Bloqueada" no perfil, sem entender nada. Detectamos e avisamos.
  // v157: a MESMA regra que o app inteiro usa, para as duas telas nunca
  // discordarem entre si — foi exatamente esse tipo de divergencia que
  // originou o problema.
  try {
    var statusPlanilha = linha ? String(linha[_ASS_.APP_STATUS] || '') : '';
    var dv = (typeof bsDivergencia_ === 'function')
      ? bsDivergencia_(email, statusPlanilha) : { divergente: false };
    out.divergente = !!dv.divergente;
    out.statusNoApp = statusPlanilha;
    out.temAcessoNoApp = (typeof _bsTemAcesso_ === 'function') ? _bsTemAcesso_(email) : true;
  } catch (e) { out.divergente = false; }

  // Provedores disponíveis, para a seção de migração
  out.provedores = [
    { id: 'cakto',  nome: 'Cakto',  atual: out.provedor === 'cakto',
      migravel: false, nota: out.provedor === 'cakto' ? '' : 'Não aceitamos novas assinaturas aqui.' },
    { id: 'stripe', nome: 'Stripe', atual: out.provedor === 'stripe',
      migravel: out.provedor === 'cakto',
      nota: out.provedor === 'cakto' ? 'Migre e ganhe gestão completa pelo app.' : '' }
  ];

  return { ok: true, data: out };
}

function _blLabelStatus_(s) {
  var m = {
    active: 'Ativa', trialing: 'Em teste', trial: 'Em teste',
    past_due: 'Pagamento pendente', unpaid: 'Pagamento pendente',
    grace: 'Pagamento pendente', grace_final: 'Pagamento pendente',
    canceled: 'Cancelada', cancelled: 'Cancelada',
    paused: 'Pausada', blocked: 'Bloqueada', incomplete: 'Incompleta',
    legacy: 'Acesso liberado'
  };
  return m[String(s)] || String(s || '—');
}

function _blPeriodo_(rec) {
  if (!rec) return '';
  var n = Number(rec.interval_count || 1);
  var u = { day: 'dia', week: 'semana', month: 'mês', year: 'ano' }[rec.interval] || rec.interval;
  if (n === 1) return u === 'mês' ? 'Mensal' : (u === 'ano' ? 'Anual' : 'A cada ' + u);
  return 'A cada ' + n + ' ' + u + (n > 1 && u !== 'mês' ? 's' : 'es');
}

function _blPlanoLabel_(p) {
  return { monthly: 'Mensal', quarterly: 'Trimestral', yearly: 'Anual' }[String(p)] || 'Mensal';
}
function _blPeriodoDoPlano_(p) {
  return { monthly: 'Mensal', quarterly: 'Trimestral', yearly: 'Anual' }[String(p)] || '';
}

// ─────────────────────────────────────────────────────────────
// ROTA: billingCancelar — cancela ao FIM do período pago.
// Nunca corta na hora: a pessoa pagou pelo mês e tem direito a
// usá-lo até o fim.
// ─────────────────────────────────────────────────────────────
function billingCancelar(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  var email = _blNorm_(user.email);

  var prov = _blProvedor_(email, null);
  if (prov.nome === 'stripe' && prov.sub) {
    // Ownership: a assinatura veio da busca pelo e-mail DESTA sessão.
    var r = _stripeCall_('post', '/v1/subscriptions/' + encodeURIComponent(prov.sub.id),
                         { 'cancel_at_period_end': 'true' });
    if (r._error) return { ok: false, error: r.message || 'Não consegui cancelar agora.' };
    logAction(email, 'BILLING_CANCELADA', 'assinatura', prov.sub.id, 'ao fim do periodo');
    return { ok: true, ate: _blDataBR_(r.current_period_end),
             message: 'Cancelamento agendado. Seu acesso continua até ' + _blDataBR_(r.current_period_end) + '.' };
  }
  // Cakto continua pelo caminho já existente
  try { return cancelarAssinatura(token); }
  catch (e) { return { ok: false, error: 'Cancelamento indisponível neste provedor.' }; }
}

// ROTA: billingReativar — desfaz o cancelamento agendado
function billingReativar(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  var prov = _blProvedor_(_blNorm_(user.email), null);
  if (prov.nome !== 'stripe' || !prov.sub) return { ok: false, error: 'Indisponível neste provedor.' };

  var r = _stripeCall_('post', '/v1/subscriptions/' + encodeURIComponent(prov.sub.id),
                       { 'cancel_at_period_end': 'false' });
  if (r._error) return { ok: false, error: r.message || 'Não consegui reativar.' };
  logAction(_blNorm_(user.email), 'BILLING_REATIVADA', 'assinatura', prov.sub.id, '');
  return { ok: true, message: 'Assinatura reativada. Nada será interrompido.' };
}
