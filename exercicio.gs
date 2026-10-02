// ============================================================
// exercicio.gs — Módulo Exercício Físico "mini Strava" (v121)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// Onboarding (perfil de atividade/ambiente/meta/objetivo) +
// registro de sessões com métricas (tempo, distância, calorias)
// + histórico/estatísticas. Ao bater a meta, marca o pilar
// 'exercicio' automaticamente reusando marcarPilar() já existente.
//
// LIMITE HONESTO: isto é um app web (PWA), não nativo. GPS e
// sensor de movimento só funcionam com o app ABERTO e a tela
// LIGADA — não há rastreamento em segundo plano real como um
// app nativo teria. Integrações com Google Fit/Apple Health/
// wearables exigem um wrapper nativo e ficam fora do escopo
// deste arquivo (ver backlog).
// ============================================================

var SHEET_EXO_PERFIL  = 'exercicio_perfil';
var SHEET_EXO_SESSOES = 'exercicio_sessoes';

var _EXOP_ = { EMAIL: 0, ATIVIDADE: 1, AMBIENTE: 2, META_MIN: 3, OBJETIVO: 4, ATUALIZADO: 5 };
var _EXOS_ = {
  ID: 0, EMAIL: 1, DIA: 2, ATIVIDADE: 3, AMBIENTE: 4,
  INICIO: 5, FIM: 6, DURACAO_SEG: 7, META_SEG: 8, META_ATINGIDA: 9,
  DISTANCIA_M: 10, VEL_MEDIA: 11, VEL_MAX: 12, CALORIAS: 13,
  ROTA_JSON: 14, CRIADO_EM: 15
};

// kcal/min estimado por atividade (média adulto ~70kg) — é ESTIMATIVA,
// não substitui um cardiofrequencímetro. Documentado como tal na UI.
var EXO_KCAL_MIN = {
  caminhada: 4, corrida: 10, bicicleta: 7, alongamento: 2.5,
  casa: 5, funcional: 6, polichinelos: 7, flexoes: 6,
  agachamentos: 6, estacionario: 5, outro: 5
};
var EXO_METAS_VALIDAS = [10, 15, 30, 45, 60];

// ── Estrutura ────────────────────────────────────────────────
function initExercicioSheets_() {
  var ss = getSpreadsheet_();
  var p = ss.getSheetByName(SHEET_EXO_PERFIL);
  if (!p) {
    p = ss.insertSheet(SHEET_EXO_PERFIL);
    p.appendRow(['email', 'atividade', 'ambiente', 'metaMinutos', 'objetivo', 'atualizadoEm']);
    p.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#2e6b31').setFontColor('#ffffff');
    p.setFrozenRows(1);
  }
  var s = ss.getSheetByName(SHEET_EXO_SESSOES);
  if (!s) {
    s = ss.insertSheet(SHEET_EXO_SESSOES);
    s.appendRow(['id', 'email', 'dia', 'atividade', 'ambiente', 'inicio', 'fim',
      'duracaoSeg', 'metaSeg', 'metaAtingida', 'distanciaM', 'velMediaKmh',
      'velMaxKmh', 'caloriasEst', 'rotaJson', 'criadoEm']);
    s.getRange(1, 1, 1, 16).setFontWeight('bold').setBackground('#2e6b31').setFontColor('#ffffff');
    s.setFrozenRows(1);
  }
  return { perfil: p, sessoes: s };
}

function _exoUser_(token) {
  var user = getUserByToken(token);
  if (!user) return null;
  return String(user.email || '').toLowerCase().trim();
}

// ─────────────────────────────────────────────────────────────
// ROTA: getExercicioPerfil — null se ainda não passou pelo onboarding
// ─────────────────────────────────────────────────────────────
function getExercicioPerfil(token) {
  var email = _exoUser_(token);
  if (!email) return { ok: false, error: 'Não autorizado.' };

  var sh = initExercicioSheets_().perfil;
  if (sh.getLastRow() < 2) return { ok: true, data: null };

  var dados = sh.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][_EXOP_.EMAIL] || '').toLowerCase().trim() === email) {
      return {
        ok: true,
        data: {
          atividade:   String(dados[i][_EXOP_.ATIVIDADE] || 'outro'),
          ambiente:    String(dados[i][_EXOP_.AMBIENTE] || 'tanto_faz'),
          metaMinutos: Number(dados[i][_EXOP_.META_MIN]) || 15,
          objetivo:    String(dados[i][_EXOP_.OBJETIVO] || '')
        }
      };
    }
  }
  return { ok: true, data: null };
}

