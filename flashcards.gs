// ============================================================
// flashcards.gs — Repetição espaçada (SM-2) — v134
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// O agendamento roda NO SERVIDOR de propósito. Se o intervalo
// fosse calculado no navegador, mudar o relógio do celular
// adiantaria as revisões e o método perderia o sentido.
//
// SM-2 (Piotr Woźniak): cada carta guarda uma facilidade (ease),
// o intervalo atual em dias e quantas revisões seguidas acertou.
// Errar não zera a facilidade — zera a sequência e devolve a
// carta pro dia seguinte.
// ============================================================

var FC_BARALHOS = 'flashcards_baralhos';
var FC_CARDS    = 'flashcards_cards';

var FC_EASE_INICIAL = 2.5;
var FC_EASE_MIN     = 1.3;
var FC_MAX_CARDS    = 2000;   // teto por aluno
var FC_MAX_BARALHOS = 40;

var FC_CAB_BARALHOS = ['id','email','nome','cor','criado_em','arquivado'];
var FC_CAB_CARDS    = ['id','baralho_id','email','frente','verso','ease','intervalo',
                       'repeticoes','lapsos','proxima_revisao','ultima_revisao','criado_em'];

function _fcAba_(nome, cabecalho) {
  var ss  = getSpreadsheet_();
  var aba = ss.getSheetByName(nome);
  if (!aba) {
    aba = ss.insertSheet(nome);
    aba.appendRow(cabecalho);
    aba.getRange(1, 1, 1, cabecalho.length)
       .setFontWeight('bold').setBackground('#6c47ff').setFontColor('#ffffff');
    aba.setFrozenRows(1);
  }
  return aba;
}

function initFlashcardsSheets_() {
  _fcAba_(FC_BARALHOS, FC_CAB_BARALHOS);
  _fcAba_(FC_CARDS,    FC_CAB_CARDS);
  return true;
}

function _fcEmail_(token) {
  var user = getUserByToken(token);
  if (!user) return null;
  return String(user.email || '').toLowerCase().trim();
}

// Data no fuso de São Paulo, só o dia (YYYY-MM-DD). Comparar strings
// nesse formato é seguro e evita a confusão de fuso do Date.
function _fcHoje_(deslocaDias) {
  var d = new Date();
  if (deslocaDias) d = new Date(d.getTime() + deslocaDias * 86400000);
  return Utilities.formatDate(d, 'America/Sao_Paulo', 'yyyy-MM-dd');
}

function _fcTexto_(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 500);
}

