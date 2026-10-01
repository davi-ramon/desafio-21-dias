// Roda o backend DE VERDADE (os .gs do projeto) contra uma planilha,
// um Resend, um Gmail e uma API do WhatsApp simulados. Cobre a v166:
//   - sessões em vários aparelhos (login, logout de um só, limite de 5)
//   - recuperação de senha que avisa quando nenhum canal saiu
//   - registro de cada e-mail em emails_log, com o erro do Resend
//   - cadastro pelo app: mesmo rito do checkout (CRM com rota e UTMs,
//     aceite registrado, WhatsApp de boas-vindas, Telegram) + sessão
//   - conta existente pelo app vai para o login sem tocar na senha
//   - checkout sem cartão continua funcionando, agora com origem certa
//   - rota pública de status sem nenhum endereço de e-mail
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const RAIZ = process.env.GS_DIR || path.join(__dirname, '..');

// ── Planilha simulada ────────────────────────────────────────
class Sheet {
  constructor(nome, linhas) { this.nome = nome; this.rows = linhas || []; }
  getDataRange() { const s = this; return { getValues: () => s.rows.map(r => r.slice()) }; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
  appendRow(r) { this.rows.push(r.slice()); return this; }
  getRange(r, c, nr, nc) {
    nr = nr || 1; nc = nc || 1; const s = this;
    const cel = (i, j) => { while (s.rows.length < i) s.rows.push([]); const row = s.rows[i - 1]; while (row.length < j) row.push(''); return row; };
    const api = {
      getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = s.rows[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; },
      getValue() { const row = s.rows[r - 1] || []; return row[c - 1] === undefined ? '' : row[c - 1]; },
      setValue(v) { cel(r, c)[c - 1] = v; return api; },
      setValues(vs) { vs.forEach((vr, i) => vr.forEach((v, j) => { cel(r + i, c + j)[c - 1 + j] = v; })); return api; },
      setFontWeight() { return api; }, setBackground() { return api; }, setFontColor() { return api; }, setNumberFormat() { return api; }
    };
    return api;
  }
  deleteRows(i, n) { this.rows.splice(i - 1, n); }
  setFrozenRows() {}
}
let abas = {};
const planilha = {
  getSheetByName: n => abas[n] || null,
  insertSheet: n => (abas[n] = new Sheet(n))
};

// ── Serviços simulados ───────────────────────────────────────
const props = new Map([['RESEND_API_KEY', 're_teste_nao_real']]);
const cache = new Map();
const S = { resend: 'ok', gmail: 'ok', mailapp: 'ok', envios: [], wa: [], tg: [], logs: [], capi: [] };

// O que a Meta exige do envio, a partir dos componentes do template simulado
function validarEnvioMeta(p) {
  const t = (S.templatesMeta || {})[p.template && p.template.name];
  if (!t || !t.components) return null;                    // template sem estrutura simulada: aceita
  const comps = p.template.components || [];
  const achar = tipo => comps.find(c => c.type === tipo);
  const nomeado = t.parameter_format === 'NAMED';
  for (const c of t.components) {
    if (c.type === 'BODY') {
      const vars = (String(c.text).match(/\{\{\s*[A-Za-z0-9_]+\s*\}\}/g) || []).map(v => v.replace(/[{}\s]/g, ''));
      const unicas = vars.filter((v, i) => vars.indexOf(v) === i);
      if (!unicas.length) continue;
      const b = achar('body');
      if (!b || b.parameters.length !== unicas.length) return '(#132000) Number of parameters does not match';
      if (b.parameters.some(x => !String(x.text || '').trim())) return '(#131008) Required parameter is missing';
      if (nomeado && b.parameters.some(x => unicas.indexOf(x.parameter_name) < 0)) return '(#131008) Required parameter is missing';
    }
    if (c.type === 'HEADER' && /IMAGE|VIDEO|DOCUMENT/.test(c.format)) {
      const h = achar('header');
      const tipo = c.format.toLowerCase();
      if (!h || !h.parameters[0] || !h.parameters[0][tipo] || !h.parameters[0][tipo].link) return '(#131008) Required parameter is missing';
    }
    if (c.type === 'BUTTONS') {
      for (let i = 0; i < c.buttons.length; i++) {
        if (c.buttons[i].type === 'URL' && /\{\{/.test(c.buttons[i].url || '')) {
          const bt = comps.find(x => x.type === 'button' && String(x.index) === String(i));
          if (!bt || !bt.parameters[0] || !bt.parameters[0].text) return '(#131008) Required parameter is missing';
        }
      }
    }
  }
  return null;
}

function resposta(code, obj) { return { getResponseCode: () => code, getContentText: () => JSON.stringify(obj) }; }
function fetchSim(url, opts) {
  opts = opts || {};
  if (url.indexOf('api.resend.com/emails') >= 0 && (opts.method || 'get') === 'post') {
    if (S.resend === 'throw') throw new Error('Address unavailable');
    const p = JSON.parse(opts.payload);
    if (S.resend === '403') return resposta(403, { name: 'validation_error', message: 'The wpktavares.com.br domain is not verified. Contato: suporte@wpktavares.com.br' });
    S.envios.push({ via: 'resend', to: p.to[0], subject: p.subject, text: p.text });
    return resposta(200, { id: 'rs_' + S.envios.length });
  }
  if (url.indexOf('api.resend.com/domains') >= 0) {
    const auth = String(((opts.headers || {}).Authorization) || '');
    if (/re_semdominio/.test(auth)) return resposta(200, { data: [{ name: 'lazylabs.com.br', status: 'verified' }] });
    if (/re_soenvio/.test(auth)) return resposta(401, { name: 'restricted_api_key', message: 'This API key is restricted to only send emails' });
    if (/re_invalida/.test(auth)) return resposta(401, { name: 'validation_error', message: 'API key is invalid' });
    return resposta(200, { data: [{ name: 'wpktavares.com.br', status: 'verified', region: 'us-east-1' }] });
  }
  if (url.indexOf('api.resend.com/emails/') >= 0) return resposta(200, { last_event: 'delivered' });
  if (url.indexOf('graph.facebook.com') >= 0 && url.indexOf('/messages') >= 0) {
    S.waTentativas = (S.waTentativas || 0) + 1;
    // v171: valida como a Meta — parte exigida faltando ou variável vazia = #131008
    const erroMeta = validarEnvioMeta(JSON.parse(opts.payload));
    if (erroMeta) return resposta(400, { error: { message: erroMeta } });
    if (S.waFalhas && S.waFalhas.length) {           // fila de falhas simuladas (ex.: [500] ou [400])
      const code = S.waFalhas.shift();
      return resposta(code, { error: { message: code === 400 ? '(#132001) Template name does not exist in the translation' : 'Service temporarily unavailable' } });
    }
    S.wa.push(JSON.parse(opts.payload)); return resposta(200, { messages: [{ id: 'wamid.' + S.wa.length }] });
  }
  if (url.indexOf('graph.facebook.com') >= 0 && url.indexOf('/message_templates') >= 0 && opts.method === 'post') {
    const p = JSON.parse(opts.payload);
    S.templateCriado = p;
    return resposta(200, { id: 'tpl_1', status: 'PENDING', category: p.category });
  }
  if (url.indexOf('graph.facebook.com') >= 0 && url.indexOf('/message_templates') >= 0) {
    const nome = decodeURIComponent((/[?&]name=([^&]+)/.exec(url) || [])[1] || '');
    const t = (S.templatesMeta || {})[nome];
    return resposta(200, { data: t ? [Object.assign({ name: nome, language: 'pt_BR' }, t)] : [] });
  }
  if (url.indexOf('graph.facebook.com') >= 0) return resposta(200, {});
  if (url.indexOf('api.qrserver.com') >= 0) return { getResponseCode: () => 200, getContentText: () => '', getBlob: () => ({ setName: () => ({ qr: true }) }) };
  if (url.indexOf('api.telegram.org') >= 0) { S.tg.push(JSON.parse(opts.payload).text); return resposta(200, { ok: true }); }
  throw new Error('fetch inesperado: ' + url);
}

let uuid = 0;
const ctx = {
  console, JSON, Math, Date, String, Number, Object, Array, RegExp, Error, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
  SpreadsheetApp: { openById: () => planilha, getActiveSpreadsheet: () => planilha },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (props.has(k) ? props.get(k) : null),
                                                     setProperty: (k, v) => props.set(k, v), deleteProperty: k => props.delete(k) }) },
  CacheService: { getScriptCache: () => ({ get: k => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, v), remove: k => cache.delete(k), removeAll: ks => ks.forEach(k => cache.delete(k)) }) },
  UrlFetchApp: { fetch: fetchSim, fetchAll: reqs => reqs.map(r => fetchSim(r.url, r)) },
  GmailApp: {
    sendEmail: () => { S.gmailChamado = (S.gmailChamado || 0) + 1; throw new Error('The script does not have permission to perform that action. Required permissions: (https://mail.google.com/)'); },
    getAliases: () => []
  },
  MailApp: {
    sendEmail: (o, assunto, corpo, opts) => { if (S.mailapp === 'throw') throw new Error('Service invoked too many times for one day: email.');
      S.envios.push(typeof o === 'string' ? { via: 'mailapp', to: o, subject: assunto, opts: opts || {} } : { via: 'mailapp', to: o.to, subject: o.subject, opts: o }); },
    getRemainingDailyQuota: () => 87
  },
  Utilities: {
    getUuid: () => '00000000-0000-4000-8000-' + String(++uuid).padStart(12, '0'),
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
    formatDate: (d, tz, f) => { const p = n => String(n).padStart(2, '0'); return f.replace('dd', p(d.getDate())).replace('MM', p(d.getMonth() + 1)).replace('yyyy', d.getFullYear()).replace('HH', p(d.getHours())).replace('mm', p(d.getMinutes())); }
  },
  Session: { getEffectiveUser: () => ({ getEmail: () => 'wpktavares@gmail.com' }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
  Logger: { log() {} },
  ScriptApp: { getProjectTriggers: () => (S.gatilhos || []).map(h => ({ getHandlerFunction: () => h })) }
};
ctx.Utilities.sleep = () => {};
ctx.globalThis = ctx;
vm.createContext(ctx);

for (const f of ['code.gs', 'automation.gs', 'auth.gs', 'auth_admin.gs', 'leads.gs', 'crm_leads.gs', 'trial_routes.gs',
                 'trial_card.gs', 'whatsapp.gs', 'telegram.gs', 'email_saude.gs', 'email_layout.gs', 'modules.gs', 'setup.gs',
                 'rito_status.gs', 'trial_auto.gs', 'ingressos_evento.gs']) {
  vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx, { filename: f });
}