// ─────────────────────────────────────────────────────────────
// ROTA: salvarExercicioPerfil — onboarding (1x) ou reconfiguração
// ─────────────────────────────────────────────────────────────
function salvarExercicioPerfil(token, prefs) {
  var email = _exoUser_(token);
  if (!email) return { ok: false, error: 'Não autorizado.' };
  prefs = prefs || {};

  var atividade = String(prefs.atividade || 'outro').slice(0, 40);
  var ambiente  = String(prefs.ambiente || 'tanto_faz').slice(0, 20);
  var metaMin   = parseInt(prefs.metaMinutos) || 15;
  if (EXO_METAS_VALIDAS.indexOf(metaMin) === -1) metaMin = 15;
  var objetivo  = String(prefs.objetivo || '').slice(0, 40);
  var sf = (typeof _sanitFormula_ === 'function') ? _sanitFormula_ : function (v) { return v; };

  var sh = initExercicioSheets_().perfil;
  if (sh.getLastRow() >= 2) {
    var dados = sh.getDataRange().getValues();
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][_EXOP_.EMAIL] || '').toLowerCase().trim() === email) {
        sh.getRange(i + 1, 1, 1, 6).setValues([[email, sf(atividade), sf(ambiente), metaMin, sf(objetivo), nowISO()]]);
        return { ok: true };
      }
    }
  }
  sh.appendRow([email, atividade, ambiente, metaMin, objetivo, nowISO()]);
  logAction(email, 'EXO_ONBOARD', 'exercicio_perfil', email, atividade + '/' + ambiente + '/' + metaMin + 'min');
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// ROTA: registrarSessaoExercicio — salva a sessão e, se a meta foi
// batida, marca o pilar 'exercicio' (reusa marcarPilar já existente).
// ─────────────────────────────────────────────────────────────
function registrarSessaoExercicio(token, sessao) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  if (user.role === 'admin') return { ok: true, caloriasEst: 0, progresso: 0, diasConcluidos: 0, gamificacao: null };

  var email = _exoUser_(token);
  var aluno = getAlunoByToken_(token);
  if (!aluno) return { ok: false, error: 'Não autorizado.' };

  sessao = sessao || {};
  var atividade     = String(sessao.atividade || 'outro').slice(0, 40);
  var ambiente       = String(sessao.ambiente || '').slice(0, 20);
  var duracaoSeg     = Math.max(0, parseInt(sessao.duracaoSeg) || 0);
  var metaSeg        = Math.max(0, parseInt(sessao.metaSeg) || 900);
  var metaAtingida   = !!sessao.metaAtingida;
  var distanciaM     = Math.max(0, Number(sessao.distanciaM) || 0);
  var velMediaKmh    = Math.max(0, Number(sessao.velMediaKmh) || 0);
  var velMaxKmh      = Math.max(0, Number(sessao.velMaxKmh) || 0);

  var fatorKcal   = EXO_KCAL_MIN[atividade] || EXO_KCAL_MIN.outro;
  var caloriasEst = Math.round((duracaoSeg / 60) * fatorKcal);

  // Rota: downsample até caber com folga no limite de uma célula do Sheets
  var rotaArr = Array.isArray(sessao.rota) ? sessao.rota : [];
  var tentativas = 0;
  while (JSON.stringify(rotaArr).length > 40000 && rotaArr.length > 20 && tentativas < 10) {
    rotaArr = rotaArr.filter(function (_, i) { return i % 2 === 0; });
    tentativas++;
  }

  var pilaresJson = _getPilaresJson_(aluno.row, aluno.headers);
  var diaInfo     = _calcDiaAtualFromInicio_(pilaresJson, aluno.row);
  var dia         = diaInfo.dia;

  var sh  = initExercicioSheets_().sessoes;
  var id  = generateId();
  var agora = nowISO();
  sh.appendRow([
    id, email, dia, atividade, ambiente,
    sessao.inicio || agora, agora, duracaoSeg, metaSeg, metaAtingida,
    Math.round(distanciaM), Math.round(velMediaKmh * 10) / 10, Math.round(velMaxKmh * 10) / 10,
    caloriasEst, JSON.stringify(rotaArr), agora
  ]);
  logAction(email, 'EXO_SESSAO', 'exercicio', id,
    atividade + ' ' + Math.round(duracaoSeg / 60) + 'min meta=' + metaAtingida);

  var progresso = null, diasConcluidos = null, gamificacao = null;
  if (metaAtingida) {
    try {
      var r = marcarPilar(token, 'exercicio', true);
      if (r && r.ok) { progresso = r.progresso; diasConcluidos = r.diasConcluidos; }
    } catch (e) {
      logAction('system', 'EXO_MARCAR_PILAR_ERRO', 'exercicio', email, e.message);
    }
    // recalcula gamificação com o pilaresJson já atualizado pelo marcarPilar
    try {
      var alunoAtual = getAlunoByToken_(token);
      if (alunoAtual) {
        var pj2    = _getPilaresJson_(alunoAtual.row, alunoAtual.headers);
        var stats2 = _calcProgresso_(alunoAtual.row, pj2);
        gamificacao = _calcGamificacao_(pj2, stats2);
      }
    } catch (e) {}
  }

  return { ok: true, id: id, caloriasEst: caloriasEst, progresso: progresso, diasConcluidos: diasConcluidos, gamificacao: gamificacao };
}

