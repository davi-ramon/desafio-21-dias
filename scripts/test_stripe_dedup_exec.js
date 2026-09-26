// Reproduz o defeito das notificacoes repetidas do Stripe e prova a
// correcao. Roda stripe_poll.gs de verdade contra um Stripe e uma
// planilha simulados, avancando o relogio em blocos de 6 horas.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let agora = Math.floor(Date.now() / 1000);   // relogio simulado, em segundos
const cfg = new Map();
const cache = new Map();              // CacheService simulado, com validade
const avisos = [];
const processados = [];

// Eventos: o par real do print (falha + cancelada), no mesmo segundo.
const EVENTOS = [
  { id: 'evt_falha1', type: 'invoice.payment_failed', created: agora - 30,
    data: { object: { customer_email: 'tools.lazy@gmail.com', attempt_count: 4, next_payment_attempt: null } } },
  { id: 'evt_cancel1', type: 'customer.subscription.deleted', created: agora - 30,
    data: { object: { id: 'sub_1' } } }
];

// Planilha simulada
const abas = {};
function aba(nome) {
  if (!abas[nome]) {
    const linhas = [];
    abas[nome] = {
      linhas,
      appendRow: r => linhas.push(r.slice()),
      setFrozenRows() {},
      getLastRow: () => linhas.length,
      getRange: (l, c, nl) => ({ getValues: () => linhas.slice(l - 1, l - 1 + nl).map(r => [r[c - 1]]) }),
      deleteRows: (ini, n) => linhas.splice(ini - 1, n)
    };
  }
  return abas[nome];
}

const ctx = {
  console,
  nowISO: () => new Date(agora * 1000).toISOString(),
  logAction() {},
  getConfig_: k => (cfg.has(k) ? cfg.get(k) : ''),
  setConfig_: (k, v) => cfg.set(k, String(v)),
  stripeConfigurado_: () => true,
  getSpreadsheet_: () => ({ getSheetByName: n => abas[n] || null, insertSheet: n => aba(n) }),
  LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {}, hasLock: () => true }) },
  CacheService: { getScriptCache: () => ({
    get: k => { const v = cache.get(k); return v && v.ate > agora ? v.val : null; },
    put: (k, val, seg) => cache.set(k, { val, ate: agora + seg }),
    remove: k => cache.delete(k) }) },
  // A API devolve os eventos com created >= o pedido (mais novo primeiro)
  _stripeCall_: (metodo, url) => {
    const m = /created\[gte\]=(\d+)/.exec(url);
    const desde = m ? Number(m[1]) : 0;
    return { data: EVENTOS.filter(e => e.created >= desde).slice().reverse() };
  },
  _stripeNotif_: msg => avisos.push({ t: agora, msg }),
  tgEnviarErro_() {},
  _stripeOnInvoiceFailed_: null, _stripeOnSubDeleted_: null,     // preenchidos abaixo
  _stripeOnCheckout_() {}, _stripeOnSubSync_() {}, _stripeOnSubPaused_() {},
  _stripeOnTrialWillEnd_() {}, _stripeOnInvoicePaid_() {}, _stripeOnPmAttached_() {},
  _dedupWebhook_: null
};
ctx.globalThis = ctx;
vm.createContext(ctx);

// _dedupWebhook_ real (code.gs), para reproduzir o comportamento antigo
const code = fs.readFileSync(path.join(process.env.GS_DIR || path.join(__dirname, '..'), 'code.gs'), 'utf8');
const i = code.indexOf('function _dedupWebhook_(');
let j = i, d = 0, dentro = false;
for (; j < code.length; j++) { if (code[j] === '{') { d++; dentro = true; } else if (code[j] === '}') { d--; if (dentro && !d) { j++; break; } } }
vm.runInContext(code.slice(i, j), ctx);