// O que mora em arquivos que o teste não carrega (assinaturas, indicação, CAPI)
const assinaturas = {};
vm.runInContext(`
  var _ASS_ = { APP_STATUS: 0 };
  var AS = { ACTIVE: 'active', TRIAL: 'trial', CANCELLED: 'cancelled' };
  function _getAssinaturaRow_(e) { return __ass[e] ? [__ass[e]] : null; }
  function _upsertAssinatura_(e, o) { __ass[e] = o.app_status; }
  function _syncAcesso_() {}
  function indRegistrarConversao_() {}
  function enviarEventoCapi_(n, o) { __capi.push(n); }
  function _rlBloqueado_() { return 0; } function _rlFalha_() {} function _rlLimpar_() {}
  function _twofaAtivo_() { return false; }
  function _rateLimit_() { return false; }
  function logAction(u, a, en, id, det) { __logs.push(a + ' ' + (det || '')); }
  function _capiHash_(s) { return String(s).split('').reduce(function (h, c) { return ((h << 5) - h + c.charCodeAt(0)) | 0; }, 7).toString(16) + 'abcdef0123456789abcdef0123456789'; }
`, Object.assign(ctx, { __ass: assinaturas, __capi: S.capi, __logs: S.logs }));
props.set('TG_TOKEN', 'tg_teste');

