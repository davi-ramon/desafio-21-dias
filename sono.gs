// ============================================================
// sono.gs — Módulo do Sono (v172)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// Duas abas:
//   sono_sons     catálogo de paisagens sonoras e histórias
//   sono_sessoes  o que a pessoa realmente dormiu
//
// Sobre "monitorar o sono": um PWA não tem acesso a sensor
// nenhum com a tela desligada — o iOS suspende o JavaScript
// inteiro, microfone em segundo plano é bloqueado e o
// acelerômetro para ao sair da frente. Então aqui não se
// inventa monitoramento: registra-se o que dá para saber de
// verdade — a hora em que a pessoa ligou o som, quanto tempo
// a sessão durou, e como ela diz que dormiu no check-in da
// manhã. É menos vistoso e é honesto.
// ============================================================

var SONO_SONS    = 'sono_sons';
var SONO_SESSOES = 'sono_sessoes';

var SONO_CABECALHO = ['id','titulo','subtitulo','categoria','audio_url','capa_url',
                      'duracao','loop','ativo','ordem','criado_em'];
var SONO_SESSAO_CABECALHO = ['id','email','som_id','iniciado_em','encerrado_em',
                             'minutos','ciclo_min','acordou_em','nota','observacao',
                             'adormeceu_em','min_ate_dormir','telas','toques'];

// As categorias existem para agrupar na tela. 'historia' fica por
// último de propósito: história de terror sobe batimento, então
// nunca é o padrão de um app que promete sono melhor.
var SONO_CATEGORIAS = ['chuva', 'natureza', 'ruido', 'ambiente', 'historia'];

function _sonoAba_(nome, cabecalho) {
  var ss = getSpreadsheet_();
  var aba = ss.getSheetByName(nome);
  if (!aba) {
    aba = ss.insertSheet(nome);
    aba.appendRow(cabecalho);
    aba.getRange(1, 1, 1, cabecalho.length)
       .setFontWeight('bold').setBackground('#0f1412').setFontColor('#4caf50');
    aba.setFrozenRows(1);
  }
  return aba;
}

function _sonoAbaSons_()    { return _sonoAba_(SONO_SONS, SONO_CABECALHO); }
function _sonoAbaSessoes_() { return _sonoAba_(SONO_SESSOES, SONO_SESSAO_CABECALHO); }

function _sonoNorm_(e) { return String(e || '').toLowerCase().trim(); }

function _sonoTexto_(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 120);
}

function _sonoCategoria_(v) {
  var c = _sonoNorm_(v);
  return SONO_CATEGORIAS.indexOf(c) >= 0 ? c : 'ambiente';
}