// ─────────────────────────────────────────────────────────────
// ROTA: getHistoricoExercicio — últimas sessões + stats agregadas
// ─────────────────────────────────────────────────────────────
function getHistoricoExercicio(token, limit) {
  var email = _exoUser_(token);
  if (!email) return { ok: false, error: 'Não autorizado.' };

  var sh = initExercicioSheets_().sessoes;
  if (sh.getLastRow() < 2) return { ok: true, data: [], stats: _exoStatsVazio_() };

  var dados = sh.getDataRange().getValues();
  var minhas = [];
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][_EXOS_.EMAIL] || '').toLowerCase().trim() !== email) continue;
    minhas.push({
      id:           dados[i][_EXOS_.ID],
      dia:          parseInt(dados[i][_EXOS_.DIA]) || 0,
      atividade:    String(dados[i][_EXOS_.ATIVIDADE] || ''),
      duracaoSeg:   parseInt(dados[i][_EXOS_.DURACAO_SEG]) || 0,
      metaAtingida: dados[i][_EXOS_.META_ATINGIDA] === true,
      distanciaM:   Number(dados[i][_EXOS_.DISTANCIA_M]) || 0,
      velMediaKmh:  Number(dados[i][_EXOS_.VEL_MEDIA]) || 0,
      caloriasEst:  parseInt(dados[i][_EXOS_.CALORIAS]) || 0,
      criadoEm:     String(dados[i][_EXOS_.CRIADO_EM] || '')
    });
  }
  minhas.sort(function (a, b) { return b.criadoEm.localeCompare(a.criadoEm); });

  var concl = minhas.filter(function (s) { return s.metaAtingida; });
  var totalMin = 0, totalKm = 0, totalKcal = 0, melhorDist = 0, melhorVel = 0;
  var diasComSessao = {};
  concl.forEach(function (s) {
    totalMin += s.duracaoSeg / 60;
    totalKm  += s.distanciaM / 1000;
    totalKcal += s.caloriasEst;
    if (s.distanciaM > melhorDist) melhorDist = s.distanciaM;
    if (s.velMediaKmh > melhorVel) melhorVel = s.velMediaKmh;
    if (s.dia > 0) diasComSessao[s.dia] = true;
  });

  var diasNum  = Object.keys(diasComSessao).map(Number);
  var maiorDia = diasNum.length ? Math.max.apply(null, diasNum) : 0;
  var sequencia = 0;
  for (var d = maiorDia; d >= 1; d--) { if (!diasComSessao[d]) break; sequencia++; }

  return {
    ok: true,
    data: minhas.slice(0, limit || 20),
    stats: {
      totalSessoes:        concl.length,
      totalMinutos:        Math.round(totalMin),
      totalKm:             Math.round(totalKm * 10) / 10,
      totalCalorias:       Math.round(totalKcal),
      sequencia:           sequencia,
      melhorDistanciaM:    Math.round(melhorDist),
      melhorVelocidadeKmh: Math.round(melhorVel * 10) / 10
    }
  };
}

function _exoStatsVazio_() {
  return { totalSessoes: 0, totalMinutos: 0, totalKm: 0, totalCalorias: 0, sequencia: 0, melhorDistanciaM: 0, melhorVelocidadeKmh: 0 };
}