function planilhaNova() {
  abas = {};
  uuid = 0;
  cache.clear();
  planilha.insertSheet('users').appendRow(['id', 'name', 'email', 'password_hash', 'role', 'token', 'active', 'created_at']);
  planilha.insertSheet('CRM').appendRow(['id', 'name', 'email', 'phone', 'form_answers', 'status', 'created_at', 'updated_at', 'assigned_user', 'custom_fields', 'timeline']);
  planilha.insertSheet('compradores').appendRow(['OrderId', 'Email']);
  planilha.insertSheet('password_reset').appendRow(['id', 'email', 'code', 'expires_at', 'used', 'created_at']);
  const cfg = planilha.insertSheet('config');
  cfg.appendRow(['key', 'value', 'updated_at']);
  [['wa_token', 'tok'], ['wa_waba_id', '1'], ['wa_phone_id', '2'], ['auto_whats_boasvindas', 'true'],
   ['wa_tpl_boasvindas', 'bv_cartao'], ['wa_tpl_boasvindas_vars', '["primeiro_nome","data_cobranca"]'],
   ['wa_tpl_boasvindas_sc', 'bv_teste_gratis'], ['wa_tpl_boasvindas_sc_vars', '["primeiro_nome","fim_teste"]'],
   ['trial_dias_app', '14']].forEach(p => cfg.appendRow([p[0], p[1], '']));
  Object.keys(assinaturas).forEach(k => delete assinaturas[k]);
  S.envios.length = 0; S.wa.length = 0; S.tg.length = 0; S.logs.length = 0; S.capi.length = 0;
  S.resend = 'ok'; S.gmail = 'ok'; S.mailapp = 'ok';
  // Meta: os templates configurados existem e estão aprovados (cada teste muda o que precisar)
  S.templatesMeta = {
    bv_teste_gratis: { status: 'APPROVED', category: 'UTILITY',
                       components: [{ type: 'BODY', text: 'Oi {{1}}, seu teste vai até {{2}}.' }] },
    bv_cartao:       { status: 'APPROVED', category: 'UTILITY',
                       components: [{ type: 'BODY', text: 'Oi {{1}}, primeira cobrança em {{2}}.' }] },
    desafio21_boasvindas_teste_gratis: { status: 'APPROVED', category: 'UTILITY',
                       components: [{ type: 'BODY', text: 'Olá, {{1}}! {{2}} dias grátis, até {{3}}.' }] }
  };
  S.waFalhas = []; S.waTentativas = 0; S.gatilhos = ['stripeBuscarEventos'];
}
function usuario(email) { return ctx.sheetToObjects(abas.users).find(u => u.email === email); }
function leadCrm(email) {
  const l = ctx.sheetToObjects(abas.CRM).find(x => x.email === email);
  return l ? Object.assign(l, { cf: JSON.parse(l.custom_fields || '{}'), tl: JSON.parse(l.timeline || '[]') }) : null;
}

let falhas = 0;
function passo(nome, fn) {
  try { const r = fn(); console.log('  ok    ' + nome + (r ? '  (' + r + ')' : '')); }
  catch (e) { falhas++; console.log('  FALHA ' + nome + '\n        ' + e.message); }
}
function exige(c, m) { if (!c) throw new Error(m); }

// ═════════════════════════════════════════════════════════════
console.log('\nSESSOES EM VARIOS APARELHOS');
passo('celular e computador logados ao mesmo tempo', () => {
  planilhaNova();
  abas.users.appendRow(['u1', 'Ana Souza', 'ana@x.com', ctx.hashPassword('segredo1'), 'aluno', '', true, '']);
  const a = ctx.login('ana@x.com', 'segredo1'), b = ctx.login('ANA@x.com ', 'segredo1');
  exige(a.ok && b.ok && a.token !== b.token, 'login falhou');
  exige(ctx.getUserByToken(a.token) && ctx.getUserByToken(b.token), 'o primeiro aparelho caiu ao entrar no segundo');
  ctx.__t = [a.token, b.token];
  return '2 sessoes validas';
});
passo('sair em um aparelho nao derruba o outro', () => {
  ctx.logout(ctx.__t[0]);
  exige(!ctx.getUserByToken(ctx.__t[0]), 'token que saiu continua valendo');
  exige(ctx.getUserByToken(ctx.__t[1]), 'o outro aparelho caiu junto');
});
passo('limite de 5: o mais antigo sai', () => {
  for (let i = 0; i < 5; i++) ctx.login('ana@x.com', 'segredo1');
  exige(!ctx.getUserByToken(ctx.__t[1]), 'passou de 5 sessoes');
  const n = String(usuario('ana@x.com').token).split(' ').length;
  exige(n === 5, n + ' tokens guardados');
  return '5 tokens na celula';
});
passo('token vazio ou inexistente nao entra', () => {
  exige(ctx.getUserByToken('') === null && ctx.getUserByToken('nao-existe') === null, 'entrou sem token valido');
  exige(ctx.getUserByToken('00000000') === null, 'pedaco de token entrou');
});

// ═════════════════════════════════════════════════════════════
console.log('\nRECUPERACAO DE SENHA');
passo('Resend ok: codigo sai pelo dominio e fica registrado', () => {
  planilhaNova();
  abas.users.appendRow(['u1', 'Davi', 'davi@x.com', ctx.hashPassword('x'), 'admin', '', true, '']);
  const r = ctx.sendPasswordReset('davi@x.com');
  exige(r.ok, JSON.stringify(r));
  exige(S.envios.length === 1 && S.envios[0].via === 'resend' && /recupera/i.test(S.envios[0].subject), JSON.stringify(S.envios));
  exige(S.envios[0].text && /codigo/.test(S.envios[0].text), 'sem parte em texto');
  const log = abas.emails_log.rows;
  exige(log.length === 2 && log[1][1] === 'senha' && log[1][4] === 'resend' && log[1][5] === 'sim', JSON.stringify(log[1]));
  return 'via resend, tipo senha';
});
passo('Resend recusa: sai pelo MailApp (conta do sistema) e o erro do Resend fica guardado', () => {
  planilhaNova();
  abas.users.appendRow(['u1', 'Davi', 'davi@x.com', ctx.hashPassword('x'), 'admin', '', true, '']);
  S.resend = '403';
  const r = ctx.sendPasswordReset('davi@x.com');
  exige(r.ok && S.envios[0].via === 'mailapp' && !S.gmailChamado, JSON.stringify(S.envios) + ' gmail=' + S.gmailChamado);
  const lin = abas.emails_log.rows[1];
  exige(lin[4] === 'mailapp-html' && /resend: HTTP 403/.test(lin[7]) && /not verified/.test(lin[7]) && !/gmail:/.test(lin[7]), JSON.stringify(lin));
  return 'erro do Resend: ' + lin[7].slice(0, 50) + '...';
});
passo('NENHUM canal sai: a tela recebe erro (antes dizia "enviado")', () => {
  planilhaNova();
  abas.users.appendRow(['u1', 'Davi', 'davi@x.com', ctx.hashPassword('x'), 'admin', '', true, '']);
  S.resend = '403'; S.gmail = 'throw'; S.mailapp = 'throw';
  const r = ctx.sendPasswordReset('davi@x.com');
  exige(!r.ok && /Não consegui enviar/.test(r.error), JSON.stringify(r));
  exige(abas.emails_log.rows[1][5] === 'nao', 'falha nao registrada');
  return r.error.slice(0, 40) + '...';
});
passo('e-mail que nao existe: resposta igual, nada enviado', () => {
  planilhaNova();
  const r = ctx.sendPasswordReset('ninguem@x.com');
  exige(r.ok && S.envios.length === 0, 'enviou ou revelou');
});
passo('senha redefinida derruba as sessoes abertas', () => {
  planilhaNova();
  abas.users.appendRow(['u1', 'Ana', 'ana@x.com', ctx.hashPassword('velha'), 'aluno', '', true, '']);
  const t = ctx.login('ana@x.com', 'velha').token;
  ctx.sendPasswordReset('ana@x.com');
  const cod = abas.password_reset.rows[1][2];
  exige(ctx.verifyAndResetPassword('ana@x.com', cod, 'novaSenha1').ok, 'reset falhou');
  exige(!ctx.getUserByToken(t), 'sessao antiga sobreviveu a troca de senha');
  exige(ctx.login('ana@x.com', 'novaSenha1').ok, 'senha nova nao entra');
});

