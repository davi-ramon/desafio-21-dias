// Execucao de verdade do front da v166 (harness com DOM simulado):
//   - d21-rastreio.js: primeiro contato preservado, campanha do ultimo
//   - /app/ (entrada): boas-vindas x login, cadastro com o rito completo,
//     conta existente -> login, sessao lembrada, atalho preservado,
//     SW das notificacoes poupado na limpeza
//   - app.html: sessao lembrada, sessao vencida -> login, atalho guardado
//   - checkout sem cartao: aceite obrigatorio + rota/rastreio no envio
//   - instalar: proximo passo depois de instalar
//   - admin: pipeline, detalhe do lead, alunos, automacoes, e-mails
'use strict';
const fs = require('fs');
const path = require('path');
const { carregar } = require('./harness_exec.js');
const PUB = path.join(__dirname, '..', 'site', 'wpktavares-site', 'public');
const RASTREIO_JS = fs.readFileSync(path.join(PUB, 'assets', 'd21-rastreio.js'), 'utf8');

let falhas = 0;
async function passo(nome, fn) {
  try { const r = await fn(); console.log('  ok    ' + nome + (r ? '  (' + r + ')' : '')); }
  catch (e) { falhas++; console.log('  FALHA ' + nome + '\n        ' + (e && e.message)); }
}
function exige(c, m) { if (!c) throw new Error(m); }
const tick = () => new Promise(r => setImmediate(r));
async function ticks(n) { for (let i = 0; i < (n || 6); i++) await tick(); }

// Resposta do Apps Script (texto, como o fetch real devolve)
function respostaGas(obj) { return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(obj)), json: () => Promise.resolve(obj) }); }

// Página com: URL, armazenamento prévio, fetch simulado e o rastreio carregado
function abrir(rel, cfg) {
  cfg = cfg || {};
  const env = { pedidos: [], redirecionou: [], listeners: {} };
  const pag = carregar(path.join(PUB, rel), { antes(ctx, vm) {
    ctx.location.search = cfg.search || '';
    ctx.location.pathname = cfg.pathname || '/app/';
    ctx.location.href = 'https://wpktavares.com.br' + ctx.location.pathname + ctx.location.search;
    ctx.location.origin = 'https://wpktavares.com.br';
    ctx.location.replace = u => env.redirecionou.push(u);
    ctx.location.assign = u => env.redirecionou.push(u);
    ctx.document.referrer = cfg.referrer || '';
    (cfg.local || []).forEach(p => ctx.localStorage.setItem(p[0], p[1]));
    (cfg.sessao || []).forEach(p => ctx.sessionStorage.setItem(p[0], p[1]));
    ctx.setTimeout = fn => { if (cfg.timeoutsRodam) { try { fn(); } catch (e) {} } return 0; };
    ctx.fetch = (url, o) => {
      const corpo = o && o.body ? JSON.parse(o.body) : {};
      env.pedidos.push(corpo);
      return respostaGas((cfg.gas && cfg.gas(corpo)) || { ok: true });
    };
    ctx.addEventListener = (tipo, fn) => { (env.listeners[tipo] = env.listeners[tipo] || []).push(fn); };
    if (cfg.regsSW) ctx.navigator.serviceWorker.getRegistrations = async () => cfg.regsSW;
    const painel = { style: {}, scrollTop: 0 };
    ctx.document.querySelector = sel => (sel === '.right-panel' ? painel : null);
    if (cfg.comRastreio !== false) vm.runInContext(RASTREIO_JS, ctx, { filename: 'd21-rastreio.js' });
  } });
  // cfg.tolerar: aviso de carga que JA existia antes (conferido contra o HEAD)
  const erros = pag.errosCarga.filter(e => !(cfg.tolerar && cfg.tolerar.test(e)));
  exige(!erros.length, 'erro de carga: ' + erros.join(' | '));
  pag.env = env;
  return pag;
}

