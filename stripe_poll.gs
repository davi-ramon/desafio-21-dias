// ============================================================
// stripe_poll.gs — Eventos do Stripe por PULL (v158)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// POR QUE O WEBHOOK NUNCA IA FUNCIONAR
//
// O painel do Stripe mostrou o endpoint DESATIVADO e todas as
// entregas com "302 ERR". Medido na mão:
//
//   POST .../exec  ->  HTTP/1.1 302 Found
//                      Location: script.googleusercontent.com/...
//
// Toda URL /exec do Apps Script responde 302 e serve o conteudo
// no googleusercontent. Nao existe configuracao que mude isso.
// O Stripe nao segue redirect em webhook: ele conta 302 como
// falha, tenta de novo, e depois de varias falhas DESATIVA o
// endpoint sozinho. Foi o que aconteceu em 24/08.
//
// Reativar so repetiria o ciclo. Por isso invertemos o sentido:
// em vez de o Stripe empurrar, nos buscamos. GET /v1/events e a
// mesma fonte, autentica por construcao (veio da API com a nossa
// chave) e nao depende de entrega nenhuma.
//
// Efeito colateral bom: o Stripe guarda 30 dias de eventos, entao
// da para RECUPERAR tudo que foi perdido desde que o endpoint caiu.
// ============================================================

var SP_CFG_CURSOR = 'stripe_poll_cursor';   // timestamp unix do ultimo evento tratado
var SP_JANELA_SEG = 60;                     // volta 1 min para nao perder evento na borda
var SP_MAX_PAGINA = 100;

// Eventos que realmente mudam o estado do aluno.
var SP_TIPOS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.resumed',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.trial_will_end',
  'invoice.paid',
  'invoice.payment_failed',
  'payment_method.attached'
];

// ─────────────────────────────────────────────────────────────
// Despacho — o MESMO usado pelo webhook. Uma regra só, para os
// dois caminhos nunca divergirem.
// ─────────────────────────────────────────────────────────────
function _stripeDespacharEvento_(ev) {
  if (!ev || !ev.type) return { ok: false, error: 'evento vazio' };
  if (_dedupWebhook_(ev.type, ev.id)) return { ok: true, dedup: true };

  var obj = (ev.data && ev.data.object) || {};
  try {
    switch (ev.type) {
      case 'checkout.session.completed':            _stripeOnCheckout_(obj); break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.resumed':         _stripeOnSubSync_(obj); break;
      case 'customer.subscription.deleted':         _stripeOnSubDeleted_(obj); break;
      case 'customer.subscription.paused':          _stripeOnSubPaused_(obj); break;
      case 'customer.subscription.trial_will_end':  _stripeOnTrialWillEnd_(obj); break;
      case 'invoice.paid':                          _stripeOnInvoicePaid_(obj); break;
      case 'invoice.payment_failed':                _stripeOnInvoiceFailed_(obj); break;
      case 'payment_method.attached':               _stripeOnPmAttached_(obj); break;
      default: return { ok: true, ignorado: true };
    }
    return { ok: true, tipo: ev.type };
  } catch (e) {
    logAction('system', 'STRIPE_EVENT_ERRO', 'poll', ev.type, e.message);
    try { if (typeof tgEnviarErro_ === 'function') tgEnviarErro_('Stripe ' + ev.type, e.message); } catch (_t) {}
    return { ok: false, error: e.message };
  }
}

function _spCursor_() {
  var v = 0;
  try { v = parseInt(getConfig_(SP_CFG_CURSOR), 10) || 0; } catch (e) {}
  // Sem cursor ainda: começa 2 dias atrás, não no começo dos tempos.
  if (!v) v = Math.floor(Date.now() / 1000) - 2 * 86400;
  return v;
}

function _spSalvarCursor_(ts) {
  try { setConfig_(SP_CFG_CURSOR, String(ts)); } catch (e) {}
}