// ═════════════════════════════════════════════════════════════
console.log('\nCADASTRO PELO APP');
const RASTREIO = { utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'roteiro-05', utm_content: 'criativo-b',
                   landing: '/instalar/', referrer: 'https://l.instagram.com/', dispositivo: 'android-app',
                   primeira_visita: '2026-09-27T12:00:00Z', lixo: 'nao entra', pagina: '=HYPERLINK("x")' };
passo('conta nova: entra logada, com os dias do painel (14), nao os do pedido', () => {
  planilhaNova();
  const r = ctx.registrarTrial_({ nome: 'Carla', email: 'Carla@Y.com', whatsapp: '(94) 99123-4567', dias: 21,
    rota: 'app-instalado', rastreio: RASTREIO, consentimento: true, origem: 'https://wpktavares.com.br/app/?fonte=pwa' });
  exige(r.ok && r.token && r.user && r.user.email === 'carla@y.com', JSON.stringify(r));
  exige(r.dias === 14, 'dias = ' + r.dias);
  exige(ctx.getUserByToken(r.token) && ctx.getUserByToken(r.token).email === 'carla@y.com', 'token nao abre sessao');
  exige(assinaturas['carla@y.com'] === 'trial', 'assinatura nao virou trial');
  return 'token ok, trial 14 dias';
});
passo('CRM: origem trial-app, rota, UTMs, aparelho, aceite — e so chaves conhecidas', () => {
  const l = leadCrm('carla@y.com');
  exige(l, 'lead nao entrou no CRM');
  const cf = l.cf;
  exige(cf.origem === 'trial-app' && cf.origem_primeira === 'trial-app' && cf.rota === 'app-instalado', JSON.stringify(cf));
  exige(cf.campanha === 'roteiro-05' && cf.utm_source === 'facebook' && cf.utm_content === 'criativo-b', 'UTMs: ' + JSON.stringify(cf));
  exige(cf.pagina_entrada === '/instalar/' && cf.dispositivo === 'android-app', 'entrada/aparelho: ' + JSON.stringify(cf));
  exige(cf.consentimento_em && cf.termos_versao === 'contato-2026-09-v1', 'aceite: ' + JSON.stringify(cf));
  exige(!('lixo' in cf), 'chave desconhecida entrou');
  exige(l.phone === '+5594991234567', 'telefone: ' + l.phone);
  return 'origem=' + cf.origem + ' campanha=' + cf.campanha;
});
passo('aceite provado na aba consentimentos, com versao do texto', () => {
  const c = abas.consentimentos.rows;
  exige(c.length === 2, c.length + ' linhas');
  exige(c[1][1] === 'carla@y.com' && c[1][6] === 'contato-2026-09-v1' && c[1][8] === 'app-instalado', JSON.stringify(c[1]));
});
passo('rito: e-mail de boas-vindas + WhatsApp (template do sem cartao) + Telegram + Meta', () => {
  exige(S.envios.some(e => e.to === 'carla@y.com' && /acesso ao Desafio/.test(e.subject)), 'sem e-mail de boas-vindas');
  exige(S.wa.length === 1 && S.wa[0].template.name === 'bv_teste_gratis' && S.wa[0].to === '5594991234567', JSON.stringify(S.wa));
  const vars = S.wa[0].template.components[0].parameters.map(p => p.text);
  exige(vars[0] === 'Carla' && /^\d\d\/\d\d\/\d{4}$/.test(vars[1]), 'variaveis: ' + vars);
  exige(S.tg.length === 1 && /App instalado/.test(S.tg[0]) && /roteiro-05/.test(S.tg[0]), S.tg[0]);
  exige(S.capi.indexOf('Lead') >= 0 && S.capi.indexOf('CompleteRegistration') >= 0, 'CAPI: ' + S.capi);
  const tl = leadCrm('carla@y.com').tl.map(t => t.action);
  exige(tl.some(a => /Boas-vindas: e-mail enviado · WhatsApp enviado/.test(a)), 'historico: ' + tl.join(' / '));
  return 'fim do teste no WhatsApp: ' + vars[1];
});
passo('trial_leads com a rota e sem formula vinda de fora', () => {
  const t = abas.trial_leads.rows.find(r => r[2] === 'carla@y.com');
  exige(t && /^app-instalado · roteiro-05$/.test(t[6]) && t[8] === 'sim', JSON.stringify(t));
});
passo('mesmo e-mail de novo pelo app: vai para o login, senha intacta', () => {
  const antes = usuario('carla@y.com').password_hash;
  const nEnv = S.envios.length, nWa = S.wa.length;
  const r = ctx.registrarTrial_({ nome: 'Outra', email: 'carla@y.com', whatsapp: '94991234567', rota: 'app-instalado', consentimento: true });
  exige(!r.ok && r.existe === true && !r.token, JSON.stringify(r));
  exige(usuario('carla@y.com').password_hash === antes, 'SENHA TROCADA por cadastro alheio');
  exige(S.envios.length === nEnv && S.wa.length === nWa, 'disparou mensagem para conta existente');
});
passo('pelo app sem autorizacao: bloqueia antes de gravar qualquer coisa', () => {
  const r = ctx.registrarTrial_({ nome: 'Beto', email: 'beto@y.com', whatsapp: '94991234567', rota: 'app-web', consentimento: false });
  exige(!r.ok && /autoriza/.test(r.error), JSON.stringify(r));
  exige(!usuario('beto@y.com') && !leadCrm('beto@y.com'), 'gravou sem autorizacao');
});
passo('pelo app com fixo/numero invalido: pede celular', () => {
  const r = ctx.registrarTrial_({ nome: 'Beto', email: 'beto@y.com', whatsapp: '9433221100', rota: 'app-web', consentimento: true });
  exige(!r.ok && /celular/i.test(r.error), JSON.stringify(r));
});
passo('rota desconhecida vira checkout (nunca da sessao)', () => {
  const r = ctx.registrarTrial_({ nome: 'Duda Lima', email: 'duda@y.com', whatsapp: '11988887777', rota: 'hacker', consentimento: true, dias: 7 });
  exige(r.ok && !r.token, JSON.stringify(r));
  exige(leadCrm('duda@y.com').cf.rota === 'checkout-sem-cartao', 'rota: ' + leadCrm('duda@y.com').cf.rota);
});

