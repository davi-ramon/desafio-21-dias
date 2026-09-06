// ============================================================
// pesquisa.gs — Pesquisa de satisfação (NPS) — v160
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// Aparece só DEPOIS de 7 dias de uso. Perguntar antes disso mede
// a primeira impressão, não o produto — e queima a única chance
// de perguntar com alguém que ainda nem formou opinião.
//
// Regras que tornam ela suportável:
//   - some para sempre depois de respondida
//   - "agora não" adia 30 dias, não 1 dia
//   - fechar no X vale como adiar: ninguém é perseguido
//   - uma vez por sessão, nunca duas
//
// No fim, quem deu nota alta é convidado a indicar. Pedir
// indicação a quem está insatisfeito é pedir para ele espalhar
// a insatisfação.
// ============================================================

var PQ_ABA        = 'pesquisa_nps';
var PQ_DIAS_MIN   = 7;              // uso mínimo antes de perguntar
var PQ_ADIAR_DIAS = 30;
var PQ_NOTA_BOA   = 9;              // a partir daqui convidamos a indicar

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
        return { quando: d[i][0], nota: Number(d[i][3]) };
      }
    }
  } catch (e) {}
  return null;
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

  if (dias < PQ_DIAS_MIN) {
    return { ok: true, mostrar: false, motivo: 'cedo', diasFaltam: PQ_DIAS_MIN - dias };
  }
  if (_pqRespostaDe_(email)) {
    return { ok: true, mostrar: false, motivo: 'respondida' };
  }

  // Adiamento fica no servidor, não no navegador: trocar de aparelho
  // não pode ser um jeito de a pesquisa voltar a perseguir a pessoa.
  try {
    var adiado = getConfig_('pq_adiado_' + _pqChave_(email));
    if (adiado && Date.now() < Number(adiado)) {
      return { ok: true, mostrar: false, motivo: 'adiada' };
    }
  } catch (e) {}

  return {
    ok: true,
    mostrar: true,
    nome: String(user.name || '').split(' ')[0],
    diasUso: dias,
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
  if (_pqRespostaDe_(email)) return { ok: true, jaRespondida: true };

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
  try {
    setConfig_('pq_adiado_' + _pqChave_(_pqNorm_(user.email)),
               String(Date.now() + PQ_ADIAR_DIAS * 86400000));
  } catch (e) {}
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// ADMIN — NPS de verdade: promotores menos detratores
// ─────────────────────────────────────────────────────────────
function getPesquisaAdmin(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  var res = { total: 0, promotores: 0, neutros: 0, detratores: 0, nps: null,
              media: 0, distribuicao: [], recentes: [], porPergunta: {} };
  for (var i = 0; i <= 10; i++) res.distribuicao.push(0);

  try {
    var sh = _pqAba_();
    if (sh.getLastRow() < 2) return { ok: true, data: res };
    var d = sh.getDataRange().getValues();
    var soma = 0;

    for (var r = 1; r < d.length; r++) {
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
