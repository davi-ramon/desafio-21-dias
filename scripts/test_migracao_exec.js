// Executa migracao.gs de verdade contra servicos Google simulados.
// Percorre a migracao inteira — como a conta antiga, a troca, como a
// conta nova — e os caminhos que PRECISAM recusar.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DAVI = 'davi@gmail.com', WAGNER = 'wagner@gmail.com';
let rodandoComo = DAVI;           // dono do deployment ativo
let logadoNoEditor = DAVI;        // quem clicou Executar no editor

// ── Drive simulado ──
function arquivo(id, nome, dono, bytes) {
  const editores = new Set();
  return { id, nome, dono, bytes, editores,
    getId: () => id, getName: () => nome, getSize: () => bytes,
    getOwner: () => ({ getEmail: () => dono }),
    getEditors: () => [...editores].map(e => ({ getEmail: () => e })),
    addEditor(e) { editores.add(e); } };
}
function pasta(id, nome, dono, arquivos, subpastas) {
  const p = arquivo(id, nome, dono, 0);
  const it = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  p.getFiles = () => it(arquivos || []);
  p.getFolders = () => it(subpastas || []);
  return p;
}
const planilha = arquivo('SHEET1', 'Desafio 21 Dias - Base', DAVI, 2400000);
const script   = arquivo('SCRIPT1', 'Desafio 21 Dias - Sistema', DAVI, 90000);
const pdfs = pasta('UC1', 'Desafio21Dias_User_Content_Private', DAVI, [],
  [pasta('UCa', 'user_1', DAVI, [arquivo('p1', 'livro.pdf', DAVI, 3000000), arquivo('p2', 'b.pdf', DAVI, 1000000)])]);
const pastas = {
  'Comunidade Media': pasta('COM', 'Comunidade Media', DAVI, [arquivo('c1', 'a.jpg', DAVI, 200000)]),
  'Mural Declaracoes Media': pasta('MUR', 'Mural Declaracoes Media', DAVI, [arquivo('m1', 'x.jpg', DAVI, 300000)]),
  'avatars': pasta('AVA', 'avatars', DAVI, [])
  // 'capas' propositalmente ausente
};
const porId = { SHEET1: planilha, SCRIPT1: script, UC1: pdfs };

const props = new Map([['USER_CONTENT_ROOT_FOLDER_ID', 'UC1']]);

// ── Gatilhos por usuario ──
const gatilhos = { [DAVI]: [], [WAGNER]: [] };
function donoDosGatilhos() { return logadoNoEditor === '__admin__' ? rodandoComo : logadoNoEditor; }
let contexto = 'admin';           // 'admin' (web app) ou 'editor'
function quemRoda() { return contexto === 'admin' ? rodandoComo : logadoNoEditor; }
function novoGatilho(fn, desc) { return { fn, desc, getHandlerFunction: () => fn, getEventType: () => 'CLOCK' }; }
['rotinaManha', 'rotinaNight', 'stripeBuscarEventos', 'pushRodarAgenda', 'onLeadFormSubmit', 'syncLeadsFromSheet']
  .forEach(f => gatilhos[DAVI].push(novoGatilho(f, 'original')));

const chamadasSetup = [];
function setupFalso(nome, handlers) {
  return function () {
    chamadasSetup.push(nome + '@' + quemRoda());
    const u = quemRoda();
    gatilhos[u] = gatilhos[u].filter(t => handlers.indexOf(t.fn) < 0);   // apaga-antes
    handlers.forEach(h => gatilhos[u].push(novoGatilho(h, 'via ' + nome)));
  };
}