// ═════════════════════════════════════════════════════════════
console.log('\nCHECKOUT SEM CARTAO (a porta que ja existia)');
passo('continua igual: sem sessao, "verifique seu e-mail", dias da pagina', () => {
  planilhaNova();
  const r = ctx.registrarTrial_({ nome: 'Eva Maria', email: 'eva@y.com', whatsapp: '94991112222', dias: 7,
    consentimento: true, rota: 'checkout-sem-cartao', rastreio: { utm_campaign: 'roteiro-02', landing: '/7-dias/' } });
  exige(r.ok && !r.token && /Verifique seu e-mail/.test(r.message) && r.dias === 7, JSON.stringify(r));
});
passo('CORRECAO: sem cartao agora entra no CRM como trial-sem-cartao (era trial-cartao)', () => {
  const cf = leadCrm('eva@y.com').cf;
  exige(cf.origem === 'trial-sem-cartao', 'origem = ' + cf.origem);
  exige(cf.campanha === 'roteiro-02' && cf.pagina_entrada === '/7-dias/', JSON.stringify(cf));
  exige(S.wa.length === 1 && S.wa[0].template.name === 'bv_teste_gratis', 'WhatsApp: ' + JSON.stringify(S.wa));
});
passo('pagina antiga em cache (sem aceite): cadastra, mas NAO manda WhatsApp', () => {
  const r = ctx.registrarTrial_({ nome: 'Fabi Rocha', email: 'fabi@y.com', whatsapp: '94993334444', dias: 7 });
  exige(r.ok, JSON.stringify(r));
  exige(S.wa.length === 1, 'mandou WhatsApp sem autorizacao');
  exige(S.tg.some(t => /WhatsApp NÃO enviado — a pessoa não marcou a autorização/.test(t)), 'Telegram nao avisou a falta de autorizacao');
});
passo('classificacao de origem (inclusive historico de trial_leads)', () => {
  const casos = { 'trial-sem-cartao': 'trial-sem-cartao', 'trial-cartao': 'trial-cartao', 'trial-cartao-14d': 'trial-cartao',
                  '/checkout-trial/?dias=7': 'trial-sem-cartao', '/checkout-trial-cartao/?dias=14': 'trial-cartao',
                  'app-instalado · roteiro-05': 'trial-app', 'trial-app': 'trial-app', '': 'trial-sem-cartao' };
  Object.keys(casos).forEach(k => exige(ctx._clOrigem_(k) === casos[k], k + ' -> ' + ctx._clOrigem_(k)));
});
passo('primeiro contato nao e sobrescrito quando a pessoa volta por outra porta', () => {
  ctx.crmRegistrarLeadTrial_({ email: 'eva@y.com', whatsapp: '94991112222', origem: 'trial-cartao', rota: 'checkout-com-cartao', estagio: 'cartao_iniciado' });
  const cf = leadCrm('eva@y.com').cf;
  exige(cf.origem === 'trial-cartao' && cf.origem_primeira === 'trial-sem-cartao', JSON.stringify(cf));
  return 'agora=' + cf.origem + ', primeira=' + cf.origem_primeira;
});

// ═════════════════════════════════════════════════════════════
console.log('\nPAINEL E ROTAS');
passo('status publico de e-mail: contagem e erro, NENHUM endereco', () => {
  planilhaNova();
  abas.users.appendRow(['u1', 'Davi', 'davi@x.com', ctx.hashPassword('x'), 'admin', '', true, '']);
  S.resend = '403';
  ctx.sendPasswordReset('davi@x.com');
  const r = ctx.getEmailStatus();
  const txt = JSON.stringify(r);
  exige(r.ok && r.data.ultimas24h.total === 1 && r.data.ultimas24h.resendFalhou === 1, txt);
  exige(!/@/.test(txt), 'vazou endereco: ' + txt);
  exige(/not verified/.test(r.data.ultimoErroResend.erro), txt);
  return 'dominio=' + r.data.dominio + ', erro do Resend visivel e sem e-mail';
});
passo('rotas novas no roteador; diagEmailSample fora', () => {
  exige(ctx.handleRequest({ action: 'getOfertaApp' }).data.dias === 14, 'getOfertaApp');
  exige(ctx.handleRequest({ action: 'getEmailSaude', token: 'x' }).error === 'Sem permissão.', 'getEmailSaude sem admin');
  exige(/desconhecida/.test(ctx.handleRequest({ action: 'diagEmailSample', data: { to: 'a@b.com' } }).error), 'diagEmailSample ainda existe');
  const code = fs.readFileSync(path.join(RAIZ, 'code.gs'), 'utf8');
  const lista = code.slice(code.indexOf('function doPost'), code.indexOf("'Acao ou token ausente.'"));
  exige(/'getOfertaApp'/.test(lista) && /'getEmailStatus'/.test(lista), 'faltou na lista publica');
  exige(!/'diagEmailSample'/.test(lista) && !/'getEmailSaude'/.test(lista), 'rota errada na lista publica');
});
passo('painel admin: saude dos e-mails com entrega do Resend', () => {
  S.resend = 'ok';
  ctx.sendPasswordReset('davi@x.com');
  const t = ctx.login('davi@x.com', 'x').token;
  const r = ctx.getEmailSaude(t);
  exige(r.ok && r.data.resend.dominio.status === 'verified' && r.data.gmail.conta === 'wpktavares@gmail.com', JSON.stringify(r.data.resend));
  exige(r.data.ultimos[0].entrega === 'delivered', JSON.stringify(r.data.ultimos[0]));
  return 'cota Gmail ' + r.data.gmail.cotaHoje + ', ultimo: ' + r.data.ultimos[0].entrega;
});

