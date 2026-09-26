// Executa os caminhos reais do modulo do sono — app e admin — e falha
// se qualquer um lancar erro. Roda contra o arquivo que sera publicado.
'use strict';
const path = require('path');
const { carregar } = require(path.join(__dirname, 'harness_exec.js'));

// Por padrao testa o que esta no repositorio. Para testar o que esta
// no ar: baixe app.html e admin/index.html e aponte RAIZ para a pasta.
const RAIZ = process.env.RAIZ || path.join(__dirname, '..', 'site', 'wpktavares-site', 'public') + path.sep;
let falhas = 0;
function passo(nome, fn) {
  return Promise.resolve().then(fn).then(
    r => console.log('  ok    ' + nome + (r ? '  (' + r + ')' : '')),
    e => { falhas++; console.log('  FALHA ' + nome + '\n        ' + e.name + ': ' + e.message +
           '\n        ' + String(e.stack || '').split('\n').slice(1, 3).join('\n        ')); }
  );
}

function botaoFalso(texto, dataset) {
  const cls = new Set();
  return { cls, innerHTML: texto, disabled: false, offsetWidth: 90, isConnected: true,
    style: {}, dataset: Object.assign({}, dataset || {}),
    classList: { add: (...c) => c.forEach(x => cls.add(x)), remove: (...c) => c.forEach(x => cls.delete(x)),
                 contains: c => cls.has(c) } };
}

const SONS = [
  { id: 's1', titulo: 'Chuva no telhado', subtitulo: 'Noite inteira', categoria: 'chuva',
    audioUrl: '/media/sono/a.mp3', capaUrl: '/media/sono/capas/chuva.jpg', arte: 'chuva', ativo: true, loop: true, ordem: 1, usos: 3 },
  { id: 's2', titulo: "Ondas d'agua", subtitulo: '', categoria: 'natureza',
    audioUrl: '/media/sono/b.mp3', capaUrl: '', arte: 'mar', ativo: true, loop: true, ordem: 2, usos: 0 },
  { id: 's3', titulo: 'Som orfao', subtitulo: 'categoria apagada', categoria: 'inexistente',
    audioUrl: '/media/sono/c.mp3', capaUrl: '', arte: 'abstrato', ativo: false, loop: true, ordem: 3, usos: 0 },
  { id: 's4', titulo: 'Sem arquivo', subtitulo: '', categoria: 'chuva',
    audioUrl: '', capaUrl: '', arte: 'chuva', ativo: true, loop: true, ordem: 4, usos: 0 }
];
const CATS = [
  { id: 'chuva', nome: 'Chuva', icone: 'C', ordem: 10, ativa: true, descricao: '' },
  { id: 'natureza', nome: 'Natureza', icone: 'N', ordem: 20, ativa: true, descricao: '' },
  { id: 'historia', nome: 'Historias', icone: 'H', ordem: 90, ativa: false, descricao: '' }
];

let chegouAoFim = false;
process.on('exit', () => {
  if (!chegouAoFim) {
    console.log('\nO TESTE PAROU NO MEIO: alguma promessa ficou pendurada e o Node saiu calado.');
    process.exitCode = 1;
  }
});