const log = [];
const ctx = {
  console,
  SPREADSHEET_ID: 'SHEET1',
  getUserByToken: t => (t === 'adm' ? { email: 'admin@x', role: 'admin' } : t === 'alu' ? { role: 'aluno' } : null),
  getSpreadsheet_: () => ({ getId: () => 'SHEET1' }),
  nowISO: () => new Date().toISOString(),
  logAction: (...a) => log.push(a),
  Logger: { log: m => log.push(['Logger', m]) },
  Session: {
    getEffectiveUser: () => ({ getEmail: () => quemRoda() }),
    getActiveUser: () => ({ getEmail: () => quemRoda() })
  },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (props.has(k) ? props.get(k) : null),
    setProperty: (k, v) => props.set(k, String(v)) }) },
  DriveApp: {
    getFileById: id => { if (!porId[id]) throw new Error('arquivo inexistente ' + id); return porId[id]; },
    getFolderById: id => { if (!porId[id]) throw new Error('pasta inexistente ' + id); return porId[id]; },
    getFoldersByName: n => { const p = pastas[n]; let dado = false;
      return { hasNext: () => !!p && !dado, next: () => { dado = true; return p; } }; }
  },
  ScriptApp: {
    getScriptId: () => 'SCRIPT1',
    getProjectTriggers: () => gatilhos[quemRoda()].slice(),
    deleteTrigger: t => { const u = quemRoda(); gatilhos[u] = gatilhos[u].filter(x => x !== t); },
    newTrigger: fn => ({ timeBased: () => ({ everyMinutes: m => ({ create: () => {
      gatilhos[quemRoda()].push(novoGatilho(fn, 'a cada ' + m)); } }) }) })
  },
  setupAutomacaoTriggers: setupFalso('setupAutomacaoTriggers', ['rotinaManha', 'rotinaNight', 'followUpLeadsSemResposta']),
  setupTriggers: setupFalso('setupTriggers', ['syncLeadsFromSheet', 'onLeadFormSubmit']),
  setupAssinaturaTrigger: setupFalso('setupAssinaturaTrigger', ['processarAssinaturasdiarias_']),
  setupReconciliacaoTrigger: setupFalso('x', []), setupLembretesTrial: setupFalso('x', []),
  setupTrialNotifTrigger: setupFalso('x', []), setupMetaTrigger: setupFalso('x', [])
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'migracao.gs'), 'utf8'), ctx, { filename: 'migracao.gs' });

let falhas = 0;
function passo(nome, fn) {
  try { const r = fn(); console.log('  ok    ' + nome + (r ? '  (' + r + ')' : '')); }
  catch (e) { falhas++; console.log('  FALHA ' + nome + '\n        ' + e.message); }
}
function exige(c, msg) { if (!c) throw new Error(msg); }

console.log('\nANTES DA TROCA (rodando como a conta antiga)');
passo('aluno e anonimo sao barrados', () => {
  exige(!ctx.getMigracaoInventario('alu').ok, 'aluno entrou');
  exige(!ctx.migracaoCompartilhar('', { email: WAGNER }).ok, 'anonimo compartilhou');
});
passo('inventario lista tudo', () => {
  const r = ctx.getMigracaoInventario('adm');
  exige(r.ok, r.error);
  const d = r.data;
  exige(d.rodandoComo === DAVI, 'rodandoComo errado: ' + d.rodandoComo);
  exige(!d.trocaFeita, 'troca marcada cedo');
  const nomes = d.itens.map(i => i.nome).join(' | ');
  exige(d.itens.some(i => i.tipo === 'planilha' && i.dono === DAVI), 'planilha: ' + nomes);
  exige(d.itens.some(i => i.tipo === 'script'), 'script ausente');
  exige(d.itens.some(i => i.nome === 'capas' && i.ausente), 'pasta ausente nao sinalizada');
  const uc = d.itens.find(i => /PDFs dos alunos/.test(i.nome));
  exige(uc && uc.arquivos === 2 && uc.bytes === 4000000, 'medicao recursiva dos PDFs errada: ' + JSON.stringify(uc));
  exige(d.gatilhosDesteUsuario.length === 6, 'gatilhos: ' + d.gatilhosDesteUsuario.length);
  return d.itens.length + ' itens, ' + d.gatilhosDesteUsuario.length + ' gatilhos';
});
passo('recusa e-mail invalido e o proprio e-mail', () => {
  exige(!ctx.migracaoCompartilhar('adm', { email: 'nao-e-email' }).ok, 'aceitou invalido');
  exige(!ctx.migracaoCompartilhar('adm', { email: DAVI }).ok, 'aceitou a propria conta');
});
passo('compartilhar da acesso e fotografa os gatilhos', () => {
  const r = ctx.migracaoCompartilhar('adm', { email: WAGNER });
  exige(r.ok, r.error);
  exige(planilha.editores.has(WAGNER) && script.editores.has(WAGNER) && pdfs.editores.has(WAGNER), 'faltou acesso');
  exige(pastas['Mural Declaracoes Media'].editores.has(WAGNER), 'mural sem acesso');
  exige(r.data.itens.some(i => i.nome === 'capas' && !i.ok), 'ausente devia vir como aviso');
  const snap = JSON.parse(props.get('MIG_GATILHOS_SNAPSHOT'));
  exige(snap.de === DAVI && snap.funcoes.length === 6, 'snapshot: ' + JSON.stringify(snap));
  return r.data.itens.filter(i => i.ok).length + '/' + r.data.itens.length + ' com acesso';
});
passo('compartilhar de novo e inofensivo', () => {
  const r = ctx.migracaoCompartilhar('adm', { email: WAGNER });
  exige(r.ok && r.data.itens.filter(i => i.msg === 'ja tinha acesso').length >= 6, 'nao reconheceu acesso existente');
});
passo('inventario agora ve o acesso do destino', () => {
  const d = ctx.getMigracaoInventario('adm').data;
  exige(d.destino === WAGNER, 'destino');
  exige(d.itens.filter(i => !i.ausente).every(i => i.destinoTemAcesso === true), 'algum item sem acesso');
});
passo('recriar gatilhos ANTES da troca e recusado', () => {
  const r = ctx.migracaoRecriarGatilhos('adm');
  exige(!r.ok && /ainda roda/.test(r.error), 'deixou duplicar: ' + JSON.stringify(r));
  exige(gatilhos[DAVI].length === 6, 'mexeu nos gatilhos da conta antiga');
});
passo('apagar gatilhos antigos antes de recriar e recusado', () => {
  contexto = 'editor'; logadoNoEditor = DAVI;
  let recusou = false;
  try { ctx.migracaoApagarMeusGatilhos(); } catch (e) { recusou = /ainda nao foram recriados/.test(e.message); }
  contexto = 'admin';
  exige(recusou && gatilhos[DAVI].length === 6, 'apagou sem ter reposto');
});