// Só aceita mídia servida pelo nosso domínio ou por https.
// Uma URL de Drive aqui é armadilha conhecida: o Drive não entrega
// arquivo para a tag <audio>, e o som simplesmente não toca.
function _sonoUrl_(v) {
  var u = String(v || '').trim();
  if (!u) return '';
  if (u.indexOf('/') === 0) return u.slice(0, 400);            // caminho local
  if (!/^https:\/\//i.test(u)) return '';
  if (/drive\.google\.com|docs\.google\.com/i.test(u)) return '';
  return u.slice(0, 400);
}

function _sonoLinhaParaObj_(linha, cab) {
  var o = {};
  cab.forEach(function (h, i) { o[h] = linha[i]; });
  return {
    id:        String(o.id || ''),
    titulo:    String(o.titulo || ''),
    subtitulo: String(o.subtitulo || ''),
    categoria: _sonoCategoria_(o.categoria),
    audioUrl:  String(o.audio_url || ''),
    capaUrl:   String(o.capa_url || ''),
    duracao:   Number(o.duracao) || 0,
    loop:      o.loop !== false && o.loop !== 'FALSE',
    ativo:     o.ativo !== false && o.ativo !== 'FALSE',
    ordem:     Number(o.ordem) || 0
  };
}

function _sonoTodos_() {
  var aba = _sonoAbaSons_();
  if (aba.getLastRow() < 2) return [];
  var d = aba.getDataRange().getValues();
  var cab = d[0].map(String);
  var out = [];
  for (var i = 1; i < d.length; i++) {
    var item = _sonoLinhaParaObj_(d[i], cab);
    if (item.id) out.push(item);
  }
  out.sort(function (a, b) { return (a.ordem - b.ordem) || a.titulo.localeCompare(b.titulo); });
  return out;
}

// ─────────────────────────────────────────────────────────────
// ROTA (aluno): getSonoSons
// ─────────────────────────────────────────────────────────────
function getSonoSons(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  // Sem áudio_url o card não toca nada. Devolver assim mesmo faria a
  // pessoa tocar num card morto — o catálogo só mostra o que soa.
  var sons = _sonoTodos_().filter(function (s) { return s.ativo && s.audioUrl; });

  var prefs = { ciclo: 30, ultimoSom: '', telaNoturna: true };
  try {
    var aluno = getAlunoByToken_(token);
    if (aluno) {
      var p = _prefsLer_(aluno.row, aluno.headers);
      if (p && p.sono) prefs = {
        ciclo: Number(p.sono.ciclo) || 30,
        ultimoSom: String(p.sono.ultimoSom || ''),
        telaNoturna: p.sono.telaNoturna !== false
      };
    }
  } catch (e) {}

  return { ok: true, data: {
    sons: sons,
    prefs: prefs,
    categorias: SONO_CATEGORIAS,
    // O aluno precisa saber ANTES de deitar que no iPhone a tela não
    // pode apagar, ou vai achar que o app quebrou no meio da noite.
    avisoIos: 'No iPhone o som para quando a tela bloqueia. Deixe a tela noturna ligada.'
  } };
}

// ─────────────────────────────────────────────────────────────
// ROTA (aluno): sonoIniciarSessao
// ─────────────────────────────────────────────────────────────
function sonoIniciarSessao(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  var d = data || {};

  var id = generateId();
  _sonoAbaSessoes_().appendRow([
    id, _sonoNorm_(user.email), _sonoTexto_(d.somId, 40), nowISO(), '', '',
    Number(d.cicloMin) || 0, '', '', '', '', '', 0, 0
  ]);

  // Guarda a escolha para a próxima noite já abrir no mesmo lugar.
  try {
    var aluno = getAlunoByToken_(token);
    if (aluno) {
      var p = _prefsLer_(aluno.row, aluno.headers);
      p.sono = { ciclo: Number(d.cicloMin) || 30,
                 ultimoSom: _sonoTexto_(d.somId, 40),
                 telaNoturna: d.telaNoturna !== false };
      salvarPreferencias(token, p);
    }
  } catch (e) {}

  return { ok: true, sessaoId: id };
}

// ─────────────────────────────────────────────────────────────
// ROTA (aluno): sonoEncerrarSessao
// ------------------------------------------------------------
// Chamada quando o som termina, e também no `visibilitychange` —
// esperar só pelo fim do ciclo deixaria toda noite em aberto, já
// que a pessoa dorme antes.
// ─────────────────────────────────────────────────────────────
function sonoEncerrarSessao(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  var d = data || {};
  var alvo = _sonoTexto_(d.sessaoId, 40);
  if (!alvo) return { ok: false, error: 'Sessao nao informada.' };

  var aba = _sonoAbaSessoes_();
  if (aba.getLastRow() < 2) return { ok: false, error: 'Sessao nao encontrada.' };
  var linhas = aba.getDataRange().getValues();
  var email = _sonoNorm_(user.email);

  for (var i = 1; i < linhas.length; i++) {
    if (String(linhas[i][0]) !== alvo) continue;
    if (_sonoNorm_(linhas[i][1]) !== email) return { ok: false, error: 'Sessao de outra pessoa.' };
    if (linhas[i][4]) return { ok: true, jaEncerrada: true };   // idempotente

    var minutos = Number(d.minutos) || 0;
    if (!minutos && linhas[i][3]) {
      try { minutos = Math.round((Date.now() - new Date(linhas[i][3]).getTime()) / 60000); }
      catch (e) { minutos = 0; }
    }
    // Uma sessão de 14 horas é aba esquecida aberta, não noite de sono.
    if (minutos > 14 * 60) minutos = 0;

    aba.getRange(i + 1, 5).setValue(nowISO());
    aba.getRange(i + 1, 6).setValue(minutos);

    // O ultimo sinal de vida antes do silencio e a melhor estimativa de
    // quando a pessoa apagou. Nao e medicao de sono — e o que da para
    // saber sem sensor, e e dito como estimativa em todo lugar.
    var ultimo = _sonoTexto_(d.ultimoSinal, 40);
    if (ultimo) {
      aba.getRange(i + 1, 11).setValue(ultimo);
      try {
        var t0 = new Date(linhas[i][3]).getTime();
        var t1 = new Date(ultimo).getTime();
        var ate = Math.round((t1 - t0) / 60000);
        // Negativo ou absurdo e relogio do aparelho fora de hora, nao dado.
        if (ate >= 0 && ate <= 14 * 60) aba.getRange(i + 1, 12).setValue(ate);
      } catch (e2) {}
    }
    aba.getRange(i + 1, 13).setValue(Number(d.telas) || 0);
    aba.getRange(i + 1, 14).setValue(Number(d.toques) || 0);

    return { ok: true, minutos: minutos };
  }
  return { ok: false, error: 'Sessao nao encontrada.' };
}

// ─────────────────────────────────────────────────────────────
// ROTA (aluno): sonoCheckin — a única medida honesta de qualidade
// ─────────────────────────────────────────────────────────────
function sonoCheckin(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  var d = data || {};
  var nota = parseInt(d.nota, 10);
  if (!(nota >= 1 && nota <= 5)) return { ok: false, error: 'Nota invalida.' };

  var aba = _sonoAbaSessoes_();
  if (aba.getLastRow() < 2) return { ok: false, error: 'Nenhuma noite registrada.' };
  var linhas = aba.getDataRange().getValues();
  var email = _sonoNorm_(user.email);

  // A noite mais recente desta pessoa, de trás para frente.
  for (var i = linhas.length - 1; i >= 1; i--) {
    if (_sonoNorm_(linhas[i][1]) !== email) continue;
    aba.getRange(i + 1, 8).setValue(nowISO());
    aba.getRange(i + 1, 9).setValue(nota);
    aba.getRange(i + 1, 10).setValue(_sonoTexto_(d.observacao, 300));
    return { ok: true };
  }
  return { ok: false, error: 'Nenhuma noite registrada.' };
}

// ─────────────────────────────────────────────────────────────
// ROTA (aluno): getSonoResumo — últimas 7 noites
// ─────────────────────────────────────────────────────────────
function getSonoResumo(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  var aba = _sonoAbaSessoes_();
  if (aba.getLastRow() < 2) return { ok: true, data: { noites: [], media: 0, total: 0 } };

  var linhas = aba.getDataRange().getValues();
  var email = _sonoNorm_(user.email);
  var limite = Date.now() - 7 * 864e5;
  var noites = [], somaNota = 0, comNota = 0;

  for (var i = 1; i < linhas.length; i++) {
    if (_sonoNorm_(linhas[i][1]) !== email) continue;
    var quando = 0;
    try { quando = new Date(linhas[i][3]).getTime(); } catch (e) {}
    if (!quando || quando < limite) continue;
    var nota = Number(linhas[i][8]) || 0;
    if (nota) { somaNota += nota; comNota++; }
    noites.push({
      inicio: String(linhas[i][3] || ''),
      minutos: Number(linhas[i][5]) || 0,
      nota: nota,
      adormeceuEm: String(linhas[i][10] || ''),
      minAteDormir: Number(linhas[i][11]) || 0,
      telas: Number(linhas[i][12]) || 0,
      toques: Number(linhas[i][13]) || 0
    });
  }

  noites.sort(function (a, b) { return String(b.inicio).localeCompare(String(a.inicio)); });

  // Media de quanto tempo leva para apagar, so entre as noites que
  // tem essa medida. Misturar com zeros puxaria tudo para baixo.
  var comTempo = noites.filter(function (n) { return n.minAteDormir > 0; });
  var mediaDormir = comTempo.length
    ? Math.round(comTempo.reduce(function (a, n) { return a + n.minAteDormir; }, 0) / comTempo.length)
    : 0;

  return { ok: true, data: {
    noites: noites.slice(0, 7),
    media: comNota ? Math.round(somaNota / comNota * 10) / 10 : 0,
    mediaDormir: mediaDormir,
    total: noites.length
  } };
}

// Já fez o check-in da noite passada? Sem isso o app perguntaria de
// novo a cada vez que ela abrisse durante o dia.
function sonoPrecisaCheckin(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  var aba = _sonoAbaSessoes_();
  if (aba.getLastRow() < 2) return { ok: true, precisa: false };
  var linhas = aba.getDataRange().getValues();
  var email = _sonoNorm_(user.email);

  for (var i = linhas.length - 1; i >= 1; i--) {
    if (_sonoNorm_(linhas[i][1]) !== email) continue;
    if (linhas[i][8]) return { ok: true, precisa: false };      // já respondeu
    var quando = 0;
    try { quando = new Date(linhas[i][3]).getTime(); } catch (e) {}
    // Vale só para a noite recente: perguntar como foi o sono de uma
    // semana atrás não mede nada.
    var horas = (Date.now() - quando) / 36e5;
    return { ok: true, precisa: horas > 3 && horas < 30 };
  }
  return { ok: true, precisa: false };
}

// ═════════════════════════════════════════════════════════════
// ADMIN
// ═════════════════════════════════════════════════════════════
function getSonoAdmin(token) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };

  var sons = _sonoTodos_();
  var usos = {}, sessoes = 0;
  try {
    var aba = _sonoAbaSessoes_();
    if (aba.getLastRow() > 1) {
      var d = aba.getDataRange().getValues();
      for (var i = 1; i < d.length; i++) {
        sessoes++;
        var s = String(d[i][2] || '');
        if (s) usos[s] = (usos[s] || 0) + 1;
      }
    }
  } catch (e) {}

  sons.forEach(function (s) { s.usos = usos[s.id] || 0; });
  return { ok: true, data: { sons: sons, categorias: SONO_CATEGORIAS, sessoes: sessoes } };
}