passo('chave do Resend: testa antes de guardar e nunca aceita conta errada', () => {
  const t = ctx.login('davi@x.com', 'x').token;
  const guardada = () => props.get('RESEND_API_KEY');
  const antes = guardada();
  let r = ctx.salvarResendChave(t, { chave: 'abc' });
  exige(!r.ok && /re_/.test(r.error) && guardada() === antes, 'formato: ' + JSON.stringify(r));
  r = ctx.salvarResendChave(t, { chave: 're_invalida_1234567890' });
  exige(!r.ok && /recusou/.test(r.error) && guardada() === antes, 'invalida: ' + JSON.stringify(r));
  r = ctx.salvarResendChave(t, { chave: 're_semdominio_1234567890' });
  exige(!r.ok && /não tem o domínio/.test(r.error) && guardada() === antes, 'sem dominio: ' + JSON.stringify(r));
  r = ctx.salvarResendChave(t, { chave: 're_soenvio_1234567890' });
  exige(r.ok && r.soEnvio && guardada() === 're_soenvio_1234567890', 'so envio: ' + JSON.stringify(r));
  r = ctx.salvarResendChave(t, { chave: 're_completa_1234567890' });
  exige(r.ok && !r.soEnvio && guardada() === 're_completa_1234567890', 'completa: ' + JSON.stringify(r));
  exige(ctx.getEmailSaude(t).data.resend.chaveMascarada === 're_••••••7890', 'mascara');
  r = ctx.salvarResendChave(t, { remover: true });
  exige(r.ok && !guardada(), 'remover');
  exige(ctx.salvarResendChave('token-de-aluno', { chave: 're_completa_1234567890' }).error === 'Sem permissão.', 'sem admin salvou');
  props.set('RESEND_API_KEY', 're_teste_nao_real');
  return '5 casos + remover + sem permissao';
});
passo('sem chave do Resend (como em producao hoje): sai pelo MailApp, sem erro de Gmail, e o status diz isso', () => {
  props.delete('RESEND_API_KEY'); cache.clear();
  S.envios.length = 0;
  const r = ctx.sendPasswordReset('davi@x.com');
  exige(r.ok && S.envios[0].via === 'mailapp' && !S.gmailChamado, JSON.stringify(S.envios));
  exige(!/gmail:/.test(abas.emails_log.rows[abas.emails_log.rows.length - 1][7]), 'erro de Gmail no registro');
  const st = ctx.getEmailStatus().data;
  exige(st.resendConfigurado === false && st.dominio === 'sem_chave', JSON.stringify(st));
  props.set('RESEND_API_KEY', 're_teste_nao_real');
});

// ═════════════════════════════════════════════════════════════
console.log('\nV168 — BOAS-VINDAS GARANTIDAS OU AVISADAS');
function configRito(pares) {
  const cfg = abas.config;
  pares.forEach(p => {
    const i = cfg.rows.findIndex(r => r[0] === p[0]);
    if (i >= 0) cfg.rows[i][1] = p[1]; else cfg.appendRow([p[0], p[1], '']);
  });
  cache.clear();
}
passo('status: tudo configurado e aprovado -> pronto nas duas rotas', () => {
  planilhaNova();
  S.templatesMeta = { bv_teste_gratis: { status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Oi {{1}}, seu teste vai até {{2}}.' }] }, bv_cartao: { status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Oi {{1}}, primeira cobrança em {{2}}.' }] } };
  S.gatilhos = ['stripeBuscarEventos'];
  const d = ctx.getRitoStatus().data;
  exige(d.pronto.semCartao && d.pronto.cartao, JSON.stringify(d));
  exige(d.whatsapp.semCartao.template === 'bv_teste_gratis' && d.whatsapp.semCartao.proprio, JSON.stringify(d.whatsapp.semCartao));
  exige(!/tok|@/.test(JSON.stringify(d)), 'vazou credencial/e-mail: ' + JSON.stringify(d));
  return 'e-mail via ' + d.email.canal + ', WhatsApp pronto';
});
passo('status: cada coisa que falta aparece com o motivo', () => {
  S.templatesMeta = { bv_teste_gratis: { status: 'PENDING', category: 'MARKETING', components: [{ type: 'BODY', text: 'Oi {{1}}, seu teste vai até {{2}}.' }] } };
  S.gatilhos = [];
  configRito([['auto_whats_boasvindas', 'false'], ['auto_whats_boasvindas_sc', 'true']]);
  const d = ctx.getRitoStatus().data;
  exige(!d.pronto.semCartao && d.whatsapp.semCartao.faltas.indexOf('template_nao_aprovado') >= 0, JSON.stringify(d.whatsapp.semCartao));
  exige(d.whatsapp.semCartao.meta.categoria === 'MARKETING', 'categoria');
  const fc = d.whatsapp.cartao.faltas;
  exige(fc.indexOf('automacao_desligada') >= 0 && fc.indexOf('template_nao_existe') >= 0 && fc.indexOf('rotina_stripe_parada') >= 0, JSON.stringify(fc));
  return 'sem cartao: ' + d.whatsapp.semCartao.faltas.join(',') + ' | cartao: ' + fc.join(',');
});
passo('cadastro: o aviso do Telegram traz o resultado das boas-vindas', () => {
  planilhaNova();
  ctx.registrarTrial_({ nome: 'Gabi', email: 'gabi@y.com', whatsapp: '94991230000', rota: 'app-instalado', consentimento: true });
  const m = S.tg[S.tg.length - 1];
  exige(/✅ E-mail enviado/.test(m) && /✅ WhatsApp \(template\) enviado/.test(m) && !/Fale com a pessoa/.test(m), m);
  return 'tudo saiu, sem alarme';
});
passo('WhatsApp desligado no painel: o grupo e avisado com o motivo e o link da pessoa', () => {
  configRito([['auto_whats_boasvindas_sc', 'false']]);
  ctx.registrarTrial_({ nome: 'Hugo', email: 'hugo@y.com', whatsapp: '94991230001', rota: 'app-web', consentimento: true });
  const m = S.tg[S.tg.length - 1];
  exige(/❌ WhatsApp NÃO enviado — automação desligada no painel/.test(m), m);
  exige(/wa\.me\/5594991230001/.test(m), 'sem link da pessoa: ' + m);
  const tl = leadCrm('hugo@y.com').tl.map(t => t.action).join(' / ');
  exige(/WhatsApp não enviado \(desligado no painel\)/.test(tl), 'CRM: ' + tl);
});
passo('falha passageira da Meta (500): tenta de novo e entrega', () => {
  planilhaNova();
  S.waTentativas = 0; S.waFalhas = [500];
  ctx.registrarTrial_({ nome: 'Iara', email: 'iara@y.com', whatsapp: '94991230002', rota: 'app-web', consentimento: true });
  exige(S.waTentativas === 2 && S.wa.length === 1, 'tentativas=' + S.waTentativas + ' enviados=' + S.wa.length);
  exige(/✅ WhatsApp/.test(S.tg[S.tg.length - 1]), S.tg[S.tg.length - 1]);
});
passo('erro de configuracao (400): nao insiste, avisa com a mensagem da Meta', () => {
  S.waTentativas = 0; S.waFalhas = [400];
  ctx.registrarTrial_({ nome: 'Joao', email: 'joao@y.com', whatsapp: '94991230003', rota: 'app-web', consentimento: true });
  exige(S.waTentativas === 1, 'repetiu erro de configuracao: ' + S.waTentativas);
  const m = S.tg[S.tg.length - 1];
  exige(/❌ WhatsApp NÃO enviado — o template não existe nesse idioma/.test(m), m);
});
passo('com cartao: e-mail com resultado REAL e aviso completo no Telegram', () => {
  planilhaNova();
  ctx._tcRegistrarConsentimento_({ email: 'lia@y.com', whatsapp: '+5594991230004', nome: 'Lia Souza', trialDias: 14, valor: 17 });
  S.gatilhos = ['stripeBuscarEventos'];
  let r = ctx.dispararAutomacoesTrial_('lia@y.com', { id: 'sub_1', trial_end: Math.floor(Date.now() / 1000) + 14 * 86400 });
  exige(r.ok && r.resultado.email.ok && r.resultado.email.via === 'resend', 'email: ' + JSON.stringify(r.resultado.email));
  exige(r.resultado.whatsapp.ok && S.wa[0].template.name === 'bv_cartao', 'whatsapp: ' + JSON.stringify(r.resultado.whatsapp));
  const m = S.tg[S.tg.length - 1];
  exige(/Checkout com cartão/.test(m) && /✅ E-mail enviado/.test(m) && /✅ WhatsApp/.test(m), m);
  // todos os canais de e-mail fora: o aviso diz que NAO saiu (antes dizia ok sempre)
  S.resend = '403'; S.gmail = 'throw'; S.mailapp = 'throw'; cache.clear();
  r = ctx.dispararAutomacoesTrial_('lia@y.com', { id: 'sub_2', trial_end: Math.floor(Date.now() / 1000) + 14 * 86400 });
  exige(!r.resultado.email.ok && /❌ E-mail NÃO saiu/.test(S.tg[S.tg.length - 1]), S.tg[S.tg.length - 1]);
  return 'cartao ok + falha de e-mail avisada';
});

