// ============================================================
// pesquisa.gs — Pesquisa de satisfação (NPS) — v162
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// NPS é medida que muda com o tempo, então a pesquisa é
// RECORRENTE — mas com espaço entre uma e outra. O equilíbrio
// todo está em nunca reaparecer antes da hora:
//
//   assinante   -> a partir de  7 dias de conta
//   em teste    -> a partir de 14 dias (no meio do teste a pessoa
//                  ainda está decidindo; perguntar ali atrapalha
//                  a decisão em vez de medi-la)
//   respondeu   -> volta só depois de 30 dias
//   ignorou     -> some por 7 dias, mesmo sem clicar em nada
//
// Esse último ponto é o que impedia de virar praga: antes, quem
// fechasse a aba sem responder via a pesquisa de novo no F5
// seguinte. Todos os prazos são ajustáveis no painel.
//
// O silêncio fica no SERVIDOR. Trocar de aparelho não pode ser
// um jeito de a pesquisa voltar a perseguir a pessoa.
//
// Quem dá nota alta é convidado a indicar. Pedir indicação a
// quem está insatisfeito é pedir para ele espalhar a
// insatisfação.
// ============================================================

var PQ_ABA        = 'pesquisa_nps';
var PQ_NOTA_BOA   = 9;              // a partir daqui convidamos a indicar

// Padrões. Todos ajustáveis no painel, porque a cadência certa depende do
// negócio e não deveria exigir deploy para mudar.
var PQ_PADRAO = {
  minAssinante: 7,    // dias de conta antes de perguntar a quem paga
  minTrial:     14,   // quem está testando fica mais tempo em paz
  intervalo:    30,   // depois de RESPONDER, só volta a perguntar daqui a tanto
  ignorada:     7     // apareceu e a pessoa não respondeu: some por uma semana
};

function _pqCfg_() {
  var c = {};
  Object.keys(PQ_PADRAO).forEach(function (k) {
    var v = 0;
    try { v = parseInt(getConfig_('pq_' + k), 10); } catch (e) {}
    c[k] = (v > 0) ? v : PQ_PADRAO[k];
  });
  return c;
}

function _pqNorm_(e) { return String(e || '').toLowerCase().trim(); }