function salvarSonoSom(token, data) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };
  var d = data || {};

  var titulo = _sonoTexto_(d.titulo, 120);
  if (titulo.length < 2) return { ok: false, error: 'Informe o titulo.' };

  var audioUrl = _sonoUrl_(d.audioUrl);
  if (!audioUrl) {
    return { ok: false, error: 'URL do audio invalida. Use um arquivo em /media/ ou um https direto — link do Google Drive nao toca em <audio>.' };
  }

  var aba = _sonoAbaSons_();
  var linha = [
    _sonoTexto_(d.id, 40) || generateId(),
    titulo,
    _sonoTexto_(d.subtitulo, 160),
    _sonoCategoria_(d.categoria),
    audioUrl,
    _sonoUrl_(d.capaUrl),
    Number(d.duracao) || 0,
    d.loop !== false,
    d.ativo !== false,
    Number(d.ordem) || 0,
    nowISO()
  ];

  // Atualiza se já existe; a ordem da planilha não muda, então o
  // admin não vê o item saltar de lugar ao salvar.
  if (_sonoTexto_(d.id, 40) && aba.getLastRow() > 1) {
    var existentes = aba.getDataRange().getValues();
    for (var i = 1; i < existentes.length; i++) {
      if (String(existentes[i][0]) === String(d.id)) {
        linha[10] = existentes[i][10] || nowISO();      // preserva a criação
        aba.getRange(i + 1, 1, 1, linha.length).setValues([linha]);
        logAction(user.email, 'SONO_SOM_EDITADO', 'sono', linha[0], titulo);
        return { ok: true, message: 'Som atualizado.', id: linha[0] };
      }
    }
  }

  aba.appendRow(linha);
  logAction(user.email, 'SONO_SOM_CRIADO', 'sono', linha[0], titulo);
  return { ok: true, message: 'Som adicionado.', id: linha[0] };
}