// ─────────────────────────────────────────────────────────────
// ROTINA — roda no gatilho de tempo (a cada 5 min)
// ─────────────────────────────────────────────────────────────
function stripeBuscarEventos() {
  if (!stripeConfigurado_()) return { ok: false, error: 'Stripe nao configurado.' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) {
    return { ok: false, error: 'ja rodando' };   // execução anterior ainda em curso
  }

  try {
    var desde = _spCursor_() - SP_JANELA_SEG;
    var url = '/v1/events?limit=' + SP_MAX_PAGINA + '&created[gte]=' + desde;
    SP_TIPOS.forEach(function (t) { url += '&types[]=' + encodeURIComponent(t); });

    var r = _stripeCall_('get', url);
    if (!r || r._error) {
      logAction('system', 'STRIPE_POLL_ERRO', 'poll', '', (r && r.message) || 'falhou');
      return { ok: false, error: (r && r.message) || 'Erro ao consultar eventos.' };
    }

    var eventos = (r.data || []).slice();
    // A API devolve do mais novo para o mais antigo; processar nessa ordem
    // aplicaria uma renovação antes da criação da assinatura.
    eventos.reverse();

    var novoCursor = _spCursor_();
    var res = { total: eventos.length, tratados: 0, repetidos: 0, erros: 0, tipos: {} };

    for (var i = 0; i < eventos.length; i++) {
      var ev = eventos[i];
      var d = _stripeDespacharEvento_(ev);
      if (d.dedup)          res.repetidos++;
      else if (d.ok)        { res.tratados++; res.tipos[ev.type] = (res.tipos[ev.type] || 0) + 1; }
      else                  res.erros++;
      if (ev.created > novoCursor) novoCursor = ev.created;
    }

    _spSalvarCursor_(novoCursor);

    if (res.tratados || res.erros) {
      logAction('system', 'STRIPE_POLL', 'poll', '',
                'tratados=' + res.tratados + ' repetidos=' + res.repetidos +
                ' erros=' + res.erros + ' ' + JSON.stringify(res.tipos));
    }
    return { ok: true, data: res };

  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ─────────────────────────────────────────────────────────────
// RECUPERAÇÃO — reprocessa uma janela para trás.
// O endpoint caiu em 24/08 e ninguem soube; o Stripe guarda 30
// dias, entao tudo que ficou pelo caminho ainda da para salvar.
// ─────────────────────────────────────────────────────────────
function stripeRecuperarEventos(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  if (!stripeConfigurado_()) return { ok: false, error: 'Stripe não configurado.' };

  var dias = Math.max(1, Math.min(30, parseInt((data || {}).dias, 10) || 15));
  var desde = Math.floor(Date.now() / 1000) - dias * 86400;

  var res = { janelaDias: dias, total: 0, tratados: 0, repetidos: 0, erros: 0, tipos: {} };
  var cursor = null, paginas = 0;

  // Paginação: a API devolve no máximo 100 por vez.
  var lote = [];
  while (paginas < 12) {
    var url = '/v1/events?limit=' + SP_MAX_PAGINA + '&created[gte]=' + desde;
    SP_TIPOS.forEach(function (t) { url += '&types[]=' + encodeURIComponent(t); });
    if (cursor) url += '&starting_after=' + encodeURIComponent(cursor);

    var r = _stripeCall_('get', url);
    if (!r || r._error) break;
    var d = r.data || [];
    if (!d.length) break;

    lote = lote.concat(d);
    cursor = d[d.length - 1].id;
    paginas++;
    if (!r.has_more) break;
  }

  res.total = lote.length;
  lote.reverse();   // do mais antigo para o mais novo

  for (var i = 0; i < lote.length; i++) {
    var ev = lote[i];
    var out = _stripeDespacharEvento_(ev);
    if (out.dedup)      res.repetidos++;
    else if (out.ok)    { res.tratados++; res.tipos[ev.type] = (res.tipos[ev.type] || 0) + 1; }
    else                res.erros++;
  }

  logAction(user.email, 'STRIPE_RECUPERACAO', 'poll', '',
            dias + 'd | total=' + res.total + ' tratados=' + res.tratados);
  return { ok: true, data: res };
}

// ─────────────────────────────────────────────────────────────
// Gatilho de tempo
// ─────────────────────────────────────────────────────────────
function stripePollStatus(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  var ativo = false, quando = '';
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'stripeBuscarEventos') ativo = true;
    });
  } catch (e) {}
  try {
    var c = parseInt(getConfig_(SP_CFG_CURSOR), 10) || 0;
    if (c) quando = Utilities.formatDate(new Date(c * 1000), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm');
  } catch (e) {}

  return { ok: true, data: { ativo: ativo, ultimoEvento: quando, configurado: stripeConfigurado_() } };
}

function stripePollAtivar(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'stripeBuscarEventos') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('stripeBuscarEventos').timeBased().everyMinutes(5).create();
    logAction(user.email, 'STRIPE_POLL_ATIVADO', 'poll', '', '5 min');
    return { ok: true, message: 'Rotina ativa. O app passa a buscar os eventos do Stripe a cada 5 minutos.' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function stripePollRodarAgora(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  var r = stripeBuscarEventos();
  return r;
}
