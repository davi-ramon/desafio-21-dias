// Harness de EXECUCAO: carrega todos os <script> inline de uma pagina
// num contexto isolado do Node, com DOM de mentira, e roda as funcoes
// de verdade. Existe porque `node --check` so valida sintaxe — uma
// variavel indefinida (como o `B` que derrubou o modulo do sono) passa
// limpa no check e explode no navegador.
//
// O global e um objeto COMUM, nao um Proxy: assim um identificador que
// ninguem declarou continua lancando ReferenceError, igual no browser.
'use strict';
const fs = require('fs');
const vm = require('vm');

// ── Stub universal: aceita qualquer acesso/chamada sem quebrar ──
const guardado = new WeakMap();
function stub(nome) {
  const alvo = function () {};
  guardado.set(alvo, {});
  return new Proxy(alvo, {
    get(t, p) {
      const g = guardado.get(t);
      if (p in g) return g[p];
      if (p === 'then') return undefined;               // nao e thenable
      if (p === Symbol.toPrimitive) return () => '';
      if (p === Symbol.iterator) return function* () {};
      if (p === 'length') return 0;
      if (p === 'style') { g.style = {}; return g.style; }
      if (p === 'dataset') { g.dataset = {}; return g.dataset; }
      if (p === 'value') return '';
      if (p === 'checked') return false;
      if (p === 'files') return [];
      if (p === 'children' || p === 'childNodes') return [];
      if (p === 'querySelectorAll') return () => [];
      if (p === 'getBoundingClientRect') return () => ({ width: 800, height: 300, top: 0, left: 0, bottom: 300, right: 800 });
      if (p === 'closest') return () => null;
      if (p === 'firstChild') return null;
      return stub(nome + '.' + String(p));
    },
    set(t, p, v) { guardado.get(t)[p] = v; return true; },
    apply() { return stub(nome + '()'); },
    construct() { return stub('new ' + nome); }
  });
}

function criarContexto() {
  const elementos = new Map();
  function el(id) {
    if (!elementos.has(id)) {
      const e = stub('#' + id);
      e.id = id;
      e.innerHTML = '';
      elementos.set(id, e);
    }
    return elementos.get(id);
  }
  const document = {
    getElementById: el,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (t) => stub('<' + t + '>'),
    addEventListener() {}, removeEventListener() {},
    body: stub('body'), documentElement: stub('html'), head: stub('head'),
    visibilityState: 'visible', readyState: 'complete', cookie: ''
  };
  const armazenamento = () => {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
             removeItem: k => m.delete(k), clear: () => m.clear() };
  };
  const ctx = {
    document,
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120',
                 serviceWorker: { getRegistrations: async () => [], register: async () => stub('reg'),
                                  ready: Promise.resolve(stub('reg')), addEventListener() {}, controller: null },
                 maxTouchPoints: 0, onLine: true, clipboard: stub('clip') },
    location: { href: 'https://app.wpktavares.com.br/app', search: '', hash: '', pathname: '/app',
                origin: 'https://app.wpktavares.com.br', reload() {} },
    history: { replaceState() {}, pushState() {} },
    localStorage: armazenamento(), sessionStorage: armazenamento(),
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    fetch: () => Promise.resolve({ ok: true, json: () => ({ ok: true }), text: () => '{}' }),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    addEventListener() {}, removeEventListener() {},
    alert() {}, confirm: () => true, prompt: () => null,
    getComputedStyle: () => stub('computed'),
    MutationObserver: function () { return { observe() {}, disconnect() {} }; },
    IntersectionObserver: function () { return { observe() {}, unobserve() {}, disconnect() {} }; },
    ResizeObserver: function () { return { observe() {}, disconnect() {} }; },
    Audio: function () { return stub('audio'); },
    Image: function () { return stub('img'); },
    FileReader: function () { return stub('fr'); },
    XMLHttpRequest: function () { return stub('xhr'); },
    Blob: function () { return stub('blob'); },
    URL, URLSearchParams, TextEncoder, TextDecoder,
    devicePixelRatio: 1, innerWidth: 1400, innerHeight: 900,
    Notification: { permission: 'default', requestPermission: async () => 'default' },
    lucide: { createIcons() {} }, google: stub('google'), firebase: stub('firebase'),
    fbq() {}, gtag() {}
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  ctx.__el = el;
  return ctx;
}

// Carrega todos os scripts inline, na ordem, no mesmo contexto — igual
// o navegador faz. Erro de carga e reportado mas nao para os outros.
function carregar(caminho) {
  const html = fs.readFileSync(caminho, 'utf8');
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  const ctx = criarContexto();
  const errosCarga = [];
  let m, n = 0;
  while ((m = re.exec(html))) {
    n++;
    try { vm.runInContext(m[1], ctx, { filename: 'bloco' + n + '.js' }); }
    catch (e) { errosCarga.push('bloco ' + n + ': ' + e.name + ': ' + e.message); }
  }
  vm.runInContext('globalThis.__ler = function (n) { return eval(n); };', ctx);
  return { ctx, errosCarga, blocos: n };
}

module.exports = { carregar };