console.log('\nDEPOIS DA TROCA (deploy feito pela conta nova)');
rodandoComo = WAGNER;
passo('inventario reconhece a troca', () => {
  const d = ctx.getMigracaoInventario('adm').data;
  exige(d.trocaFeita === true && d.rodandoComo === WAGNER, 'nao viu a troca');
  exige(d.gatilhosDesteUsuario.length === 0, 'conta nova ja tinha gatilhos?');
});
passo('recriar gatilhos como a conta nova', () => {
  const r = ctx.migracaoRecriarGatilhos('adm');
  exige(r.ok, r.error);
  const tem = new Set(gatilhos[WAGNER].map(t => t.fn));
  ['rotinaManha', 'rotinaNight', 'stripeBuscarEventos', 'pushRodarAgenda', 'onLeadFormSubmit', 'syncLeadsFromSheet']
    .forEach(f => exige(tem.has(f), 'faltou recriar ' + f));
  exige(chamadasSetup.filter(c => c === 'setupAutomacaoTriggers@' + WAGNER).length === 1, 'setup chamado 2x');
  exige(chamadasSetup.filter(c => c === 'setupTriggers@' + WAGNER).length === 1, 'setupTriggers 2x');
  exige(!tem.has('followUpLeadsSemResposta'), 'ligou uma automacao que estava desligada');
  exige(gatilhos[WAGNER].length === 6, 'conta nova devia ter exatamente os 6 da antiga, tem ' + gatilhos[WAGNER].length);
  const st = gatilhos[WAGNER].find(t => t.fn === 'stripeBuscarEventos');
  exige(st && st.desc === 'a cada 5', 'agendamento do stripe: ' + (st && st.desc));
  exige(gatilhos[DAVI].length === 6, 'mexeu nos da conta antiga');
  return gatilhos[WAGNER].length + ' gatilhos na conta nova';
});
passo('recriar de novo nao duplica', () => {
  const antes = gatilhos[WAGNER].length;
  ctx.migracaoRecriarGatilhos('adm');
  exige(gatilhos[WAGNER].length === antes, antes + ' -> ' + gatilhos[WAGNER].length);
});
passo('apagar logado como a conta NOVA e recusado', () => {
  contexto = 'editor'; logadoNoEditor = WAGNER;
  let recusou = false;
  try { ctx.migracaoApagarMeusGatilhos(); } catch (e) { recusou = /conta NOVA/.test(e.message); }
  contexto = 'admin';
  exige(recusou && gatilhos[WAGNER].length === 6, 'apagou os gatilhos bons');
});
passo('apagar logado como a conta antiga so leva os dela', () => {
  contexto = 'editor'; logadoNoEditor = DAVI;
  const apagados = ctx.migracaoApagarMeusGatilhos();
  contexto = 'admin';
  exige(apagados.length === 6 && gatilhos[DAVI].length === 0, 'sobrou na antiga');
  exige(gatilhos[WAGNER].length === 6, 'levou os da nova junto');
  return apagados.length + ' apagados, ' + gatilhos[WAGNER].length + ' seguem na conta nova';
});

passo('migracaoAutorizar so le e informa quem roda', () => {
  contexto = 'editor'; logadoNoEditor = WAGNER;
  ctx.SpreadsheetApp = { openById: id => ({ getName: () => 'Base ' + id }) };
  ctx.MailApp = { getRemainingDailyQuota: () => 100 };
  const antes = JSON.stringify(gatilhos);
  const msg = ctx.migracaoAutorizar();
  contexto = 'admin';
  exige(/wagner@gmail\.com/.test(msg) && /Base SHEET1/.test(msg), msg);
  exige(JSON.stringify(gatilhos) === antes, 'mexeu nos gatilhos');
  return msg;
});

console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nMigracao completa executou certo, incluindo as recusas');
process.exit(falhas ? 1 : 0);