(async function () {
  // ═══════════════════════════════════════════════════════════
  console.log('\nRASTREIO (d21-rastreio.js)');
  await passo('guarda o primeiro contato e a campanha; outra pagina nao apaga', () => {
    const p1 = abrir('7-dias/index.html', { pathname: '/7-dias/', search: '?utm_source=facebook&utm_medium=paid&utm_campaign=roteiro-05&utm_content=criativo-b', referrer: 'https://l.instagram.com/' });
    const d1 = p1.ctx.D21Rastreio.dados();
    exige(d1.utm_campaign === 'roteiro-05' && d1.landing === '/7-dias/' && d1.referrer === 'https://l.instagram.com/', JSON.stringify(d1));
    const salvo = [['d21_rastreio_1', p1.ctx.localStorage.getItem('d21_rastreio_1')], ['d21_rastreio_ult', p1.ctx.localStorage.getItem('d21_rastreio_ult')]];
    // mesma pessoa, depois, no checkout (sem UTM na URL)
    const p2 = abrir('checkout-trial/index.html', { pathname: '/checkout-trial/', search: '?dias=7', local: salvo });
    const d2 = p2.ctx.D21Rastreio.dados();
    exige(d2.utm_campaign === 'roteiro-05' && d2.landing === '/7-dias/' && d2.pagina === '/checkout-trial/', JSON.stringify(d2));
    return 'campanha sobreviveu ao clique: ' + d2.utm_campaign;
  });

  // ═══════════════════════════════════════════════════════════
  console.log('\nENTRADA DO APP (/app/)');
  await passo('quem nunca entrou ve as boas-vindas', () => {
    const p = abrir('app/index.html');
    exige(p.ctx.__el('viewBoasVindas').style.display === 'block', 'boas-vindas nao apareceu');
    exige(p.ctx.__el('viewLogin').style.display === 'none', 'login apareceu junto');
    exige(p.env.pedidos.some(b => b.action === 'getOfertaApp'), 'nao buscou os dias da oferta');
  });
  await passo('quem ja entrou neste aparelho vai direto ao login, com o e-mail', () => {
    const p = abrir('app/index.html', { local: [['d21_ultimo_email', 'ana@x.com']] });
    exige(p.ctx.__el('viewLogin').style.display === 'contents', 'nao foi para o login');
    exige(p.ctx.__el('email').value === 'ana@x.com', 'e-mail nao veio preenchido');
  });
  await passo('link do e-mail (?entrar=1) e sessao vencida (?expirou=1)', () => {
    const p = abrir('app/index.html', { search: '?entrar=1&expirou=1' });
    exige(p.ctx.__el('viewLogin').style.display === 'contents', 'nao abriu o login');
    exige(/sessão terminou/.test(p.ctx.__el('msgSuccess').textContent || ''), 'sem aviso de sessao vencida');
  });
  await passo('sessao lembrada: app reaberto entra direto, com o atalho do icone', () => {
    const p = abrir('app/index.html', { search: '?atalho=meditacao&fonte=pwa', local: [['crm_token', 'TK1'], ['crm_user', '{"name":"Ana"}']] });
    exige(p.env.redirecionou[0] === './app.html?atalho=meditacao&fonte=pwa', 'foi para: ' + p.env.redirecionou[0]);
    exige(p.ctx.sessionStorage.getItem('crm_token') === 'TK1', 'sessao nao copiada para a aba');
  });
  await passo('limpeza de service worker poupa o das notificacoes', async () => {
    const apagados = [];
    const reg = url => ({ active: { scriptURL: url }, unregister: async () => { apagados.push(url); return true; } });
    abrir('app/index.html', { regsSW: [reg('https://wpktavares.com.br/firebase-messaging-sw.js'), reg('https://wpktavares.com.br/sw-velho.js')] });
    await ticks();
    exige(apagados.length === 1 && /sw-velho/.test(apagados[0]), 'apagou: ' + apagados.join(', '));
  });
  await passo('cadastro sem autorizacao nao envia nada', async () => {
    const p = abrir('app/index.html');
    const el = p.ctx.__el;
    el('cadNome').value = 'Carla'; el('cadEmail').value = 'carla@y.com'; el('cadZap').value = '(94) 99123-4567';
    const antes = p.env.pedidos.length;
    p.ctx.doCadastro();
    await ticks();
    exige(p.env.pedidos.length === antes, 'enviou sem autorizacao');
    exige(/autoriza/.test(el('cadErro').textContent || ''), 'erro: ' + el('cadErro').textContent);
  });
  await passo('cadastro completo: mesmo rito do checkout e entra logada', async () => {
    const p = abrir('app/index.html', {
      search: '?fonte=pwa', timeoutsRodam: true,
      local: [['d21_rastreio_1', JSON.stringify({ pagina: '/instalar/', quando: '2026-09-27T12:00:00Z', utm_campaign: 'roteiro-05', utm_source: 'facebook' })]],
      gas: b => b.action === 'registrarTrial'
        ? { ok: true, token: 'NOVO', user: { name: 'Carla', email: 'carla@y.com', role: 'aluno' }, message: 'Seu teste de 7 dias começou!' }
        : { ok: true, data: { dias: 7 } }
    });
    const el = p.ctx.__el;
    el('cadNome').value = '  Carla  '; el('cadEmail').value = 'Carla@Y.com'; el('cadZap').value = '(94) 99123-4567';
    el('cadAceite').checked = true;
    p.ctx.doCadastro();
    await ticks();
    const env = p.env.pedidos.find(b => b.action === 'registrarTrial');
    exige(env, 'nao chamou registrarTrial');
    const d = env.data;
    exige(d.nome === 'Carla' && d.email === 'carla@y.com' && d.whatsapp === '94991234567', JSON.stringify(d));
    exige(d.rota === 'app-instalado' && d.consentimento === true, 'rota/aceite: ' + d.rota + '/' + d.consentimento);
    exige(d.rastreio && d.rastreio.utm_campaign === 'roteiro-05' && d.rastreio.landing === '/instalar/', 'rastreio: ' + JSON.stringify(d.rastreio));
    exige(p.ctx.localStorage.getItem('crm_token') === 'NOVO' && p.ctx.sessionStorage.getItem('crm_token') === 'NOVO', 'sessao nao lembrada');
    exige(p.env.redirecionou.indexOf('./app.html?boasvindas=1') >= 0, 'foi para: ' + p.env.redirecionou);
    return 'rota ' + d.rota + ', campanha ' + d.rastreio.utm_campaign;
  });
  await passo('e-mail que ja tem conta: vai para o login com aviso', async () => {
    const p = abrir('app/index.html', { gas: b => b.action === 'registrarTrial' ? { ok: false, existe: true, error: 'x' } : { ok: true } });
    const el = p.ctx.__el;
    el('cadNome').value = 'Ana'; el('cadEmail').value = 'ana@x.com'; el('cadZap').value = '94991234567'; el('cadAceite').checked = true;
    p.ctx.doCadastro();
    await ticks();
    exige(el('viewLogin').style.display === 'contents', 'nao foi para o login');
    exige(el('email').value === 'ana@x.com' && /já tem conta/.test(el('msgSuccess').textContent || ''), el('msgSuccess').textContent);
    exige(p.env.redirecionou.length === 0, 'redirecionou sem sessao');
  });
  await passo('login lembra a sessao e o e-mail; "manter conectado" desmarcado nao lembra', async () => {
    for (const lembrar of [true, false]) {
      const p = abrir('app/index.html', { timeoutsRodam: true, gas: b => b.action === 'login' ? { ok: true, token: 'TL', user: { name: 'Ana' } } : { ok: true } });
      const el = p.ctx.__el;
      el('email').value = 'ana@x.com'; el('password').value = 'segredo'; el('lembrar').checked = lembrar;
      p.ctx.doLogin();
      await ticks();
      exige(p.ctx.sessionStorage.getItem('crm_token') === 'TL', 'sem sessao na aba');
      exige((p.ctx.localStorage.getItem('crm_token') === 'TL') === lembrar, 'lembrar=' + lembrar + ' ficou ' + p.ctx.localStorage.getItem('crm_token'));
      exige(p.ctx.localStorage.getItem('d21_ultimo_email') === 'ana@x.com', 'e-mail nao lembrado');
    }
  });
  await passo('sugestao de e-mail digitado errado', () => {
    const p = abrir('app/index.html');
    const el = p.ctx.__el;
    el('cadEmail').value = 'carla@gmial.com';
    p.ctx._sugerirEmail();
    exige(el('cadSugBtn').textContent === 'carla@gmail.com', 'sugeriu: ' + el('cadSugBtn').textContent);
  });
  await passo('servidor devolvendo HTML (cold start): tenta de novo e nao quebra', async () => {
    let n = 0;
    const p = abrir('app/index.html', { timeoutsRodam: true });
    p.ctx.fetch = () => { n++; return Promise.resolve({ text: () => Promise.resolve(n === 1 ? '<html>oops</html>' : '{"ok":true,"x":1}') }); };
    const r = await p.ctx._postPublico('getOfertaApp', {});
    exige(r.ok && r.x === 1 && n === 2, 'tentativas=' + n);
  });

  // ═══════════════════════════════════════════════════════════
  console.log('\nAPP (app.html)');
  await passo('sessao lembrada vale quando a aba nao tem', () => {
    const p = abrir('app/app.html', { pathname: '/app/app.html', local: [['crm_token', 'TK9'], ['crm_user', '{"name":"Bia","email":"b@x.com"}']], comRastreio: false });
    const APP = p.ctx.__ler('APP');
    exige(APP.token === 'TK9' && APP.userName === 'Bia', 'APP.token=' + APP.token);
    exige(p.ctx.sessionStorage.getItem('crm_token') === 'TK9', 'nao copiou para a aba');
  });
  await passo('sessao vencida: limpa e vai para o login com aviso (antes: app vazio)', async () => {
    const p = abrir('app/app.html', { pathname: '/app/app.html', local: [['crm_token', 'VELHO']], comRastreio: false });
    p.ctx.rpc = async () => ({ ok: false, error: 'Não autorizado.' });
    p.ctx.__ler('(function(){ rpc = globalThis.rpc; })()');
    await p.ctx.loadAlunoData();
    exige(p.env.redirecionou.some(u => /\/app\/\?entrar=1&expirou=1$/.test(u)), 'foi para: ' + p.env.redirecionou);
    exige(!p.ctx.localStorage.getItem('crm_token'), 'token velho ficou guardado');
  });
  await passo('atalho do icone sobrevive a limpeza da barra', () => {
    const p = abrir('app/app.html', { pathname: '/app/app.html', comRastreio: false });
    const foi = [];
    p.ctx.__ler('(function(){ navigate = function (x) { globalThis.__foi.push(x); }; })()'.replace('globalThis.__foi', '__foi'));
    p.ctx.__foi = foi;
    p.ctx.__ler('APP')._atalho = 'mural';
    p.ctx.pwAtalho();
    exige(foi[0] === 'mural', 'navegou para: ' + foi);
    exige(p.ctx.__ler('APP')._atalho === '', 'atalho repetiria');
  });

  // ═══════════════════════════════════════════════════════════
  console.log('\nCHECKOUT SEM CARTAO');
  await passo('sem marcar a autorizacao nao cadastra', async () => {
    const p = abrir('checkout-trial/index.html', { pathname: '/checkout-trial/', search: '?dias=7' });
    const el = p.ctx.__el;
    el('nome').value = 'Eva Maria'; el('email').value = 'eva@y.com'; el('whatsapp').value = '(94) 99111-2222';
    p.ctx.handleSubmit();
    await ticks();
    exige(!p.env.pedidos.some(b => b.action === 'registrarTrial'), 'cadastrou sem autorizacao');
  });
  await passo('com autorizacao: manda rota, rastreio e aceite', async () => {
    const p = abrir('checkout-trial/index.html', { pathname: '/checkout-trial/', search: '?dias=7&utm_campaign=roteiro-02' });
    const el = p.ctx.__el;
    el('nome').value = 'Eva Maria'; el('email').value = 'eva@y.com'; el('whatsapp').value = '(94) 99111-2222';
    el('aceite').checked = true;
    p.ctx.handleSubmit();
    await ticks();
    const b = p.env.pedidos.find(x => x.action === 'registrarTrial');
    exige(b && b.data.rota === 'checkout-sem-cartao' && b.data.consentimento === true, JSON.stringify(b && b.data));
    exige(b.data.rastreio.utm_campaign === 'roteiro-02', 'rastreio: ' + JSON.stringify(b.data.rastreio));
  });

  // ═══════════════════════════════════════════════════════════
  console.log('\nPAGINA DE INSTALACAO');
  await passo('depois de instalar: modal com o proximo passo', () => {
    const p = abrir('instalar/index.html', { pathname: '/instalar/' });
    const fns = p.env.listeners.appinstalled || [];
    exige(fns.length, 'nao ouve appinstalled');
    fns.forEach(f => f());
    const h = p.ctx.__el('mCx').innerHTML;
    exige(/app instalado/.test(h) && /Crie sua conta/.test(h) && /\/app\/\?fonte=pwa/.test(h), h.slice(0, 120));
  });

  // ═══════════════════════════════════════════════════════════
  console.log('\nADMIN');
  const adm = abrir('admin/index.html', { pathname: '/admin/', comRastreio: false, tolerar: /bloco 1: ReferenceError: CRM is not defined/ });
  const A = adm.ctx;
  const CF = { origem: 'trial-app', origem_primeira: 'trial-sem-cartao', rota: 'app-instalado', campanha: 'roteiro-05',
               utm_source: 'facebook', utm_medium: 'paid', utm_content: 'criativo-b', pagina_entrada: '/instalar/',
               dispositivo: 'android-app', consentimento_em: '2026-09-28T12:00:00Z', termos_versao: 'contato-2026-09-v1', oferta_dias: 7 };
  await passo('pipeline: card mostra a rota', () => {
    const h = A.renderCardHTML({ id: 'l1', name: 'Carla', email: 'c@y.com', phone: '+5594991234567', status: 'Interessado', custom_fields: JSON.stringify(CF) }, 0);
    exige(/platform-badge/.test(h) && />App</.test(h), h.slice(0, 200));
  });
  await passo('detalhe do lead: secao Rastreamento completa', () => {
    const h = A._crmRastroHtml(CF);
    ['Rastreamento', 'App instalado', 'roteiro-05', 'facebook / paid', 'criativo-b', '/instalar/', 'Android · app instalado', 'contato-2026-09-v1', 'Teste — sem cartão']
      .forEach(t => exige(h.indexOf(t) >= 0, 'faltou "' + t + '"'));
  });
  await passo('alunos: coluna Origem', async () => {
    A.rpc = async () => ({ ok: true, data: [{ nome: 'Carla', email: 'c@y.com', telefone: '+55', paidAt: '', produto: 'Desafio 21 Dias — Trial 7 dias (app)',
      diaAtual: 1, progresso: 5, ativo: true, origem: 'trial-app', rota: 'app-instalado', campanha: 'roteiro-05', dispositivo: 'ios-app' },
      { nome: 'Rui', email: 'r@y.com', produto: 'Plano mensal', diaAtual: 3, progresso: 10, ativo: true }] });
    A.__ler('(function(){ rpc = globalThis.rpc; })()');
    await A.renderCompradores();
    const h = A.__el('content').innerHTML;
    exige(/<th>Origem<\/th>/.test(h) && />App</.test(h) && /roteiro-05/.test(h) && />Compra</.test(h), 'tabela sem origem');
  });
  await passo('automacoes: WhatsApp sem cartao + dias do app, e o salvar leva tudo', async () => {
    let salvo = null;
    A.rpc = async (acao, dados) => {
      if (acao === 'waStatus') return { ok: true, data: { temToken: true, tokenMascarado: '••1234', wabaId: '1', phoneId: '2', conectado: true,
        autoWhatsBoasVindas: true, autoWhatsBoasVindasSc: true, boasVindasScEfetivo: { nome: 'bv_teste_gratis', proprio: true },
        trialDiasApp: 7, lembreteDias: '2' } };
      if (acao === 'waSalvarConfig') { salvo = dados.cfg; return { ok: true }; }
      return { ok: true, data: {} };
    };
    A.__ler('(function(){ rpc = globalThis.rpc; })()');
    await A.renderTrialAuto();
    const h = A.__el('content').innerHTML;
    exige(/ta_zapsc/.test(h) && /bv_teste_gratis/.test(h) && /ta_dias_app/.test(h) && /7 dias \(padr/.test(h), 'tela sem os campos novos');
    A.__el('ta_dias_app').value = '14'; A.__el('ta_zapsc').checked = true;
    await A.taSalvar(false);
    exige(salvo && salvo.trialDiasApp === '14' && salvo.autoWhatsBoasVindasSc === true, JSON.stringify(salvo));
  });
  await passo('e-mails: painel com canal, erro do Resend e entrega', async () => {
    A.rpc = async () => ({ ok: true, data: {
      resend: { configurado: true, dominio: { status: 'verified' }, remetente: 'Desafio 21 Dias <suporte@wpktavares.com.br>' },
      gmail: { conta: 'wpktavares@gmail.com', cotaHoje: 87 },
      ultimas24h: { contagem: { total: 3, resend: 1, gmail: 1, mailapp: 0, falhas: 1, resendFalhou: 1 },
                    ultimaFalha: { erro: 'mailapp: cota' }, ultimoErroResend: { erro: 'resend: HTTP 403 domain not verified' } },
      ultimos: [{ quando: '2026-09-28T12:00:00Z', tipo: 'senha', para: 'davi@x.com', via: 'resend', ok: true, id: 'r1', entrega: 'delivered', erro: '' },
                { quando: '2026-09-28T11:00:00Z', tipo: '2fa', para: 'davi@x.com', via: '', ok: false, erro: 'resend: HTTP 403 | gmail: cota' }] } });
    A.__ler('(function(){ rpc = globalThis.rpc; })()');
    await A.renderEmailSaude();
    const h = A.__el('content').innerHTML;
    ['Entregue', 'Não saiu', 'Recuperação de senha', 'O Resend recusou 1', 'wpktavares@gmail.com', 'Verificado', 'Enviar e-mail de teste']
      .forEach(t => exige(h.indexOf(t) >= 0, 'faltou "' + t + '"'));
  });

  await passo('e-mails sem Resend: aviso em destaque + campo da chave, que some da tela ao salvar', async () => {
    let pedido = null;
    A.rpc = async (acao, dados) => {
      if (acao === 'salvarResendChave') { pedido = dados; return { ok: true, message: 'Chave salva' }; }
      return { ok: true, data: { resend: { configurado: false, dominio: { status: 'sem_chave' }, remetente: 'x' },
        gmail: { conta: 'wpktavares@gmail.com', cotaHoje: 80 }, ultimas24h: { contagem: {} }, ultimos: [] } };
    };
    A.__ler('(function(){ rpc = globalThis.rpc; })()');
    await A.renderEmailSaude();
    const h = A.__el('content').innerHTML;
    exige(/O Resend não está configurado/.test(h) && /emsChave/.test(h) && /Sending access/.test(h), 'sem aviso/campo');
    A.__el('emsChave').value = 're_colada_1234567890';
    A.acaoBotao = async (b, fn) => fn();
    A.__ler('(function(){ acaoBotao = globalThis.acaoBotao; })()');
    await A.emsSalvarChave({});
    exige(pedido && pedido.chave === 're_colada_1234567890', JSON.stringify(pedido));
    exige(A.__el('emsChave').value === '', 'a chave ficou na tela');
  });

  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nOK — front da v166 conferido por execucao');
  process.exit(falhas ? 1 : 0);
})();