function excluirSonoSom(token, data) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };
  var alvo = _sonoTexto_((data || {}).id, 40);
  if (!alvo) return { ok: false, error: 'Som nao informado.' };

  var aba = _sonoAbaSons_();
  if (aba.getLastRow() < 2) return { ok: false, error: 'Som nao encontrado.' };
  var d = aba.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][0]) !== alvo) continue;
    aba.deleteRow(i + 1);
    logAction(user.email, 'SONO_SOM_EXCLUIDO', 'sono', alvo, String(d[i][1] || ''));
    return { ok: true, message: 'Som removido.' };
  }
  return { ok: false, error: 'Som nao encontrado.' };
}

// Confere se cada arquivo realmente responde. Um 404 aqui é uma noite
// perdida lá: a pessoa deita, toca no card e não sai som nenhum.
function sonoVerificarUrls(token) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };

  var out = [];
  _sonoTodos_().forEach(function (s) {
    var url = s.audioUrl;
    if (url.indexOf('/') === 0) {
      url = 'https://' + (getConfig_('dominio_app') || 'app.wpktavares.com.br') + url;
    }
    var estado = '', codigo = 0;
    try {
      var r = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true,
                                       headers: { Range: 'bytes=0-1023' } });
      codigo = r.getResponseCode();
      estado = (codigo === 200 || codigo === 206) ? 'ok' : 'falhou';
    } catch (e) { estado = 'falhou'; }
    out.push({ id: s.id, titulo: s.titulo, url: s.audioUrl, estado: estado, codigo: codigo });
  });
  return { ok: true, data: out };
}