passo('criar template do sem cartao: vai para a Meta como UTILITY e ja fica escolhido', () => {
  planilhaNova();
  configRito([['wa_tpl_boasvindas_sc', '']]);           // como em producao: sem template proprio
  abas.users.appendRow(['u1', 'Davi', 'davi@x.com', ctx.hashPassword('x'), 'admin', '', true, '']);
  const t = ctx.login('davi@x.com', 'x').token;
  exige(ctx.waCriarTemplateSemCartao('tok-aluno', {}).error === 'Sem permissão.', 'sem admin criou');
  const r = ctx.waCriarTemplateSemCartao(t, {});
  exige(r.ok && r.status === 'PENDING' && r.nome === 'desafio21_boasvindas_teste_gratis', JSON.stringify(r));
  const p = S.templateCriado;
  exige(p.category === 'UTILITY' && p.language === 'pt_BR' && /\{\{3\}\}/.test(p.components[0].text), JSON.stringify(p));
  exige(p.components[0].example.body_text[0].length === 3 && p.components[1].buttons[0].type === 'URL', 'exemplo/botao');
  exige(!/cobran/i.test(p.components[0].text), 'texto fala de cobranca');
  exige(ctx.getConfig_('wa_tpl_boasvindas_sc') === 'desafio21_boasvindas_teste_gratis' &&
        ctx.getConfig_('wa_tpl_boasvindas_sc_vars') === '["primeiro_nome","dias_trial","fim_teste"]', 'nao ficou escolhido');
  return 'categoria ' + p.category + ', 3 variaveis, botao Abrir o app';
});
passo('template em analise: nao tenta mandar, e o aviso diz o estado real', () => {
  S.templatesMeta = { desafio21_boasvindas_teste_gratis: { status: 'PENDING', category: 'UTILITY', components: [{ type: 'BODY', text: 'Olá, {{1}}! {{2}} dias grátis, até {{3}}.' }] } };
  cache.clear(); S.wa.length = 0;
  ctx.registrarTrial_({ nome: 'Rafa', email: 'rafa@y.com', whatsapp: '94991230009', rota: 'app-web', consentimento: true });
  exige(S.wa.length === 0, 'tentou mandar template pendente');
  exige(/❌ WhatsApp NÃO enviado — template desafio21_boasvindas_teste_gratis ainda em análise na Meta/.test(S.tg[S.tg.length - 1]), S.tg[S.tg.length - 1]);
});
passo('aprovado: sai com nome, dias e fim do teste nas variaveis', () => {
  S.templatesMeta = { desafio21_boasvindas_teste_gratis: { status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Olá, {{1}}! {{2}} dias grátis, até {{3}}.' }] } };
  cache.clear();
  ctx.registrarTrial_({ nome: 'Sara Lima', email: 'sara@y.com', whatsapp: '94991230010', rota: 'app-instalado', consentimento: true });
  exige(S.wa.length === 1 && S.wa[0].template.name === 'desafio21_boasvindas_teste_gratis', JSON.stringify(S.wa));
  const v = S.wa[0].template.components[0].parameters.map(x => x.text);
  exige(v[0] === 'Sara' && v[1] === '14' && /^\d\d\/\d\d\/\d{4}$/.test(v[2]), 'variaveis: ' + v);
  exige(ctx.getRitoStatus().data.pronto.semCartao === true, 'status nao ficou pronto');
  return v.join(' | ');
});

// ═════════════════════════════════════════════════════════════
console.log('\nV171 — O #131008 DOS LEADS DE 30/09');
const TPL_MKT = {
  status: 'APPROVED', category: 'MARKETING',
  components: [
    { type: 'BODY', text: 'Chegou a sua vez, {{1}}! Seus {{2}} dias de acesso completo já estão liberados. ' +
                          'Até {{3}} é tudo por nossa conta. Depois disso, a mensalidade fica R$ {{4}}.' },
    { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Abrir', url: 'https://app.wpktavares.com.br' },
                                 { type: 'QUICK_REPLY', text: 'Tenho dúvida' }] }
  ]
};
passo('o caso real: template do cartao no sem cartao, {{3}} = data da cobranca -> agora sai com o fim do teste', () => {
  planilhaNova();
  S.templatesMeta.desafio21_trial_boasvindas_mkt = TPL_MKT;
  configRito([['wa_tpl_boasvindas_sc', 'desafio21_trial_boasvindas_mkt'],
              ['wa_tpl_boasvindas_sc_vars', '["primeiro_nome","dias_trial","data_cobranca","valor"]']]);
  const r = ctx.registrarTrial_({ nome: 'Salomão Ribeiro', email: 'salomao@y.com', whatsapp: '91985858577', dias: 7,
    consentimento: true, rota: 'checkout-sem-cartao', rastreio: { utm_campaign: '120246976328420179' } });
  exige(r.ok, JSON.stringify(r));
  exige(S.wa.length === 1, 'WhatsApp nao saiu: ' + S.tg[S.tg.length - 1]);
  const v = S.wa[0].template.components.find(c => c.type === 'body').parameters.map(p => p.text);
  exige(v[0] === 'Salomão' && v[1] === '7' && /^\d\d\/\d\d\/\d{4}$/.test(v[2]) && v[3] === '17,00', 'variaveis: ' + v);
  exige(/✅ WhatsApp \(template\) enviado/.test(S.tg[S.tg.length - 1]), S.tg[S.tg.length - 1]);
  return 'Até ' + v[2] + ' é tudo por nossa conta';
});
passo('o teste do painel agora monta os dados como o cadastro real da rota', () => {
  abas.users.appendRow(['u9', 'Davi', 'davi@x.com', ctx.hashPassword('x'), 'admin', '', true, '']);
  const t = ctx.login('davi@x.com', 'x').token;
  S.wa.length = 0;
  const vars = '["primeiro_nome","dias_trial","data_cobranca","valor"]';
  const r1 = ctx.waTestar(t, { numero: '63992998814', template: 'desafio21_trial_boasvindas_mkt', vars: vars, dias: 7, rota: 'sc' });
  const r2 = ctx.waTestar(t, { numero: '63992998814', template: 'desafio21_trial_boasvindas_mkt', vars: vars, dias: 14, rota: 'bv' });
  exige(r1.ok && r2.ok && S.wa.length === 2, JSON.stringify([r1, r2]));
  return 'sem cartao e com cartao: os dois sairam';
});
passo('estrutura: cabecalho com imagem, botao com link variavel e variaveis com NOME', () => {
  S.templatesMeta.tpl_completo = {
    status: 'APPROVED', category: 'UTILITY', parameter_format: 'NAMED',
    components: [
      { type: 'HEADER', format: 'IMAGE' },
      { type: 'BODY', text: 'Oi {{nome}}, seu acesso vai até {{data_fim}}.' },
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Entrar', url: 'https://app.wpktavares.com.br/{{1}}' }] }
    ]
  };
  S.wa.length = 0; cache.clear();
  const r = ctx._waEnviarTemplate_('5594991230000', 'tpl_completo', 'pt_BR', [], { mapaJson: '{}', ctx: { nome: 'Lia Souza', dias: 7, fimTeste: '07/10/2026' } });
  exige(r.ok, JSON.stringify(r));
  const c = S.wa[0].template.components;
  const body = c.find(x => x.type === 'body').parameters;
  exige(body[0].parameter_name === 'nome' && body[0].text === 'Lia' && body[1].parameter_name === 'data_fim' && body[1].text === '07/10/2026', JSON.stringify(body));
  exige(c.find(x => x.type === 'header').parameters[0].image.link, 'sem imagem no cabecalho');
  exige(c.find(x => x.type === 'button').parameters[0].text === '?entrar=1', 'sem sufixo no botao');
  return 'cabecalho + {{nome}}/{{data_fim}} + botao';
});
passo('status: simula o cadastro real e acusa variavel sem mapeamento', () => {
  configRito([['wa_tpl_boasvindas_sc', 'desafio21_trial_boasvindas_mkt'], ['wa_tpl_boasvindas_sc_vars', '["primeiro_nome","dias_trial"]']]);
  const d = ctx.getRitoStatus().data;
  exige(d.whatsapp.semCartao.faltas.indexOf('variavel_sem_mapeamento') >= 0 && !d.pronto.semCartao, JSON.stringify(d.whatsapp.semCartao.faltas));
  configRito([['wa_tpl_boasvindas_sc_vars', '["primeiro_nome","dias_trial","data_cobranca","valor"]']]);
  const d2 = ctx.getRitoStatus().data;
  exige(d2.pronto.semCartao && d2.whatsapp.semCartao.estrutura.corpoVars.length === 4, JSON.stringify(d2.whatsapp.semCartao));
  return 'mapeamento incompleto vira falta; completo fica pronto';
});
passo('reenvio pelo painel: so com autorizacao, com o fim do teste da pessoa', () => {
  const t = ctx.login('davi@x.com', 'x').token;
  S.wa.length = 0;
  let r = ctx.waReenviarBoasVindas(t, { email: 'salomao@y.com' });
  exige(r.ok && S.wa.length === 1 && /\+5591985858577/.test(r.message), JSON.stringify(r));
  const tl = leadCrm('salomao@y.com').tl.map(x => x.action).join(' / ');
  exige(/reenviado pelo painel: enviado/.test(tl), tl);
  ctx.registrarTrial_({ nome: 'Sem Aceite', email: 'semaceite@y.com', whatsapp: '91985850000', dias: 7 });
  r = ctx.waReenviarBoasVindas(t, { email: 'semaceite@y.com' });
  exige(!r.ok && /autorização/.test(r.error), JSON.stringify(r));
  exige(ctx.waReenviarBoasVindas('token-aluno', { email: 'salomao@y.com' }).error === 'Sem permissão.', 'sem admin reenviou');
  exige(ctx.ritoMotivo_('(#131008) Required parameter is missing') === 'faltou um dado que o template exige (variável vazia, imagem do cabeçalho ou botão)', 'motivo');
  return 'reenviou para o Salomao; recusou quem nao autorizou';
});

passo('v170: ingresso de evento sai pelo MailApp com o QR embutido (o GmailApp nao tem permissao)', () => {
  planilhaNova();
  S.gmailChamado = 0;
  ctx.enviarEmailIngresso_({ email: 'convidado@y.com', uuid: 'u-123', nome: 'Convidado Teste', produto: 'Ingresso',
                             codigo: 'ABC123', orderId: 'o1', cpf: '00000000000' });
  const e = S.envios.find(x => x.to === 'convidado@y.com');
  exige(e && e.via === 'mailapp' && /Ingresso Confirmado/.test(e.subject), JSON.stringify(S.envios));
  exige(!S.gmailChamado, 'ainda chamou o GmailApp');
  exige(e.opts && e.opts.htmlBody && e.opts.name && !('from' in e.opts), 'opcoes: ' + JSON.stringify(Object.keys(e.opts || {})));
  return 'MailApp' + (e.opts.inlineImages ? ' + QR embutido' : ' + QR por link');
});

console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nOK — backend da v166 conferido por execucao');
process.exit(falhas ? 1 : 0);
