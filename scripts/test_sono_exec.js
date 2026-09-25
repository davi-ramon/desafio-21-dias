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

  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTudo executou sem erro');
  process.exit(falhas ? 1 : 0);
})();