// Impede que o conteúdo da carta seja interpretado como fórmula
function _fcSeguro_(v, max) {
  var s = _fcTexto_(v, max);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function _fcLinhas_(aba) {
  var dados = aba.getDataRange().getValues();
  if (dados.length < 2) return { cab: dados[0] || [], linhas: [] };
  return { cab: dados[0], linhas: dados.slice(1) };
}

function _fcObj_(cab, linha) {
  var o = {};
  cab.forEach(function (c, i) { o[String(c)] = linha[i]; });
  return o;
}

// ─────────────────────────────────────────────────────────────
// ROTA: fcResumo — baralhos do aluno + quantas cartas vencem hoje
// ─────────────────────────────────────────────────────────────
function fcResumo(token) {
  var email = _fcEmail_(token);
  if (!email) return { ok: false, error: 'Não autorizado.' };
  initFlashcardsSheets_();

  var hoje = _fcHoje_();
  var abaB = _fcAba_(FC_BARALHOS, FC_CAB_BARALHOS);
  var abaC = _fcAba_(FC_CARDS, FC_CAB_CARDS);

  var b = _fcLinhas_(abaB);
  var c = _fcLinhas_(abaC);

  var porBaralho = {};
  var totalVence = 0, totalCartas = 0, totalNovas = 0;

  c.linhas.forEach(function (l) {
    var o = _fcObj_(c.cab, l);
    if (String(o.email || '').toLowerCase().trim() !== email) return;
    var bid = String(o.baralho_id || '');
    if (!porBaralho[bid]) porBaralho[bid] = { total: 0, vencem: 0, novas: 0 };
    porBaralho[bid].total++;
    totalCartas++;
    var nova = !o.ultima_revisao;
    if (nova) { porBaralho[bid].novas++; totalNovas++; }
    var prox = String(o.proxima_revisao || '');
    if (nova || !prox || prox <= hoje) { porBaralho[bid].vencem++; totalVence++; }
  });

  var baralhos = [];
  b.linhas.forEach(function (l) {
    var o = _fcObj_(b.cab, l);
    if (String(o.email || '').toLowerCase().trim() !== email) return;
    if (o.arquivado === true) return;
    var st = porBaralho[String(o.id)] || { total: 0, vencem: 0, novas: 0 };
    baralhos.push({
      id: String(o.id), nome: String(o.nome || ''), cor: String(o.cor || '#4caf50'),
      total: st.total, vencem: st.vencem, novas: st.novas,
      criadoEm: String(o.criado_em || '')
    });
  });
  baralhos.sort(function (x, y) { return y.vencem - x.vencem || x.nome.localeCompare(y.nome); });

  return { ok: true, data: { baralhos: baralhos, totalCartas: totalCartas,
                             totalVence: totalVence, totalNovas: totalNovas, hoje: hoje } };
}

// ─────────────────────────────────────────────────────────────
// Baralhos
// ─────────────────────────────────────────────────────────────
function fcCriarBaralho(token, nome, cor) {
  var email = _fcEmail_(token);
  if (!email) return { ok: false, error: 'Não autorizado.' };
  var n = _fcSeguro_(nome, 60);
  if (n.length < 2) return { ok: false, error: 'Dê um nome ao baralho.' };

  initFlashcardsSheets_();
  var aba = _fcAba_(FC_BARALHOS, FC_CAB_BARALHOS);
  var b = _fcLinhas_(aba);
  var meus = b.linhas.filter(function (l) {
    var o = _fcObj_(b.cab, l);
    return String(o.email || '').toLowerCase().trim() === email && o.arquivado !== true;
  });
  if (meus.length >= FC_MAX_BARALHOS) {
    return { ok: false, error: 'Você chegou ao limite de ' + FC_MAX_BARALHOS + ' baralhos.' };
  }

  var id = generateId();
  var c = /^#[0-9a-f]{6}$/i.test(String(cor || '')) ? String(cor) : '#4caf50';
  aba.appendRow([id, email, n, c, nowISO(), false]);
  try { logAction(email, 'FC_BARALHO_CRIADO', 'flashcards', id, n); } catch (e) {}
  return { ok: true, data: { id: id, nome: n, cor: c, total: 0, vencem: 0, novas: 0 } };
}

function fcRenomearBaralho(token, id, nome, cor) {
  var email = _fcEmail_(token);
  if (!email) return { ok: false, error: 'Não autorizado.' };
  var n = _fcSeguro_(nome, 60);
  if (n.length < 2) return { ok: false, error: 'Dê um nome ao baralho.' };

  var aba = _fcAba_(FC_BARALHOS, FC_CAB_BARALHOS);
  var dados = aba.getDataRange().getValues();
  var cab = dados[0];
  var iId = cab.indexOf('id'), iEmail = cab.indexOf('email'),
      iNome = cab.indexOf('nome'), iCor = cab.indexOf('cor');

  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][iId]) === String(id) &&
        String(dados[i][iEmail] || '').toLowerCase().trim() === email) {
      aba.getRange(i + 1, iNome + 1).setValue(n);
      if (/^#[0-9a-f]{6}$/i.test(String(cor || ''))) aba.getRange(i + 1, iCor + 1).setValue(cor);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Baralho não encontrado.' };
}

// Exclui o baralho E as cartas dele. Varre de baixo pra cima: apagar
// linha de cima primeiro desloca os índices das de baixo.
function fcExcluirBaralho(token, id) {
  var email = _fcEmail_(token);
  if (!email) return { ok: false, error: 'Não autorizado.' };

  var abaB = _fcAba_(FC_BARALHOS, FC_CAB_BARALHOS);
  var dadosB = abaB.getDataRange().getValues();
  var cabB = dadosB[0];
  var iId = cabB.indexOf('id'), iEmail = cabB.indexOf('email');
  var achou = false;

  for (var i = dadosB.length - 1; i >= 1; i--) {
    if (String(dadosB[i][iId]) === String(id) &&
        String(dadosB[i][iEmail] || '').toLowerCase().trim() === email) {
      abaB.deleteRow(i + 1); achou = true; break;
    }
  }
  if (!achou) return { ok: false, error: 'Baralho não encontrado.' };

  var abaC = _fcAba_(FC_CARDS, FC_CAB_CARDS);
  var dadosC = abaC.getDataRange().getValues();
  var cabC = dadosC[0];
  var jB = cabC.indexOf('baralho_id'), jE = cabC.indexOf('email');
  var removidas = 0;
  for (var k = dadosC.length - 1; k >= 1; k--) {
    if (String(dadosC[k][jB]) === String(id) &&
        String(dadosC[k][jE] || '').toLowerCase().trim() === email) {
      abaC.deleteRow(k + 1); removidas++;
    }
  }
  try { logAction(email, 'FC_BARALHO_EXCLUIDO', 'flashcards', id, removidas + ' cartas'); } catch (e) {}
  return { ok: true, removidas: removidas };
}

// ─────────────────────────────────────────────────────────────
// Cartas
// ─────────────────────────────────────────────────────────────
function fcListarCards(token, baralhoId) {
  var email = _fcEmail_(token);
  if (!email) return { ok: false, error: 'Não autorizado.' };
  var aba = _fcAba_(FC_CARDS, FC_CAB_CARDS);
  var c = _fcLinhas_(aba);
  var hoje = _fcHoje_();
  var out = [];

  c.linhas.forEach(function (l) {
    var o = _fcObj_(c.cab, l);
    if (String(o.email || '').toLowerCase().trim() !== email) return;
    if (String(o.baralho_id || '') !== String(baralhoId)) return;
    var prox = String(o.proxima_revisao || '');
    out.push({
      id: String(o.id), frente: String(o.frente || ''), verso: String(o.verso || ''),
      ease: Number(o.ease) || FC_EASE_INICIAL, intervalo: Number(o.intervalo) || 0,
      repeticoes: Number(o.repeticoes) || 0, lapsos: Number(o.lapsos) || 0,
      proximaRevisao: prox, nova: !o.ultima_revisao,
      vence: !o.ultima_revisao || !prox || prox <= hoje
    });
  });
  return { ok: true, data: out };
}

function fcSalvarCard(token, dados) {
  var email = _fcEmail_(token);
  if (!email) return { ok: false, error: 'Não autorizado.' };
  dados = dados || {};

  var frente = _fcSeguro_(dados.frente, 500);
  var verso  = _fcSeguro_(dados.verso,  1000);
  if (!frente) return { ok: false, error: 'A frente da carta não pode ficar vazia.' };
  if (!verso)  return { ok: false, error: 'O verso da carta não pode ficar vazio.' };

  initFlashcardsSheets_();
  var aba = _fcAba_(FC_CARDS, FC_CAB_CARDS);
  var dadosAba = aba.getDataRange().getValues();
  var cab = dadosAba[0];
  var iId = cab.indexOf('id'), iEmail = cab.indexOf('email'),
      iF = cab.indexOf('frente'), iV = cab.indexOf('verso');

  // Edição
  if (dados.id) {
    for (var i = 1; i < dadosAba.length; i++) {
      if (String(dadosAba[i][iId]) === String(dados.id) &&
          String(dadosAba[i][iEmail] || '').toLowerCase().trim() === email) {
        aba.getRange(i + 1, iF + 1).setValue(frente);
        aba.getRange(i + 1, iV + 1).setValue(verso);
        return { ok: true, data: { id: String(dados.id), frente: frente, verso: verso } };
      }
    }
    return { ok: false, error: 'Carta não encontrada.' };
  }

  // Criação
  var minhas = 0;
  for (var k = 1; k < dadosAba.length; k++) {
    if (String(dadosAba[k][iEmail] || '').toLowerCase().trim() === email) minhas++;
  }
  if (minhas >= FC_MAX_CARDS) {
    return { ok: false, error: 'Você chegou ao limite de ' + FC_MAX_CARDS + ' cartas.' };
  }

  var id = generateId();
  // Carta nova: sem última revisão, vence hoje
  aba.appendRow([id, String(dados.baralhoId || ''), email, frente, verso,
                 FC_EASE_INICIAL, 0, 0, 0, _fcHoje_(), '', nowISO()]);
  return { ok: true, data: { id: id, frente: frente, verso: verso, nova: true, vence: true } };
}

function fcExcluirCard(token, id) {
  var email = _fcEmail_(token);
  if (!email) return { ok: false, error: 'Não autorizado.' };
  var aba = _fcAba_(FC_CARDS, FC_CAB_CARDS);
  var dados = aba.getDataRange().getValues();
  var cab = dados[0];
  var iId = cab.indexOf('id'), iEmail = cab.indexOf('email');
  for (var i = dados.length - 1; i >= 1; i--) {
    if (String(dados[i][iId]) === String(id) &&
        String(dados[i][iEmail] || '').toLowerCase().trim() === email) {
      aba.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Carta não encontrada.' };
}

// ─────────────────────────────────────────────────────────────
// Sessão de revisão
// ─────────────────────────────────────────────────────────────
function fcParaRevisar(token, baralhoId, limite) {
  var email = _fcEmail_(token);
  if (!email) return { ok: false, error: 'Não autorizado.' };

  var lim  = Math.max(1, Math.min(100, parseInt(limite, 10) || 30));
  var hoje = _fcHoje_();
  var aba  = _fcAba_(FC_CARDS, FC_CAB_CARDS);
  var c    = _fcLinhas_(aba);
  var venc = [], novas = [];

  c.linhas.forEach(function (l) {
    var o = _fcObj_(c.cab, l);
    if (String(o.email || '').toLowerCase().trim() !== email) return;
    if (baralhoId && String(o.baralho_id || '') !== String(baralhoId)) return;
    var eNova = !o.ultima_revisao;
    var prox  = String(o.proxima_revisao || '');
    if (!eNova && prox && prox > hoje) return;      // ainda não venceu
    var carta = { id: String(o.id), baralhoId: String(o.baralho_id || ''),
                  frente: String(o.frente || ''), verso: String(o.verso || ''),
                  nova: eNova, repeticoes: Number(o.repeticoes) || 0 };
    (eNova ? novas : venc).push(carta);
  });

  // Vencidas primeiro: quem já estudou tem prioridade sobre material novo,
  // senão a pilha de revisão só cresce.
  var fila = venc.concat(novas).slice(0, lim);
  return { ok: true, data: { cartas: fila, vencidas: venc.length, novas: novas.length } };
}

// SM-2. qualidade: 0=errei · 3=difícil · 4=bom · 5=fácil
function fcRevisar(token, cardId, qualidade) {
  var email = _fcEmail_(token);
  if (!email) return { ok: false, error: 'Não autorizado.' };

  var q = parseInt(qualidade, 10);
  if ([0, 3, 4, 5].indexOf(q) < 0) return { ok: false, error: 'Avaliação inválida.' };

  var aba = _fcAba_(FC_CARDS, FC_CAB_CARDS);
  var dados = aba.getDataRange().getValues();
  var cab = dados[0];
  var iId = cab.indexOf('id'), iEmail = cab.indexOf('email');
  var iEase = cab.indexOf('ease'), iInt = cab.indexOf('intervalo'),
      iRep = cab.indexOf('repeticoes'), iLap = cab.indexOf('lapsos'),
      iProx = cab.indexOf('proxima_revisao'), iUlt = cab.indexOf('ultima_revisao');

  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][iId]) !== String(cardId)) continue;
    if (String(dados[i][iEmail] || '').toLowerCase().trim() !== email) continue;

    var ease = Number(dados[i][iEase]) || FC_EASE_INICIAL;
    var rep  = Number(dados[i][iRep])  || 0;
    var lap  = Number(dados[i][iLap])  || 0;
    var intervalo;

    if (q < 3) {
      // Errou: a sequência zera e a carta volta amanhã. A facilidade
      // cai um pouco, mas nunca abaixo do piso — senão a carta entra
      // em espiral e passa a aparecer todo dia para sempre.
      rep = 0;
      lap += 1;
      intervalo = 1;
      ease = Math.max(FC_EASE_MIN, ease - 0.2);
    } else {
      if (rep === 0)      intervalo = 1;
      else if (rep === 1) intervalo = 6;
      else                intervalo = Math.round((Number(dados[i][iInt]) || 1) * ease);
      rep += 1;
      ease = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
      if (ease < FC_EASE_MIN) ease = FC_EASE_MIN;
    }
    intervalo = Math.max(1, Math.min(365 * 2, intervalo));

    var linha = i + 1;
    aba.getRange(linha, iEase + 1).setValue(Math.round(ease * 100) / 100);
    aba.getRange(linha, iInt + 1).setValue(intervalo);
    aba.getRange(linha, iRep + 1).setValue(rep);
    aba.getRange(linha, iLap + 1).setValue(lap);
    aba.getRange(linha, iProx + 1).setValue(_fcHoje_(intervalo));
    aba.getRange(linha, iUlt + 1).setValue(_fcHoje_());

    return { ok: true, data: { intervalo: intervalo, ease: Math.round(ease * 100) / 100,
                               repeticoes: rep, proximaRevisao: _fcHoje_(intervalo) } };
  }
  return { ok: false, error: 'Carta não encontrada.' };
}