(async function () {
  // ═══════════════ APP ═══════════════
  console.log('\nAPP (app.html)');
  const A = carregar(RAIZ + 'app/app.html');
  A.errosCarga.forEach(e => console.log('  aviso de carga: ' + e));
  const a = A.ctx;

  const APPx = a.__ler('APP'); APPx.token = 't'; APPx.data = APPx.data || {};
  a.PREFS = a._prefPadrao ? a._prefPadrao() : {};
  a.rpc = async function (acao) {
    if (acao === 'getSonoSons') {
      return { ok: true, data: { sons: SONS.filter(s => s.ativo && s.audioUrl), categorias: CATS.filter(c => c.ativa),
               prefs: { ciclo: 30, ultimoSom: 's1', telaNoturna: true }, avisoIos: 'x' } };
    }
    return { ok: true, data: {} };
  };

  await passo('renderSono() carrega e desenha', async () => {
    a.SN.dados = null;
    await a.renderSono();
    const html = a.__el('page-sono').innerHTML;
    if (!html.includes('sn-poster')) throw new Error('nenhum poster renderizado');
    if (!html.includes('snEscolher(')) throw new Error('onclick do poster ausente');
    if (!html.includes('Continuar de onde parou')) throw new Error('prateleira de continuar ausente');
    return (html.match(/class="sn-poster/g) || []).length + ' posteres';
  });

  await passo('poster COM capa tem onerror valido', () => {
    const h = a.snPoster(SONS[0]);
    if (!h.includes("this.style.display=\\'none\\'") && !h.includes("this.style.display='none'"))
      throw new Error('onerror mal formado: ' + h.slice(h.indexOf('onerror'), h.indexOf('onerror') + 60));
    if (!h.includes('<img')) throw new Error('img ausente');
    return 'img + cena de reserva';
  });

  await passo("poster SEM capa e com aspa no titulo", () => {
    const h = a.snPoster(SONS[1]);
    if (h.includes('<img')) throw new Error('nao devia ter img');
    if (!h.includes('<svg')) throw new Error('cena de reserva ausente');
    return 'so a cena';
  });

  await passo('as 9 cenas de reserva desenham', () => {
    const nomes = Object.keys(a.SN_ARTES);
    nomes.forEach(n => { if (!a.snArteSvg(n).includes('</svg>')) throw new Error('cena ' + n); });
    a.snArteSvg('nao-existe');
    return nomes.length + ' cenas';
  });

  await passo('busca com resultado', () => {
    a.snBuscar('chuva');
    const h = a.__el('page-sono').innerHTML;
    if (!h.includes('Resultados')) throw new Error('sem titulo de resultados');
    if (!h.includes('snBuscar(')) throw new Error('botao limpar ausente');
    return 'ok';
  });

  await passo('busca sem acento acha com acento', () => {
    a.SN.sons.push({ id: 'x9', titulo: 'Ruído marrom', subtitulo: '', categoria: 'chuva', audioUrl: '/x.mp3', capaUrl: '', arte: 'nuvens' });
    a.snBuscar('ruido');
    const h = a.__el('page-sono').innerHTML;
    a.SN.sons.pop();
    if (!h.includes('Ruído marrom') && !h.includes('Ru&iacute;do')) throw new Error('nao achou "Ruído" digitando "ruido"');
    return 'ok';
  });

  await passo('busca sem resultado', () => {
    a.snBuscar('zzzzz');
    if (!a.__el('page-sono').innerHTML.includes('Nada encontrado')) throw new Error('sem aviso de vazio');
    a.snBuscar('');
    return 'ok';
  });

  await passo('som orfao cai em "Outros"', () => {
    a.SN.sons.push(SONS[2]);
    a.snRender();
    const h = a.__el('page-sono').innerHTML;
    a.SN.sons.pop();
    if (!h.includes('Outros')) throw new Error('som de categoria apagada sumiu da vitrine');
    return 'ok';
  });

  await passo('escolher e trocar ciclo redesenham', () => {
    a.snEscolher('s1'); a.snEscolher('s1'); a.snEscolher('s2');
    a.snCiclo(45); a.snCiclo(480);
    if (!a.__el('page-sono').innerHTML.includes('sn-tocar')) throw new Error('botao comecar sumiu');
    return 'ok';
  });

  await passo('catalogo vazio mostra aviso', async () => {
    const guarda = a.SN.sons; a.SN.sons = [];
    a.snRender();
    const h = a.__el('page-sono').innerHTML;
    a.SN.sons = guarda;
    if (!h.includes('a caminho')) throw new Error('sem estado vazio');
    return 'ok';
  });

  await passo('fases do ceu desenham sem erro', () => {
    const cv = a.__el('snCanvas');
    a.SN_FASES.forEach(f => a.snCeuIniciar(cv, f));
    a.snCeuParar();
    return a.SN_FASES.length + ' fases';
  });

  // ═══════════════ ADMIN ═══════════════
  console.log('\nADMIN (admin/index.html)');
  const D = carregar(RAIZ + 'admin/index.html');
  D.errosCarga.forEach(e => console.log('  aviso de carga: ' + e));
  const d = D.ctx;
  // acaoBotao espera 1-2 s mostrando o resultado. No harness os timers
  // nao disparam; a espera vira instantanea e registra o estado do
  // botao naquele momento, para os testes conferirem verde/vermelho.
  const esperas = [];
  let ultimoBotao = { cls: new Set() };
  d._espera = async (ms) => { esperas.push({ ms, cls: [...(ultimoBotao.cls || [])].join(' ') }); };
  d.rpc = async function (acao) {
    if (acao === 'getSonoAdmin') return { ok: true, data: { sons: SONS, categorias: CATS, sessoes: 7 } };
    return { ok: true };
  };

  for (const vista of ['grade', 'lista']) {
    await passo('renderSonoAdmin() em ' + vista, async () => {
      d.SNA.vista = vista;
      await d.renderSonoAdmin();
      const h = d.__el('content').innerHTML;
      if (h.includes('carregar')) throw new Error('caiu no estado de erro');
      if (!h.includes('Categorias')) throw new Error('bloco de categorias ausente');
      if (!h.includes('snaEditar(')) throw new Error('botao editar ausente');
      if (!h.includes('snaCatEditar(')) throw new Error('fichas de categoria ausentes');
      return 'ok';
    });
  }

  await passo('alternar vista', async () => { await d.snaVista(); await d.snaVista(); return 'ok'; });

  await passo('formulario de som NOVO', () => {
    d.snaEditar();
    const h = d.__el('modalBody').innerHTML;
    if (!h.includes('snaCapaArq')) throw new Error('botao de recorte ausente');
    if (!h.includes('snaArte')) throw new Error('seletor de cena ausente');
    return 'ok';
  });

  await passo('formulario de som EXISTENTE (com capa)', () => {
    d.snaEditar('s1');
    if (!d.__el('modalBody').innerHTML.includes('snaCapaPrev')) throw new Error('previa ausente');
    return 'ok';
  });

  await passo('categoria nova e existente (com sons)', () => {
    d.snaCatEditar();
    d.snaCatEditar('chuva');
    if (!d.__el('modalBody').innerHTML.includes('Desative em vez de excluir'))
      throw new Error('aviso de sons dentro ausente');
    return 'ok';
  });

  // ═══════════════ CONFIRMACAO E MIGRACAO ═══════════════
  console.log('\nADMIN: confirmacao e migracao');

  await passo('adminConfirmar resolve true e false', async () => {
    let botoes = null;
    const original = d.openModal;
    d.openModal = (t, b, bs) => { botoes = bs; };
    const p1 = d.adminConfirmar('T', 'M', 'Ok', true);
    botoes[1].action();
    const sim = await p1;
    const p2 = d.adminConfirmar('T', 'M');
    botoes[0].action();
    const nao = await p2;
    d.openModal = original;
    if (sim !== true || nao !== false) throw new Error('resolveu ' + sim + '/' + nao);
    if (botoes[1].cls !== 'btn-primary') throw new Error('rotulo padrao errado');
    return 'ok';
  });

  await passo('excluir som: cancelar NAO chama o servidor', async () => {
    const chamadas = [];
    const rpcOrig = d.rpc;
    d.rpc = async (acao, dado) => { chamadas.push(acao); return rpcOrig(acao, dado); };
    const original = d.openModal;
    let botoes = null;
    d.openModal = (t, b, bs) => { botoes = bs; };
    const pr = d.snaExcluir(botaoFalso('X', { id: 's1' }));
    botoes[0].action();                       // Cancelar
    await pr;
    const semExcluir = !chamadas.includes('excluirSonoSom');
    const pr2 = d.snaExcluir(botaoFalso('X', { id: 's1' }));
    botoes[1].action();                       // Remover
    await pr2;
    d.openModal = original; d.rpc = rpcOrig;
    if (!semExcluir) throw new Error('excluiu mesmo cancelando');
    if (!chamadas.includes('excluirSonoSom')) throw new Error('confirmar nao excluiu');
    return 'ok';
  });

  const INV = {
    rodandoComo: 'davi@gmail.com', destino: '', trocaFeita: false, snapshot: [], recriadosEm: '',
    gatilhosDesteUsuario: [],
    itens: [
      { tipo: 'planilha', nome: 'Base', id: 'S', dono: 'davi@gmail.com', bytes: 2400000 },
      { tipo: 'pasta', nome: "Mural <b>Declaracoes</b> Media", id: 'M', dono: 'davi@gmail.com', bytes: 300000, arquivos: 12 },
      { tipo: 'pasta', nome: 'capas', id: '', ausente: true },
      { tipo: 'pasta', nome: 'PDFs dos alunos', id: 'U', erro: 'Access denied' }
    ]
  };
  const estados = [
    ['nao iniciada', {}, 'Migracao nao iniciada'],
    ['aguardando deploy', { destino: 'wagner@gmail.com', snapshot: ['rotinaManha'] }, 'Aguardando o deploy'],
    ['troca feita', { destino: 'wagner@gmail.com', rodandoComo: 'wagner@gmail.com', trocaFeita: true,
                      snapshot: ['rotinaManha', 'pushRodarAgenda'], recriadosEm: '2026-09-25T10:00:00Z' }, 'Troca concluida']
  ];
  for (const [nome, extra, esperado] of estados) {
    await passo('tela de migracao: ' + nome, async () => {
      const dados = Object.assign({}, INV, extra);
      dados.itens = INV.itens.map(i => Object.assign({ destinoTemAcesso: !!extra.destino }, i));
      const rpcOrig = d.rpc;
      d.rpc = async (acao) => (acao === 'getMigracaoInventario' ? { ok: true, data: dados } : rpcOrig(acao));
      await d.renderMigracao();
      d.rpc = rpcOrig;
      const h = d.__el('content').innerHTML;
      if (!h.includes(esperado)) throw new Error('faltou o selo "' + esperado + '"');
      if (h.includes('<b>Declaracoes</b>')) throw new Error('nome de pasta nao escapado (injecao de HTML)');
      if (!h.includes('migCompartilhar(this)')) throw new Error('botao compartilhar ausente');
      const botaoRecriar = h.slice(h.indexOf('migRecriar(this)') - 80, h.indexOf('migRecriar(this)') + 40);
      if (extra.trocaFeita && /disabled/.test(botaoRecriar)) throw new Error('recriar travado apos a troca');
      if (!extra.trocaFeita && !/disabled/.test(botaoRecriar)) throw new Error('recriar liberado antes da troca');
      return 'ok';
    });
  }

  await passo('tela de migracao com erro do servidor', async () => {
    const rpcOrig = d.rpc;
    d.rpc = async () => ({ ok: false, error: 'Sem permissao.' });
    await d.renderMigracao();
    d.rpc = rpcOrig;
    if (!d.__el('content').innerHTML.includes('Sem permissao')) throw new Error('erro nao mostrado');
    return 'ok';
  });

  // ═══════════════ BOTOES COM ESTADO ═══════════════
  console.log('\nADMIN: botoes com estado, salvar, recorte');


  await passo('acaoBotao: gira, trava, fica verde e volta', async () => {
    const b = botaoFalso('Salvar'); ultimoBotao = b;
    let noMeio = null;
    const r = await d.acaoBotao(b, async () => {
      noMeio = { dis: b.disabled, cls: [...b.cls].join(' '), spin: b.innerHTML.includes('btn-spin') };
      const segundo = await d.acaoBotao(b, async () => { throw new Error('rodou duas vezes'); });
      if (segundo !== null) throw new Error('segundo clique nao foi ignorado');
      return { ok: true, msg: 'Salvo' };
    }, 'Salvando');
    if (!noMeio.dis || !noMeio.spin || !/btn-ocupado/.test(noMeio.cls)) throw new Error('sem estado de espera: ' + JSON.stringify(noMeio));
    const e = esperas.pop();
    if (!/btn-ok/.test(e.cls) || e.ms < 1000) throw new Error('verde nao apareceu por 1s: ' + JSON.stringify(e));
    if (b.disabled || b.innerHTML !== 'Salvar' || b.cls.size) throw new Error('nao voltou ao normal: ' + b.innerHTML + ' ' + [...b.cls]);
    return 'espera -> verde ' + e.ms + 'ms -> normal';
  });

  await passo('acaoBotao: erro fica vermelho mais tempo e avisa o detalhe', async () => {
    const b = botaoFalso('Salvar'); ultimoBotao = b;
    const avisos = []; const t0 = d.toast; d.toast = (m, t) => avisos.push(t + ':' + m);
    await d.acaoBotao(b, async () => ({ ok: false, msg: 'Nao salvou', detalhe: 'motivo longo' }));
    d.toast = t0;
    const e = esperas.pop();
    if (!/btn-erro/.test(e.cls) || e.ms < 1500) throw new Error('vermelho: ' + JSON.stringify(e));
    if (!avisos.some(a => /error:motivo longo/.test(a))) throw new Error('detalhe nao foi para o aviso');
    return 'vermelho ' + e.ms + 'ms + aviso';
  });

  await passo('acaoBotao: excecao vira erro, nunca trava o botao', async () => {
    const b = botaoFalso('Salvar'); ultimoBotao = b;
    await d.acaoBotao(b, async () => { throw new Error('rede'); });
    if (b.disabled || b.dataset.ocupado) throw new Error('botao ficou travado');
    return 'ok';
  });

  // Estado limpo para os testes de salvar
  const rpcBase = d.rpc;
  const chamadas = [];
  d.rpc = async (acao, dado) => {
    chamadas.push(acao);
    if (acao === 'getSonoAdmin') return { ok: true, data: { sons: SONS, categorias: CATS, sessoes: 7 } };
    if (acao === 'salvarSonoSom') return { ok: true, id: dado.id || 'novo1' };
    if (acao === 'salvarSonoCategoria') return { ok: true, id: dado.id || 'salmos' };
    if (acao === 'salvarSonoCapa') return { ok: true, url: 'https://lh3.googleusercontent.com/d/NOVA' };
    return rpcBase(acao, dado);
  };
  await d.renderSonoAdmin();
  const campo = (id, v) => { d.__el(id).value = v; };
  const marcar = (id, v) => { d.__el(id).checked = v; };

  await passo('salvar sem titulo nao chama o servidor', async () => {
    d.snaEditar('s1');
    campo('snaTitulo', ' '); campo('snaAudio', '/a.mp3'); campo('snaCapa', '');
    chamadas.length = 0; ultimoBotao = botaoFalso('Salvar');
    const r = await d.snaSalvar(ultimoBotao);
    if (r.ok || chamadas.includes('salvarSonoSom')) throw new Error('salvou sem titulo');
    return r.msg;
  });

  await passo('capa sem capas/ e corrigida sozinha', async () => {
    d.testarImagem = async (url) => url.indexOf('/media/sono/capas/') === 0;
    d.snaEditar('s1');
    campo('snaTitulo', 'Chuva com trovoes'); campo('snaAudio', '/media/sono/a.mp3');
    campo('snaCapa', '/media/sono/capa-audio-chuva.jpg'); campo('snaArte', 'chuva');
    campo('snaCat', 'chuva'); campo('snaOrdem', '1'); marcar('snaAtivo', true); marcar('snaLoop', true);
    let enviado = null; const r0 = d.rpc;
    d.rpc = async (a, x) => { if (a === 'salvarSonoSom') enviado = x; return r0(a, x); };
    ultimoBotao = botaoFalso('Salvar');
    const r = await d.snaSalvar(ultimoBotao);
    d.rpc = r0;
    if (!r.ok) throw new Error(r.msg);
    if (!enviado || enviado.capaUrl !== '/media/sono/capas/capa-audio-chuva.jpg') throw new Error('nao corrigiu: ' + (enviado && enviado.capaUrl));
    if (!/corrigido/.test(r.msg)) throw new Error('nao avisou a correcao');
    return enviado.capaUrl;
  });

  await passo('capa quebrada de vez bloqueia o salvar', async () => {
    d.testarImagem = async () => false;
    d.snaEditar('s1');
    campo('snaTitulo', 'X'); campo('snaTitulo', 'Titulo ok'); campo('snaAudio', '/a.mp3');
    campo('snaCapa', 'https://exemplo.com/nao-existe.jpg');
    chamadas.length = 0; ultimoBotao = botaoFalso('Salvar');
    const r = await d.snaSalvar(ultimoBotao);
    if (r.ok || chamadas.includes('salvarSonoSom')) throw new Error('salvou com capa quebrada');
    return r.msg;
  });

  await passo('salvar atualiza a lista NA HORA, sem esperar o servidor', async () => {
    d.testarImagem = async () => true;
    d.snaEditar('s2');
    campo('snaTitulo', 'Ondas NOVAS do mar'); campo('snaAudio', '/media/sono/b.mp3'); campo('snaCapa', '');
    campo('snaCat', 'natureza'); campo('snaOrdem', '2'); marcar('snaAtivo', true);
    chamadas.length = 0;
    let desenhouAntesDeBuscar = null;
    const r0 = d.rpc;
    d.rpc = async (a, x) => {
      if (a === 'getSonoAdmin' && desenhouAntesDeBuscar === null)
        desenhouAntesDeBuscar = d.__el('content').innerHTML.includes('Ondas NOVAS do mar');
      return r0(a, x);
    };
    ultimoBotao = botaoFalso('Salvar');
    const r = await d.snaSalvar(ultimoBotao);
    await new Promise(z => setImmediate(z));
    d.rpc = r0;
    if (!r.ok) throw new Error(r.msg);
    if (!d.__el('content').innerHTML.includes('Ondas NOVAS do mar')) throw new Error('lista nao mudou');
    if (desenhouAntesDeBuscar === false) throw new Error('esperou o servidor para redesenhar');
    return 'redesenhou da memoria' + (desenhouAntesDeBuscar ? ', sincronizou depois' : '');
  });

  await passo('recorte volta ao formulario com o que foi digitado E a capa nova', async () => {
    d.snaEditar('s1');
    campo('snaTitulo', 'Titulo digitado antes do recorte'); campo('snaSub', 'sub digitado');
    campo('snaAudio', '/media/sono/a.mp3'); campo('snaCapa', '');
    d.SNA.rascunho = d.snaLerForm();                 // o que snaCapaEscolher faz
    let botoes = null; const om = d.openModal;
    d.openModal = (t, b, bs) => { botoes = bs; om(t, b, bs); };
    d.SNC.img = { width: 1000, height: 1500 };
    d.snaCapaAbrir();
    ultimoBotao = botaoFalso('Usar este corte');
    const r = await d.snaCapaSalvar(ultimoBotao);
    d.openModal = om;
    if (!r.ok) throw new Error(r.msg);
    const h = d.__el('modalBody').innerHTML;
    if (!h.includes('Titulo digitado antes do recorte')) throw new Error('perdeu o titulo digitado');
    if (!h.includes('sub digitado')) throw new Error('perdeu o subtitulo');
    if (!h.includes('lh3.googleusercontent.com/d/NOVA')) throw new Error('perdeu a capa enviada');
    if (d.__el('modalTitle').textContent !== 'Editar som') throw new Error('voltou como som novo');
    return 'titulo + subtitulo + capa nova preservados';
  });

  await passo('cancelar o recorte volta ao formulario sem perder nada', async () => {
    d.snaEditar('s2');
    campo('snaTitulo', 'Nao pode sumir'); campo('snaCapa', '/media/sono/capas/x.jpg');
    d.SNA.rascunho = d.snaLerForm();
    d.snaCapaAbrir();
    d.snaCapaVoltar('');
    const h = d.__el('modalBody').innerHTML;
    if (!h.includes('Nao pode sumir') || !h.includes('/media/sono/capas/x.jpg')) throw new Error('perdeu o formulario');
    return 'ok';
  });

  await passo('categoria nova aparece na hora', async () => {
    d.snaCatEditar();
    campo('snaCatNome', 'Salmos'); campo('snaCatIcone', 'S'); campo('snaCatOrdem', '50');
    marcar('snaCatAtiva', true);
    ultimoBotao = botaoFalso('Criar');
    const r = await d.snaCatSalvar('', ultimoBotao);
    await new Promise(z => setImmediate(z));
    if (!r.ok) throw new Error(r.msg);
    if (!d.__el('content').innerHTML.includes('Salmos')) throw new Error('ficha nao apareceu');
    return 'ok';
  });

  await passo('grade: capa quebrada acende aviso, sem aspas no onclick', () => {
    d.SNA.vista = 'grade'; d.snaDesenhar();
    const h = d.__el('content').innerHTML;
    if (!h.includes('onerror="snaCapaFalhou(this)"')) throw new Error('sem tratamento de capa quebrada');
    if (!h.includes('Capa n')) throw new Error('sem aviso de capa');
    if (/onclick="[a-zA-Z]+\(\\'/.test(h)) throw new Error('onclick com texto entre aspas');
    if (!/data-id="s1"/.test(h)) throw new Error('sem data-id');
    const img = { style: {}, parentNode: { querySelector: () => ({ style: {} }) } };
    d.snaCapaFalhou(img);
    if (img.style.display !== 'none') throw new Error('nao escondeu a foto quebrada');
    return 'ok';
  });

  await passo('testar arquivos inclui as capas', async () => {
    d.testarImagem = async (u) => u.indexOf('capas') > 0;
    const r0 = d.rpc;
    d.rpc = async (a, x) => (a === 'sonoVerificarUrls'
      ? { ok: true, data: [{ id: 's1', titulo: 'Chuva', estado: 'ok', codigo: 200 }] } : r0(a, x));
    d.SNA.sons = [{ id: 's1', titulo: 'Chuva', capaUrl: '/media/sono/capa-quebrada.jpg', audioUrl: '/a.mp3' }];
    ultimoBotao = botaoFalso('Testar');
    const r = await d.snaVerificar(ultimoBotao);
    d.rpc = r0;
    if (r.ok) throw new Error('nao pegou a capa quebrada');
    if (!d.__el('snaRes').innerHTML.includes('capa')) throw new Error('nao listou a capa');
    return r.msg;
  });

  await passo('push: salvar sem nada preenchido nao chama o servidor', async () => {
    d.__el('pushVapid').value = ''; d.__el('pushConta').value = '';
    chamadas.length = 0; ultimoBotao = botaoFalso('Salvar credenciais');
    const r = await d.pushSalvar(ultimoBotao);
    if (r.ok || chamadas.includes('pushSalvarConfig')) throw new Error('chamou sem dados');
    return r.msg;
  });

  d.rpc = rpcBase;

  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTudo executou sem erro');
  chegouAoFim = true;
  process.exit(falhas ? 1 : 0);
})();