function _pqAba_() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(PQ_ABA);
  if (!sh) {
    sh = ss.insertSheet(PQ_ABA);
    sh.appendRow(['quando', 'email', 'nome', 'nota', 'usa', 'ajudou', 'melhorar', 'comentario', 'dias_uso']);
    sh.getRange(1, 1, 1, 9).setFontWeight('bold').setBackground('#4527a0').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function _pqRespostaDe_(email) {
  email = _pqNorm_(email);
  try {
    var sh = _pqAba_();
    if (sh.getLastRow() < 2) return null;
    var d = sh.getDataRange().getValues();
    for (var i = d.length - 1; i >= 1; i--) {
      if (_pqNorm_(d[i][1]) === email) {
        var q = new Date(d[i][0]);
        return { quando: d[i][0], nota: Number(d[i][3]),
                 diasAtras: isNaN(q.getTime()) ? 9999
                            : Math.floor((Date.now() - q.getTime()) / 86400000) };
      }
    }
  } catch (e) {}
  return null;
}

// Guarda até quando a pesquisa some para esta pessoa.
function _pqSilenciar_(email, dias) {
  try {
    setConfig_('pq_adiado_' + _pqChave_(email), String(Date.now() + dias * 86400000));
  } catch (e) {}
}

// Dias desde que a conta existe. É o proxy honesto de "tempo de
// uso": não temos telemetria de sessão e inventar uma seria pior.
function _pqDiasDeConta_(user) {
  try {
    var criado = user && user.created_at;
    if (!criado) return 999;
    var d = new Date(criado);
    if (isNaN(d.getTime())) return 999;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  } catch (e) { return 999; }
}

// ─────────────────────────────────────────────────────────────
// ROTA (auth): getPesquisaStatus — o app pergunta se deve abrir
// ─────────────────────────────────────────────────────────────
function getPesquisaStatus(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  var email = _pqNorm_(user.email);
  var dias  = _pqDiasDeConta_(user);
  var cfg   = _pqCfg_();

  // Quem está testando ganha mais tempo de paz que quem já assinou: no
  // meio do teste a pessoa ainda está decidindo se gosta, e uma pesquisa
  // ali atrapalha a decisão em vez de medi-la.
  var emTeste = false;
  try {
    var info = checkAcessoPremium_(email);
    emTeste = info && String(info.status) === AS.TRIAL;
  } catch (e) {}

  var minimo = emTeste ? cfg.minTrial : cfg.minAssinante;
  if (dias < minimo) {
    return { ok: true, mostrar: false, motivo: 'cedo', diasFaltam: minimo - dias };
  }

  // Já respondeu: volta a perguntar só depois do intervalo. NPS é medida
  // que muda com o tempo — perguntar de novo é o ponto, desde que espaçado.
  var resp = _pqRespostaDe_(email);
  if (resp && resp.diasAtras < cfg.intervalo) {
    return { ok: true, mostrar: false, motivo: 'respondida',
             diasFaltam: cfg.intervalo - resp.diasAtras };
  }

  // Silêncio fica no SERVIDOR, não no navegador: trocar de aparelho não
  // pode ser um jeito de a pesquisa voltar a perseguir a pessoa.
  try {
    var adiado = getConfig_('pq_adiado_' + _pqChave_(email));
    if (adiado && Date.now() < Number(adiado)) {
      return { ok: true, mostrar: false, motivo: 'adiada' };
    }
  } catch (e) {}

  // Vai aparecer. Silencia JÁ por alguns dias: se a pessoa simplesmente
  // fechar a aba sem responder nem clicar em nada, ela não pode reaparecer
  // no próximo F5. Era isso que fazia parecer que perguntava toda hora.
  _pqSilenciar_(email, cfg.ignorada);

  return {
    ok: true,
    mostrar: true,
    nome: String(user.name || '').split(' ')[0],
    diasUso: dias,
    reincidente: !!resp,
    perguntas: _pqPerguntas_()
  };
}

function _pqChave_(email) {
  return String(email || '').replace(/[^a-z0-9]/gi, '').slice(0, 30);
}

function _pqPerguntas_() {
  return [
    { id: 'usa', titulo: 'Com que frequência você tem usado?',
      opcoes: ['Todo dia', 'Quase todo dia', 'Algumas vezes por semana', 'Raramente'] },
    { id: 'ajudou', titulo: 'O que mais te ajudou até aqui?',
      opcoes: ['A meditação', 'A leitura', 'O exercício', 'Os áudios diários', 'Ter uma rotina'] },
    { id: 'melhorar', titulo: 'O que deixaria o app melhor pra você?',
      opcoes: ['Mais conteúdo', 'Mais lembretes', 'Mais comunidade', 'Ser mais rápido', 'Está bom assim'] }
  ];
}

// ─────────────────────────────────────────────────────────────
// ROTA (auth): salvarPesquisa
// ─────────────────────────────────────────────────────────────
function salvarPesquisa(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  var d = data || {};
  var nota = parseInt(d.nota, 10);
  if (isNaN(nota) || nota < 0 || nota > 10) {
    return { ok: false, error: 'Escolha uma nota de 0 a 10.' };
  }

  var email = _pqNorm_(user.email);
  var cfg   = _pqCfg_();

  // Bloqueia só a resposta duplicada da MESMA rodada. Passado o intervalo,
  // responder de novo é o comportamento desejado.
  var anterior = _pqRespostaDe_(email);
  if (anterior && anterior.diasAtras < cfg.intervalo) {
    return { ok: true, jaRespondida: true };
  }

  var dias = _pqDiasDeConta_(user);
  try {
    _pqAba_().appendRow([
      new Date().toISOString(), email, String(user.name || ''), nota,
      String(d.usa || ''), String(d.ajudou || ''), String(d.melhorar || ''),
      String(d.comentario || '').slice(0, 500), dias
    ]);
  } catch (e) {
    return { ok: false, error: 'Não consegui salvar sua resposta.' };
  }

  // Respondeu: silencia pelo intervalo cheio.
  _pqSilenciar_(email, cfg.intervalo);
  logAction(email, 'PESQUISA_NPS', 'pesquisa', String(nota), String(d.melhorar || ''));

  // Nota baixa vira alerta interno: reclamação silenciosa é a que
  // vira cancelamento sem aviso.
  try {
    if (nota <= 6 && typeof tgEnviarErro_ === 'function') {
      tgEnviarErro_('Pesquisa NPS',
        'Nota ' + nota + '/10 de ' + email +
        (d.melhorar ? '\nQuer: ' + d.melhorar : '') +
        (d.comentario ? '\n"' + String(d.comentario).slice(0, 180) + '"' : ''));
    }
  } catch (e) {}

  return {
    ok: true,
    nota: nota,
    convidarIndicar: nota >= PQ_NOTA_BOA,
    mensagem: nota >= PQ_NOTA_BOA
      ? 'Que bom saber! Se conhece alguém que precisa disso, seu convite ajuda muito.'
      : (nota >= 7
          ? 'Obrigado. Vamos usar isso para melhorar.'
          : 'Obrigado pela sinceridade. Vamos olhar isso com atenção.')
  };
}

// ─────────────────────────────────────────────────────────────
// ROTA (auth): adiarPesquisa — "agora não" e o X fecham igual
// ─────────────────────────────────────────────────────────────
function adiarPesquisa(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  _pqSilenciar_(_pqNorm_(user.email), _pqCfg_().intervalo);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// ADMIN — cadência da pesquisa
// ─────────────────────────────────────────────────────────────
function salvarPesquisaConfig(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  var d = data || {};
  var salvos = {};

  Object.keys(PQ_PADRAO).forEach(function (k) {
    var v = parseInt(d[k], 10);
    if (v > 0 && v <= 365) { setConfig_('pq_' + k, String(v)); salvos[k] = v; }
  });

  logAction(user.email, 'PESQUISA_CONFIG', 'pesquisa', '', JSON.stringify(salvos));
  return { ok: true, message: 'Cadência salva.', data: _pqCfg_() };
}

// ─────────────────────────────────────────────────────────────
// ADMIN — NPS de verdade: promotores menos detratores
// ─────────────────────────────────────────────────────────────
function getPesquisaAdmin(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  var res = { total: 0, promotores: 0, neutros: 0, detratores: 0, nps: null,
              media: 0, distribuicao: [], recentes: [], porPergunta: {},
              respostasTotais: 0, cfg: _pqCfg_() };
  for (var i = 0; i <= 10; i++) res.distribuicao.push(0);

  try {
    var sh = _pqAba_();
    if (sh.getLastRow() < 2) return { ok: true, data: res };
    var d = sh.getDataRange().getValues();
    var soma = 0;

    // Com pesquisa recorrente, a mesma pessoa responde varias vezes. O NPS
    // atual e feito da resposta MAIS RECENTE de cada uma — somar todas
    // deixaria a nota velha pesando para sempre.
    var maisRecente = {};
    for (var v = 1; v < d.length; v++) {
      var e = _pqNorm_(d[v][1]);
      if (!e) continue;
      if (!maisRecente[e] || String(d[v][0]) > String(d[maisRecente[e]][0])) maisRecente[e] = v;
    }
    var linhasValidas = {};
    Object.keys(maisRecente).forEach(function (k) { linhasValidas[maisRecente[k]] = true; });
    res.respostasTotais = d.length - 1;

    for (var r = 1; r < d.length; r++) {
      if (!linhasValidas[r]) continue;
      var nota = Number(d[r][3]);
      if (isNaN(nota)) continue;
      res.total++; soma += nota;
      res.distribuicao[Math.max(0, Math.min(10, nota))]++;
      if (nota >= 9) res.promotores++;
      else if (nota >= 7) res.neutros++;
      else res.detratores++;

      ['usa', 'ajudou', 'melhorar'].forEach(function (campo, idx) {
        var v = String(d[r][4 + idx] || '');
        if (!v) return;
        if (!res.porPergunta[campo]) res.porPergunta[campo] = {};
        res.porPergunta[campo][v] = (res.porPergunta[campo][v] || 0) + 1;
      });

      if (res.recentes.length < 25) {
        res.recentes.push({
          quando: String(d[r][0] || '').slice(0, 10),
          nome: String(d[r][2] || ''),
          nota: nota,
          melhorar: String(d[r][6] || ''),
          comentario: String(d[r][7] || '')
        });
      }
    }

    if (res.total) {
      res.media = Math.round((soma / res.total) * 10) / 10;
      // NPS = %promotores - %detratores. Neutros nao entram na conta.
      res.nps = Math.round(((res.promotores - res.detratores) / res.total) * 100);
    }
    res.recentes.reverse();
  } catch (e) { return { ok: false, error: e.message }; }

  return { ok: true, data: res };
}