// Handlers reais de aviso (stripe.gs), com os efeitos de estado neutros
const stripe = fs.readFileSync(path.join(process.env.GS_DIR || path.join(__dirname, '..'), 'stripe.gs'), 'utf8');
function bloco(sig) {
  const a = stripe.indexOf(sig); let b = a, dd = 0, dt = false;
  for (; b < stripe.length; b++) { if (stripe[b] === '{') { dd++; dt = true; } else if (stripe[b] === '}') { dd--; if (dt && !dd) { b++; break; } } }
  return stripe.slice(a, b);
}
Object.assign(ctx, {
  _stripeEmailDaSub_: () => 'tools.lazy@gmail.com',
  _upsertAssinatura_: () => processados.push('cancelou'),
  _syncAcesso_() {}, _stripeSyncAssinatura_() {}, AS: { CANCELLED: 'cancelled' }
});
vm.runInContext(bloco('function _stripeOnInvoiceFailed_(') + '\n' + bloco('function _stripeOnSubDeleted_('), ctx);

vm.runInContext(fs.readFileSync(path.join(process.env.GS_DIR || path.join(__dirname, '..'), 'stripe_poll.gs'), 'utf8'), ctx, { filename: 'stripe_poll.gs' });

let falhas = 0;
function passo(nome, fn) {
  try { const r = fn(); console.log('  ok    ' + nome + (r ? '  (' + r + ')' : '')); }
  catch (e) { falhas++; console.log('  FALHA ' + nome + '\n        ' + e.message); }
}
function exige(c, m) { if (!c) throw new Error(m); }
function rodarPor(horas) {
  const fim = agora + horas * 3600;
  while (agora < fim) { agora += 300; ctx.stripeBuscarEventos(); }   // a cada 5 min, como o gatilho
}

console.log('\nNOTIFICACOES DO STRIPE');

passo('primeira passada avisa uma vez cada evento', () => {
  cfg.clear(); avisos.length = 0;
  cfg.set('stripe_poll_cursor', String(agora - 3600));   // cursor ja existente, como em producao
  rodarPor(0.5);
  exige(avisos.length === 2, 'avisos: ' + avisos.map(a => a.msg.split('\n')[0]).join(' | '));
  return avisos.map(a => a.msg.split('\n')[0]).join(' + ');
});

passo('24 horas sem evento novo: NENHUM aviso repetido (antes eram 4 rodadas)', () => {
  avisos.length = 0; processados.length = 0;
  rodarPor(24);
  exige(avisos.length === 0, avisos.length + ' avisos repetidos em 24h');
  exige(processados.length === 0, 'reprocessou o cancelamento ' + processados.length + 'x');
  return '0 avisos, 0 reprocessamentos';
});

passo('evento novo depois de 24h e avisado normalmente', () => {
  avisos.length = 0;
  EVENTOS.push({ id: 'evt_renov', type: 'invoice.payment_failed', created: agora + 60,
                 data: { object: { customer_email: 'x@y.com', attempt_count: 1, next_payment_attempt: 999 } } });
  rodarPor(1);
  exige(avisos.length === 1 && /vai tentar de novo/.test(avisos[0].msg), JSON.stringify(avisos));
  return avisos[0].msg.split('\n')[0];
});

passo('tentativas do meio nao avisam; a ultima avisa', () => {
  avisos.length = 0;
  EVENTOS.push({ id: 'evt_t2', type: 'invoice.payment_failed', created: agora + 60,
                 data: { object: { customer_email: 'x@y.com', attempt_count: 2, next_payment_attempt: 999 } } });
  rodarPor(1);
  exige(avisos.length === 0, 'avisou tentativa do meio');
  EVENTOS.push({ id: 'evt_t4', type: 'invoice.payment_failed', created: agora + 60,
                 data: { object: { customer_email: 'x@y.com', attempt_count: 4, next_payment_attempt: null } } });
  rodarPor(1);
  exige(avisos.length === 1 && /ltima tentativa/.test(avisos[0].msg), JSON.stringify(avisos));
  return avisos[0].msg.split('\n')[0];
});

passo('deploy com o registro vazio: o que ja foi processado NAO volta a avisar', () => {
  // simula a primeira execucao depois de publicar: aba nova, cursor antigo
  delete abas['stripe_eventos']; ctx._SP_VISTOS_ = null;
  vm.runInContext('_SP_VISTOS_ = null; _SP_ABA_NOVA_ = false;', ctx);
  avisos.length = 0;
  rodarPor(12);
  exige(avisos.length === 0, avisos.length + ' avisos logo depois do deploy');
  return 'semeou sem avisar';
});

console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nSem repeticao: cada evento avisa uma vez so');
process.exit(falhas ? 1 : 0);
