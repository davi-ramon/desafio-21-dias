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
// Promessa rejeitada sem tratamento (render assíncrono de algum cartão) não
// pode derrubar a bateria em silêncio: vira falha com a mensagem.
process.on('unhandledRejection', e => { falhas++; console.log('  FALHA (rejeicao solta) ' + (e && e.message)); });
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
  // o rpc VERDADEIRO, antes de qualquer teste trocar por um falso
  const RPC_ORIGINAL = A.__ler('rpc');
  const usarRpcOriginal = () => A.__ler('(function (f) { rpc = f; })')(RPC_ORIGINAL);
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
      if (acao === 'capiStatus') return { ok: true, data: { ativo: true, pixelId: '1', temToken: true, tokenMascarado: '••', testCode: '', eventos: {} } };
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

  // ── v169 ──────────────────────────────────────────────────
  const RITO = (semCartao, cartao, pronto) => ({ ok: true, data: {
    email: { canal: 'gmail', semCartao: true, cartao: true },
    whatsapp: { credenciais: true, conectado: true, semCartao: semCartao, cartao: cartao },
    rotinaStripe: true, pronto: pronto } });
  const TEMPLATES = [
    { nome: 'desafio21_trial_boasvindas_mkt', idioma: 'pt_BR', status: 'APPROVED', categoria: 'MARKETING', variaveis: 3,
      corpo: 'Oi {{1}}! Seu teste de {{2}} dias começou. Primeira cobrança em {{3}}.' },
    { nome: 'desafio21_boasvindas_teste_gratis', idioma: 'pt_BR', status: 'APPROVED', categoria: 'UTILITY', variaveis: 3,
      corpo: 'Olá, {{1}}! Sua conta foi criada, {{2}} dias grátis até {{3}}.' }
  ];
  function botaoFalso(ds) {
    const cls = new Set();
    const b = {
      dataset: Object.assign({}, ds || {}), disabled: false, style: { minWidth: '' }, offsetWidth: 150,
      offsetParent: {}, isConnected: true, attrs: {}, _filhos: [],
      classList: { add: (...c) => c.forEach(x => cls.add(x)), remove: (...c) => c.forEach(x => cls.delete(x)), contains: c => cls.has(c) },
      getAttribute: k => (k in b.attrs ? b.attrs[k] : null), setAttribute: (k, v) => { b.attrs[k] = String(v); },
      removeAttribute: k => { delete b.attrs[k]; },
      querySelector: () => b._filhos.find(f => f.className === 'fb-ico') || null,
      appendChild: f => { b._filhos.push(f); f.remove = () => { b._filhos = b._filhos.filter(x => x !== f); }; return f; },
      closest: () => null
    };
    b.cls = cls;
    return b;
  }

  await passo('v169: rpc do admin tenta de novo quando o servidor devolve HTML (era o erro dos templates)', async () => {
    const fila = [];
    A.setTimeout = fn => { fila.push(fn); return fila.length; };
    let n = 0;
    A.fetch = () => { n++; return Promise.resolve({ text: () => Promise.resolve(n < 3 ? '<!DOCTYPE html><html>erro</html>' : '{"ok":true,"data":[1]}') }); };
    usarRpcOriginal();
    const p = A.__ler('rpc')('waListarTemplates', {});
    for (let i = 0; i < 20 && n < 3; i++) { await tick(); while (fila.length) fila.shift()(); }
    const r = await p;
    exige(r.ok && n === 3, 'tentativas=' + n);
    // 3 respostas HTML seguidas: erro claro, sem "Unexpected token"
    n = -10;
    const p2 = A.__ler('rpc')('waListarTemplates', {}).then(() => 'resolveu', e => e.message);
    for (let i = 0; i < 20; i++) { await tick(); while (fila.length) fila.shift()(); }
    const m = await p2;
    exige(/não respondeu direito/.test(m) && !/Unexpected token/.test(m), m);
    return '2 paginas HTML -> 3a tentativa ok';
  });

  await passo('v169: botao que chama o servidor trava, carrega, e fecha com ✓ azul', async () => {
    const fila = [];
    A.setTimeout = fn => { fila.push(fn); return fila.length; };
    let resolver;
    A.fetch = () => new Promise(r => { resolver = () => r({ text: () => Promise.resolve('{"ok":true}') }); });
    usarRpcOriginal();
    const b = botaoFalso();
    const FB = A.__ler('FB');
    FB.botao = b; FB.ate = Date.now() + 700; FB.cliqueEm = Date.now();
    const p = A.__ler('rpc')('waSalvarConfig', { cfg: {} });
    exige(b.disabled && b.cls.has('fb-on') && /fb-spin/.test(b._filhos[0].innerHTML), 'nao entrou em carregando');
    // segundo clique no mesmo botao: ignorado (disabled)
    exige(b.disabled === true, 'nao travou');
    resolver();
    await p; await ticks();
    while (fila.length && !b.cls.has('fb-ok')) { fila.shift()(); await ticks(2); }
    exige(b.cls.has('fb-ok') && /M5 12\.5/.test(b._filhos[0].innerHTML) && /Pronto/.test(b._filhos[0].innerHTML), 'sem estado de sucesso');
    while (fila.length) { fila.shift()(); await ticks(2); }
    exige(!b.cls.has('fb-on') && !b.cls.has('fb-ok') && b.disabled === false && !b._filhos.length, 'nao voltou ao normal');
  });

  await passo('v169: resposta negativa -> ✕ vermelho, motivo no botao e aviso na tela', async () => {
    const fila = [];
    A.setTimeout = fn => { fila.push(fn); return fila.length; };
    A.fetch = () => Promise.resolve({ text: () => Promise.resolve('{"ok":false,"error":"Template não existe"}') });
    const avisos = [];
    const toastOrig = A.__ler('toast');
    A.__ler("(function(){ toast = function (m, t) { __avisos.push(t + ':' + m); }; })()");
    A.__avisos = avisos;
    usarRpcOriginal();
    const b = botaoFalso();
    const FB = A.__ler('FB');
    FB.botao = b; FB.ate = Date.now() + 700; FB.cliqueEm = Date.now(); FB.toastEm = 0;
    await A.__ler('rpc')('waTestar', {});
    await ticks();
    while (fila.length && !b.cls.has('fb-erro')) { fila.shift()(); await ticks(2); }
    exige(b.cls.has('fb-erro') && /M7 7l10 10/.test(b._filhos[0].innerHTML) && b.attrs.title === 'Template não existe', 'sem estado de erro');
    while (fila.length) { fila.shift()(); await ticks(2); }
    exige(avisos.some(a => a === 'error:Template não existe'), 'sem aviso: ' + avisos);
    exige(!b.cls.has('fb-erro') && b.disabled === false, 'nao voltou ao normal');
    A.__ler('(function(t){ toast = t; })')(toastOrig);
  });

  await passo('v169: quadro por rota — escolher, ver aviso, testar e salvar como padrao', async () => {
    let testado = null, salvo = null, ligado = null;
    A.setTimeout = () => 0;
    A.rpc = async (acao, dados) => {
      if (acao === 'getRitoStatus') return RITO(
        { ligado: true, template: '', proprio: false, meta: null, faltas: ['template_nao_escolhido'] },
        { ligado: true, template: 'desafio21_trial_boasvindas_mkt', meta: { status: 'APPROVED', categoria: 'MARKETING' }, faltas: [] },
        { semCartao: false, cartao: true });
      if (acao === 'waListarTemplates') return { ok: true, data: TEMPLATES };
      if (acao === 'waTestar') { testado = dados; return { ok: true, message: 'Enviado' }; }
      if (acao === 'waSalvarConfig') { if (dados.cfg.tplBoasVindasSc || dados.cfg.tplBoasVindas) salvo = dados.cfg; else ligado = dados.cfg; return { ok: true }; }
      return { ok: true, data: {} };
    };
    A.acaoBotao = async (b, fn) => { const r = await fn(); if (r && r.ok && r.depois) await r.depois(); return r; };
    A.__ler('(function(){ rpc = globalThis.rpc; acaoBotao = globalThis.acaoBotao; })()');
    A.__ler('TA').cfg = { tplBoasVindas: 'desafio21_trial_boasvindas_mkt', tplBoasVindasVars: '["primeiro_nome","dias_trial","data_cobranca"]', trialDiasApp: 7 };
    A.__ler('TA').templates = [];
    await A.taRitoCarregar(true);
    const h = A.__el('taRitoBox').innerHTML;
    ['Sem cart&atilde;o e app', 'Com cart&atilde;o', 'ta_tpl_sc', 'ta_tpl_bv', 'Testar no meu n&uacute;mero', 'Salvar como padr&atilde;o',
     'ta_rt_liga_sc', 'Seu WhatsApp (para os testes)', 'Nenhum template escolhido']
      .forEach(t => exige(h.indexOf(t) >= 0, 'faltou "' + t + '"'));
    // escolhe o template DO CARTAO para o sem cartao: avisa de cobranca e MARKETING
    A.__el('ta_tpl_sc').value = 'desafio21_trial_boasvindas_mkt';
    A.taAoTrocarTemplate('sc');
    const aviso = A.__el('ta_aviso_sc').innerHTML;
    exige(/cobran/.test(aviso) && /MARKETING/.test(aviso), 'avisos: ' + aviso);
    // testa e salva como padrao do sem cartao
    A.__el('ta_teste_num').value = '63992998814';
    A.__el('ta_v_sc_1').value = 'primeiro_nome'; A.__el('ta_v_sc_2').value = 'dias_trial'; A.__el('ta_v_sc_3').value = 'fim_teste';
    await A.taRitoTestar({ dataset: { pref: 'sc' } });
    exige(testado && testado.template === 'desafio21_trial_boasvindas_mkt' && testado.numero === '63992998814' &&
          testado.vars === '["primeiro_nome","dias_trial","fim_teste"]' && testado.dias === 7, JSON.stringify(testado));
    await A.taRitoSalvar({ dataset: { pref: 'sc' } });
    exige(salvo && salvo.tplBoasVindasSc === 'desafio21_trial_boasvindas_mkt' && salvo.tplBoasVindasScVars === '["primeiro_nome","dias_trial","fim_teste"]'
          && !('tplBoasVindas' in salvo), JSON.stringify(salvo));
    // desliga o envio da rota
    const chave = { dataset: { pref: 'sc' }, checked: false };
    await A.taRitoLigar(chave);
    exige(ligado && ligado.autoWhatsBoasVindasSc === false, JSON.stringify(ligado));
    return 'testou e salvou ' + salvo.tplBoasVindasSc + ' no sem cartao';
  });

  await passo('v169: criar template novo do sem cartao continua funcionando', async () => {
    let criado = null;
    A.rpc = async (acao, dados) => {
      if (acao === 'getRitoStatus') return RITO(
        { ligado: true, template: '', proprio: false, meta: null, faltas: ['template_nao_escolhido'] },
        { ligado: true, template: 'x', meta: { status: 'APPROVED', categoria: 'UTILITY' }, faltas: [] },
        { semCartao: false, cartao: true });
      if (acao === 'waListarTemplates') return { ok: true, data: TEMPLATES };
      if (acao === 'waCriarTemplateSemCartao') { criado = dados; return { ok: true, nome: dados.nome, status: 'PENDING', message: 'Enviado para a Meta aprovar.' }; }
      return { ok: true, data: {} };
    };
    A.__ler('(function(){ rpc = globalThis.rpc; })()');
    await A.taRitoCarregar(true);
    exige(/Criar um template novo do sem cart/.test(A.__el('taRitoBox').innerHTML), 'sem botao de criar');
    A.taCriarTemplateSc();
    exige(/Sua conta no Desafio 21 Dias foi criada/.test(A.__el('tsc_texto').value), 'texto padrao nao carregou');
    A.__el('tsc_nome').value = 'desafio21_boasvindas_teste_gratis';
    A.__el('tsc_cat').value = 'UTILITY';
    await A.taEnviarTemplateSc();
    exige(criado && criado.categoria === 'UTILITY' && /\{\{1\}\}/.test(criado.texto), JSON.stringify(criado));
  });

  await passo('v171/v172: lead de teste tem "Boas-vindas" na barra de acoes e chama o reenvio', async () => {
    let corpo = '', pedido = null;
    const modalOrig = A.__ler('openModal');
    A.__ler('(function(){ openModal = function (t, b) { __corpo(b); }; })()');
    A.__corpo = b => { corpo = b; };
    A.rpc = async (acao, dados) => {
      if (acao === 'getLead') return { ok: true, data: { id: 'l1', name: 'Salomão', email: 'salomao@y.com', phone: '+5591985858577',
        status: 'Interessado', custom_fields: JSON.stringify({ origem: 'trial-sem-cartao', consentimento_em: '2026-09-30T21:38:00Z' }),
        form_answers: '{}', timeline: '[]' } };
      if (acao === 'waReenviarBoasVindas') { pedido = dados; return { ok: true, message: 'Boas-vindas enviadas.' }; }
      return { ok: true, data: {} };
    };
    A.acaoBotao = async (b, fn) => fn();
    A.__ler('(function(){ rpc = globalThis.rpc; acaoBotao = globalThis.acaoBotao; })()');
    await A.openLeadDetail('l1');
    exige(/leadBoasVindasZap\(this\)/.test(corpo), 'sem botao de boas-vindas na barra');
    await A.leadBoasVindasZap({});
    exige(pedido && pedido.email === 'salomao@y.com', JSON.stringify(pedido));
    A.__ler('(function (f) { openModal = f; })')(modalOrig);
  });

  // ── v172: CRM ────────────────────────────────────────────────
  const ETAPAS = [
    { id: 'interessado', nome: 'Interessado', cor: '#4caf50', papel: 'entrada' },
    { id: 'contato', nome: 'Contato feito', cor: '#a855f7', papel: '' },
    { id: 'qualificado', nome: 'Qualificado', cor: '#3b82f6', papel: 'qualificado' },
    { id: 'fechado', nome: 'Fechado', cor: '#6dde71', papel: 'fechado' }
  ];
  const LEADS = [
    { id: 'a1b2c3', name: "Tereza D'Ávila", email: 'tekadavila@hotmail.com', phone: '5579999828295', status: 'Interessado', custom_fields: '{}' },
    { id: 'd4e5f6', name: 'Israel Custódio', email: 'israel@gmail.com', phone: '5511988887777', status: 'Contato feito', custom_fields: '{}' },
    { id: 'g7h8i9', name: 'Cleide', email: 'cleide@gmail.com', phone: '', status: 'Fechado', custom_fields: '{}' }
  ];
  await passo('v172: quadro com as etapas do servidor, barra de busca e "Nova etapa"', () => {
    const CRMo = A.__ler('CRM');
    CRMo.user = { role: 'admin', email: 'davi@x.com' };
    CRMo.leads = LEADS.slice();
    A._crmAplicarEtapas(ETAPAS);
    const orig = A.document.getElementById;
    A.document.getElementById = id => (id === 'pipBarra' ? null : orig(id));
    A.buildKanban();
    A.document.getElementById = orig;
    const barra = A.__el('content').innerHTML, quadro = A.__el('kanbanBoard').innerHTML;
    exige(/id="pipBusca"/.test(barra) && /crmGerenciarEtapas\(\)/.test(barra), 'sem barra');
    exige(/Contato feito/.test(quadro) && /Nova etapa/.test(quadro) && /onDrop\(event, STAGES\[this\.dataset\.i\]\)/.test(quadro), 'quadro');
    exige((quadro.match(/class="kanban-col"/g) || []).length === 4, 'colunas: ' + (quadro.match(/class="kanban-col"/g) || []).length);
  });
  await passo('v172: busca sem acento, por e-mail, telefone e codigo — e abre o lead', () => {
    let aberto = null;
    const abrirOrig = A.__ler('openLeadDetail');
    A.__ler('(function(){ openLeadDetail = function (id) { globalThis.__aberto(id); }; })()'.replace('globalThis.__aberto(id)', '__aberto(id)'));
    A.__aberto = id => { aberto = id; };
    const buscar = q => { A.__el('pipBusca').value = q; A.__ler('_crmBuscar')(); return A.__ler('PIP').res.map(l => l.id); };
    exige(buscar('tereza davila')[0] === 'a1b2c3', 'sem acento: ' + buscar('tereza davila'));
    exige(/<mark>/.test(A.__el('pipRes').innerHTML), 'sem destaque');
    exige(buscar('israel@')[0] === 'd4e5f6', 'e-mail');
    exige(buscar('98282')[0] === 'a1b2c3', 'telefone');
    // telefone digitado com máscara: acha e destaca só os dígitos certos
    exige(buscar('(79) 99982-8295')[0] === 'a1b2c3', 'telefone com mascara');
    exige(/55<mark>79999828295<\/mark>/.test(A.__el('pipRes').innerHTML), 'destaque do telefone: ' + A.__el('pipRes').innerHTML);
    exige(buscar('g7h8')[0] === 'g7h8i9', 'codigo');
    exige(buscar('zzzz').length === 0 && /Nenhum lead/.test(A.__el('pipRes').innerHTML), 'vazio');
    buscar('cleide');
    A.crmBuscaEscolher(0);
    exige(aberto === 'g7h8i9', 'abriu: ' + aberto);
    A.__ler('(function (f) { openLeadDetail = f; })')(abrirOrig);
    return '5 tipos de busca';
  });
  await passo('v172: arrastar o fundo do quadro rola para os lados (card nao)', () => {
    const L = {}, cls = new Set();
    const quadro = { dataset: {}, scrollLeft: 100, classList: { add: c => cls.add(c), remove: c => cls.delete(c) },
                     addEventListener: (t, f) => { L[t] = f; } };
    const antes = (adm.env.listeners.pointermove || []).length;
    A._crmArrastoHorizontal(quadro);
    const mover = adm.env.listeners.pointermove.slice(antes), soltar = adm.env.listeners.pointerup.slice(-1)[0];
    L.pointerdown({ button: 0, pointerType: 'mouse', clientX: 300, target: { closest: () => null } });
    mover.forEach(f => f({ clientX: 180, preventDefault() {} }));
    exige(quadro.scrollLeft === 220 && cls.has('arrastando'), 'scroll=' + quadro.scrollLeft);
    soltar();
    exige(!cls.has('arrastando'), 'nao soltou');
    L.pointerdown({ button: 0, pointerType: 'mouse', clientX: 300, target: { closest: () => ({}) } });   // em cima de um card
    mover.forEach(f => f({ clientX: 100, preventDefault() {} }));
    exige(quadro.scrollLeft === 220, 'arrastou o quadro pelo card');
    let prevenido = false;
    L.wheel({ deltaY: 120, deltaX: 0, target: { closest: () => null }, preventDefault() { prevenido = true; } });
    exige(quadro.scrollLeft === 340 && prevenido, 'roda nao rolou para o lado');
  });
  await passo('v172: gerenciar etapas — cria, renomeia, reordena e apaga movendo os leads', async () => {
    let pedido = null;
    A.rpc = async (acao, d) => { if (acao === 'crmSalvarEtapas') { pedido = d; return { ok: true, migrados: 1 }; } return { ok: true, data: [], etapas: ETAPAS }; };
    A.__ler('(function(){ rpc = globalThis.rpc; })()');
    A.__ler('CRM').etapas = ETAPAS;
    A.crmGerenciarEtapas();
    const ETP = A.__ler('ETP');
    exige(ETP.lista.length === 4 && ETP.lista[1].qtd === 1, 'lista: ' + JSON.stringify(ETP.lista));
    A.crmEtapaNova();
    A.crmEtapaCampo({ dataset: { i: '4', campo: 'nome' }, value: 'Follow-up' });
    A.crmEtapaMover({ dataset: { i: '4', d: '-1' } });                 // Follow-up antes de Fechado
    A.crmEtapaApagar({ dataset: { i: '0' } });                        // Interessado (automação) — ignorado
    exige(ETP.lista.length === 5 && ETP.lista[0].nome === 'Interessado', 'apagou etapa de automacao');
    A.crmEtapaApagar({ dataset: { i: '1' } });                        // Contato feito (1 lead)
    const kDe = nome => ETP.lista.find(e => e.nome === nome).k;
    exige(ETP.removidas[0].destinoK === kDe('Interessado'), 'destino padrao nao e a entrada');
    A.crmEtapaDestino({ dataset: { j: '0' }, value: kDe('Qualificado') });
    // renomeia o destino DEPOIS de escolher: os leads seguem para ele
    A.crmEtapaCampo({ dataset: { i: '1', campo: 'nome' }, value: '  Qualificado   (SQL) ' });
    exige(/selected>Qualificado \(SQL\)</.test(A._crmEtapasMoverHtml()), 'destino sem o nome novo: ' + A._crmEtapasMoverHtml());
    await A.crmSalvarEtapas();
    exige(pedido && pedido.etapas.map(e => e.nome).join('|') === 'Interessado|Qualificado (SQL)|Follow-up|Fechado', JSON.stringify(pedido));
    exige(pedido.mover.contato === 'Qualificado (SQL)', 'mover: ' + JSON.stringify(pedido.mover));
    // destino escolhido e depois apagado: os leads voltam para a entrada
    pedido = null;
    A.crmGerenciarEtapas();
    A.crmEtapaNova();
    A.crmEtapaCampo({ dataset: { i: '4', campo: 'nome' }, value: 'Follow-up' });
    A.crmEtapaApagar({ dataset: { i: '1' } });                        // Contato feito
    A.crmEtapaDestino({ dataset: { j: '0' }, value: kDe('Follow-up') });
    A.crmEtapaApagar({ dataset: { i: '3' } });                        // o próprio Follow-up
    await A.crmSalvarEtapas();
    exige(pedido && pedido.mover.contato === 'Interessado', 'destino apagado: ' + JSON.stringify(pedido && pedido.mover));
    return 'Interessado > Qualificado (SQL) > Follow-up > Fechado; destino renomeado e destino apagado';
  });
  await passo('v172: detalhe do lead — barra de acoes liga so o que o lead permite', async () => {
    let corpo = '';
    const modalOrig = A.__ler('openModal');
    A.__ler('(function(){ openModal = function (t, b) { __corpo(b); }; })()');
    A.__corpo = b => { corpo = b; };
    const leadCom = { id: 'a1b2c3', name: "Tereza D'Ávila", email: 'tekadavila@hotmail.com', phone: '5579999828295',
                      status: 'Interessado', custom_fields: '{}', form_answers: '{}', timeline: '[]', temConta: false };
    A.rpc = async (acao) => acao === 'getLead' ? { ok: true, data: leadCom } : { ok: true, data: {} };
    A.__ler('(function(){ rpc = globalThis.rpc; })()');
    await A.openLeadDetail('a1b2c3');
    exige(/la-btn zap" data-p="tpl"/.test(corpo) && /wa\.me\/5579999828295/.test(corpo) && /data-p="mail"/.test(corpo), 'acoes ligadas');
    exige(!/la-btn off/.test(corpo), 'algo desligado sem motivo');
    exige(/<svg/.test(corpo) && !/[\u{1F300}-\u{1FAFF}]/u.test(corpo.split('id="leadPainel"')[0]), 'icones');
    // mesma tabela do teste do servidor (_crmZap_)
    const ZAP_CASOS = { '(94) 99123-0000': '5594991230000', '+55 94 99123-0000': '5594991230000', '9491230000': '5594991230000',
                        '9488887777': '', '1234': '', '': '', '0044 7911 123456': '447911123456', '+44 7911 123456': '447911123456' };
    const errados = Object.keys(ZAP_CASOS).filter(k => A._crmZapValido(k) !== ZAP_CASOS[k]).map(k => k + ' -> ' + A._crmZapValido(k));
    exige(!errados.length, 'regra do WhatsApp diverge do servidor: ' + errados.join(' | '));
    leadCom.phone = '123'; leadCom.email = 'invalido';
    await A.openLeadDetail('a1b2c3');
    exige((corpo.match(/la-btn off/g) || []).length === 3, 'desligados: ' + (corpo.match(/la-btn off/g) || []).length);
    A.__ler('(function (f) { openModal = f; })')(modalOrig);
  });
  await passo('v172: disparar template do lead — escolhe, ve a previa, edita e dispara', async () => {
    let enviado = null;
    const leadCom = { id: 'a1b2c3', name: 'Tereza', email: 'tekadavila@hotmail.com', phone: '5579999828295',
                      status: 'Interessado', custom_fields: '{}', form_answers: '{}', timeline: '[]', temConta: true };
    A.rpc = async (acao, d) => {
      if (acao === 'getLead') return { ok: true, data: leadCom };
      if (acao === 'waListarTemplates') return { ok: true, data: [{ nome: 'tpl_um', idioma: 'pt_BR', categoria: 'UTILITY' }] };
      if (acao === 'crmPrepararTemplate') return { ok: true, data: { template: 'tpl_um', idioma: 'pt_BR', categoria: 'UTILITY', formato: 'POSITIONAL',
        texto: 'Oi {{1}}, até {{2}}!', vars: [{ nome: '1', fonte: 'primeiro_nome', valor: 'Tereza' }, { nome: '2', fonte: 'fim_teste', valor: '07/10/2026' }] } };
      if (acao === 'crmEnviarTemplate') { enviado = d; return { ok: true, message: 'Template enviado.' }; }
      return { ok: true, data: {} };
    };
    A.acaoBotao = async (b, fn) => fn();
    A.__ler('(function(){ rpc = globalThis.rpc; acaoBotao = globalThis.acaoBotao; })()');
    A.__ler('CRM').templates = [];
    await A.openLeadDetail('a1b2c3');
    await A.leadPainel({ dataset: { p: 'tpl' }, classList: { add() {}, remove() {} } });
    exige(/tpl_um/.test(A.__el('laTpl').innerHTML), 'templates nao listados');
    await A.leadTplEscolher({ value: '0' });
    exige(/la-var-n/.test(A.__el('laTplCorpo').innerHTML) && /value="Tereza"/.test(A.__el('laTplCorpo').innerHTML), 'variaveis');
    const inputs = [{ dataset: { i: '0' }, value: 'Tê' }, { dataset: { i: '1' }, value: '07/10/2026' }];
    const qsa = A.document.querySelectorAll;
    A.document.querySelectorAll = sel => (/la-var input/.test(sel) ? inputs : qsa(sel));
    A.leadTplPrevia();
    exige(/Oi <b>Tê<\/b>, até <b>07\/10\/2026<\/b>!/.test(A.__el('laPrev').innerHTML), 'previa: ' + A.__el('laPrev').innerHTML);
    await A.leadTplDisparar({});
    A.document.querySelectorAll = qsa;
    exige(enviado && enviado.leadId === 'a1b2c3' && enviado.template === 'tpl_um' && enviado.valores['1'] === 'Tê', JSON.stringify(enviado));
    // e-mail: com conta, os dois botões ligados — e o detalhe rolado lá
    // embaixo sobe até o painel (antes o clique parecia não fazer nada)
    const mb = A.__el('modalBody');
    let rolou = null;
    mb.scrollTop = 480;
    mb.scrollTo = o => { rolou = o; mb.scrollTop = o.top; };
    await A.leadPainel({ dataset: { p: 'mail' }, classList: { add() {}, remove() {} } });
    const mail = A.__el('leadPainel').innerHTML;
    exige(/acesso ao app/.test(mail) && /data-t="recuperacao"/.test(mail), 'painel de e-mail');
    exige(rolou && rolou.top === 0 && mb.scrollTop === 0, 'painel abriu fora da vista: ' + JSON.stringify(rolou));
    return 'previa ao vivo + disparo com o valor editado + painel a vista';
  });
  await passo('v172: e-mail do lead manda o tipo escolhido', async () => {
    let pedido = null;
    A.rpc = async (acao, d) => { if (acao === 'crmEnviarEmail') { pedido = d; return { ok: true, message: 'ok' }; } return { ok: true, data: { timeline: '[]' } }; };
    A.__ler('(function(){ rpc = globalThis.rpc; })()');
    await A.leadEmail({ dataset: { t: 'recuperacao' } });
    exige(pedido && pedido.tipo === 'recuperacao' && pedido.leadId === 'a1b2c3', JSON.stringify(pedido));
  });

  // ── v173: o WhatsApp está chegando de verdade? ───────────────
  await passo('v173: quadro de entrega — limite, aceitas x chegaram, estado real e como ligar os avisos', async () => {
    let assinou = false;
    const SAUDE = { podeEnviar: 'LIMITED', bloqueios: [
        { onde: 'Empresa (Meta)', motivo: 'Verificação da empresa pendente no Gerenciador de Negócios da Meta.', detalhe: 'The Business has not passed business verification.' },
        { onde: 'App da Meta', motivo: 'This app cannot use SIP for WhatsApp Business calling', detalhe: 'This app cannot use SIP for WhatsApp Business calling' }],
      entregas: { dias: [{ dia: '30/09', aceitas: 1, enviadas: 1, entregues: 1 }, { dia: '01/10', aceitas: 4, enviadas: 1, entregues: 1 }] },
      webhook: { nossoApp: 'GPT Maker', apps: [{ nome: 'GPT Maker' }] } };
    const ENVIOS = [{ quando: '2026-10-02T15:13:00Z', para: '5563992196929', nome: 'Fabiana Lima', tipo: 'boas-vindas (sem cartão)', status: 'failed', motivo: 'esse número não recebe mensagens no WhatsApp (#131026)' },
                    { quando: '2026-10-02T13:23:00Z', para: '5594991230000', nome: 'Gabi', tipo: 'boas-vindas (sem cartão)', status: 'aceito', motivo: '' }];
    const HOOK = { url: 'https://script.google.com/macros/s/X/exec', verifyToken: 'wpk123', ativo: false, verificadoEm: '' };
    A.rpc = async (acao) => {
      if (acao === 'waSaude') return { ok: true, data: SAUDE };
      if (acao === 'waEnvios') return { ok: true, data: ENVIOS, webhookAtivo: HOOK.ativo };
      if (acao === 'waWebhookInfo') return { ok: true, data: HOOK };
      if (acao === 'waWebhookAssinar') { assinou = true; return { ok: true, message: 'Ligado.' }; }
      return { ok: true, data: {} };
    };
    A.acaoBotao = async (b, fn) => { const r = await fn(); if (r && r.depois) r.depois(); return r; };
    A.__ler('(function(){ rpc = globalThis.rpc; acaoBotao = globalThis.acaoBotao; })()');
    await A.taWaCarregar();
    const h = A.__el('taWaBox').innerHTML;
    exige(/pode enviar, mas com limite/.test(h) && /Verificação da empresa pendente/.test(h) && !/SIP/.test(h), 'limite/motivos');
    exige(/3 não chegaram/.test(h) && /3 mensagem\(ns\) aceitas pela Meta não chegaram/.test(h), 'tabela por dia');
    exige(/Fabiana Lima/.test(h) && /não chegou/.test(h) && /#131026/.test(h) && /sem confirmação/.test(h), 'ultimos envios');
    exige(/app <b[^>]*>GPT Maker<\/b>/.test(h) && /value="wpk123"/.test(h) && /Ligar avisos de entrega/.test(h), 'passos do webhook');
    await A.taWaAssinar({});
    exige(assinou, 'nao chamou o servidor');
    HOOK.ativo = true; HOOK.ultimoAviso = '2026-10-02T16:00:00Z';
    await A.taWaCarregar(true);
    exige(/O sistema recebe os avisos de entrega/.test(A.__el('taWaBox').innerHTML) && !/Ligar avisos/.test(A.__el('taWaBox').innerHTML), 'webhook ativo');
    return 'limite + 3 perdidas + estado real + passos';
  });

  await passo('v169: login do admin le a resposta da recuperacao (antes ignorava)', () => {
    const src = fs.readFileSync(path.join(PUB, 'admin', 'index.html'), 'utf8');
    const i = src.indexOf('function _lgSubmitRecuperar');
    const corpo = src.slice(i, src.indexOf('function _lgSubmitRedefinir'));
    exige(/_lgPost\('sendPasswordReset', \{ email: em \}\)\.then\(function \(res\)/.test(corpo) &&
          /if \(!res \|\| !res\.ok\) \{ _lgFalhou/.test(corpo), 'a resposta continua ignorada');
    exige(/_lgPost\('login'/.test(src) && !/action: 'login', data: \{ email: email, password: pass \}/.test(src), 'login ainda le JSON direto');
  });

  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nOK — front da v166 conferido por execucao');
  process.exit(falhas ? 1 : 0);
})();
