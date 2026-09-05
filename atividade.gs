// ============================================================
// atividade.gs — Prova social com dados REAIS (v151)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// O checkout sem cartão monta a "atividade ao vivo" sorteando
// nome de uma lista fixa e evento de outra, e o "131 pessoas"
// vem de randInt(50,150). Nada disso aconteceu.
//
// A spec do trial com cartão proíbe exatamente isso ("não
// inventar eventos ou números", critério 17), então esta rota
// lê a aba `compradores` e devolve o que de fato ocorreu.
//
// Privacidade: só primeiro nome + inicial do sobrenome. Nunca
// e-mail, telefone ou nome completo — é uma página pública.
// ============================================================

var AT_CACHE_SEG = 300;   // 5 min: a página é pública, não vale varrer a planilha a cada visita

function _atNomeCurto_(nome) {
  var partes = String(nome || '').replace(/\s+/g, ' ').trim().split(' ');
  if (!partes[0]) return '';
  var primeiro = partes[0].charAt(0).toUpperCase() + partes[0].slice(1).toLowerCase();
  if (partes.length === 1) return primeiro;
  return primeiro + ' ' + partes[partes.length - 1].charAt(0).toUpperCase() + '.';
}

function _atQuandoTexto_(data) {
  var ms = Date.now() - data.getTime();
  var min = Math.floor(ms / 60000);
  if (min < 1)  return 'agora mesmo';
  if (min < 60) return 'há ' + min + ' min';
  var h = Math.floor(min / 60);
  if (h < 24)   return 'há ' + h + (h === 1 ? ' hora' : ' horas');
  var d = Math.floor(h / 24);
  if (d === 1)  return 'ontem';
  if (d < 7)    return 'há ' + d + ' dias';
  return 'há ' + Math.floor(d / 7) + (d < 14 ? ' semana' : ' semanas');
}

// ─────────────────────────────────────────────────────────────
// ROTA PÚBLICA: getAtividadeReal
// Devolve só o que aconteceu de verdade. Se não houve nada
// recente, devolve lista vazia — a página some com o bloco em
// vez de inventar movimento.
// ─────────────────────────────────────────────────────────────
function getAtividadeReal(data) {
  var limite = Math.max(1, Math.min(12, parseInt((data || {}).limite, 10) || 8));
  var cache = CacheService.getScriptCache();
  var chave = 'atv_' + limite;

  try {
    var pronto = cache.get(chave);
    if (pronto) return JSON.parse(pronto);
  } catch (e) {}

  var eventos = [];
  var totalAlunos = 0;
  var ultimos30 = 0;
  var corte30 = Date.now() - 30 * 86400000;

  try {
    var aba = getSpreadsheet_().getSheetByName(SHEET_COMPRADORES);
    if (aba && aba.getLastRow() > 1) {
      var d = aba.getDataRange().getValues();
      var cab = d[0].map(function (h) { return String(h || ''); });
      var iNome = cab.indexOf('Nome'), iPaid = cab.indexOf('PaidAt'),
          iCri = cab.indexOf('CreatedAt'), iStatus = cab.indexOf('Status');

      for (var i = 1; i < d.length; i++) {
        var nome = _atNomeCurto_(d[i][iNome]);
        var bruto = d[i][iPaid] || d[i][iCri];
        if (!bruto) continue;
        var quando = new Date(bruto);
        if (isNaN(quando.getTime())) continue;

        totalAlunos++;
        if (quando.getTime() >= corte30) ultimos30++;
        if (!nome) continue;

        eventos.push({
          nome: nome,
          evento: 'entrou para o Desafio 21 Dias',
          ts: quando.getTime(),
          quando: _atQuandoTexto_(quando),
          tipo: String(d[i][iStatus] || '').toLowerCase().indexOf('trial') >= 0 ? 'trial' : 'compra'
        });
      }
    }
  } catch (e) {
    logAction('system', 'ATIVIDADE_ERRO', 'checkout', '', e.message);
  }

  // Mais recentes primeiro
  eventos.sort(function (a, b) { return b.ts - a.ts; });
  eventos = eventos.slice(0, limite).map(function (e) {
    delete e.ts; return e;
  });

  var out = {
    ok: true,
    data: {
      eventos: eventos,
      totalAlunos: totalAlunos,
      ultimos30: ultimos30,
      // Nada de "vagas restantes": não existe turma limitada. O que
      // é verdade é quantas pessoas começaram no último mês.
      resumo: ultimos30 > 0
        ? ultimos30 + (ultimos30 === 1 ? ' pessoa começou' : ' pessoas começaram') + ' nos últimos 30 dias'
        : ''
    }
  };

  try { cache.put(chave, JSON.stringify(out), AT_CACHE_SEG); } catch (e) {}
  return out;
}
