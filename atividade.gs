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

  // Lote/turma: só conta se estiver realmente configurado e aberto.
  var lote = _atLoteConfig_();
  var loteInicio = lote ? lote._inicioMs : 0;
  var loteVendidas = 0;

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
        if (loteInicio && quando.getTime() >= loteInicio) loteVendidas++;
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
        : '',
      lote: _atLoteResultado_(lote, loteVendidas)
    }
  };

  try { cache.put(chave, JSON.stringify(out), AT_CACHE_SEG); } catch (e) {}
  return out;
}


// ─────────────────────────────────────────────────────────────
// LOTE / TURMA — escassez REAL
// ------------------------------------------------------------
// O checkout sem cartão calculava "vagas restantes" com
// TOTAL - (dia da semana * 4). Isso não corresponde a vaga
// nenhuma: o número desce sozinho mesmo sem ninguém comprar.
//
// Aqui a conta é a de verdade: restantes = total do lote menos
// quem entrou DEPOIS que o lote abriu. Enquanto não houver um
// lote configurado e aberto, a rota devolve null e a página
// simplesmente não mostra o bloco.
// ─────────────────────────────────────────────────────────────
var AT_MESES = ['janeiro','fevereiro','março','abril','maio','junho',
                'julho','agosto','setembro','outubro','novembro','dezembro'];

// Primeiro instante do mês corrente no fuso de São Paulo. Sem isso o
// corte cairia em UTC e, entre 21h e 0h, a virada do mês aconteceria
// um dia antes para quem está no Brasil.
function _atInicioDoMes_() {
  var agora = new Date();
  var ano = parseInt(Utilities.formatDate(agora, 'America/Sao_Paulo', 'yyyy'), 10);
  var mes = parseInt(Utilities.formatDate(agora, 'America/Sao_Paulo', 'MM'), 10);
  var iso = Utilities.formatString('%04d-%02d-01T00:00:00-03:00', ano, mes);
  return { ms: new Date(iso).getTime(), mes: mes, ano: ano };
}

function _atLoteConfig_() {
  try {
    if (String(getConfig_('lote_ativo') || '') !== '1') return null;

    var total = parseInt(getConfig_('lote_total'), 10);
    if (!total || total < 1) return null;

    // ── Modo mensal: o lote se renova sozinho na virada do mês.
    // O cliente abre de 50 a 100 vagas por mês; sem isso ele teria que
    // reconfigurar a data toda virada, e um lote esquecido apareceria
    // "esgotado" para sempre.
    if (String(getConfig_('lote_modo') || '') === 'mensal') {
      var m = _atInicioDoMes_();
      return {
        nome: 'turma de ' + AT_MESES[m.mes - 1],
        total: total,
        mensal: true,
        _inicioMs: m.ms
      };
    }

    // ── Modo data fixa
    var inicioBruto = getConfig_('lote_inicio');
    if (!inicioBruto) return null;
    var inicio = new Date(inicioBruto);
    if (isNaN(inicio.getTime())) return null;

    // Um lote que já venceu não é escassez, é anúncio vencido.
    var fimBruto = getConfig_('lote_fim');
    if (fimBruto) {
      var fim = new Date(fimBruto);
      if (!isNaN(fim.getTime()) && Date.now() > fim.getTime()) return null;
    }

    return {
      nome: String(getConfig_('lote_nome') || 'turma atual'),
      total: total,
      mensal: false,
      _inicioMs: inicio.getTime()
    };
  } catch (e) { return null; }
}

function _atLoteResultado_(lote, vendidas) {
  if (!lote) return null;
  var restantes = Math.max(0, lote.total - vendidas);
  return {
    nome: lote.nome,
    total: lote.total,
    vendidas: vendidas,
    restantes: restantes,
    esgotado: restantes === 0,
    mensal: !!lote.mensal,
    // Ocupação real, sem piso artificial: se o lote acabou de abrir,
    // a barra fica vazia mesmo.
    ocupacao: Math.round((vendidas / lote.total) * 100)
  };
}

// ─────────────────────────────────────────────────────────────
// ROTAS DE ADMIN — configurar o lote pelo painel
// ─────────────────────────────────────────────────────────────
function getLoteConfig(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  try {
    // Prévia do que a página mostraria agora — o cliente decide o
    // total olhando o número real, não no escuro.
    var previa = null;
    try {
      var at = getAtividadeReal({ limite: 1 });
      previa = at && at.data ? at.data.lote : null;
    } catch (e) {}

    return { ok: true, data: {
      ativo:  String(getConfig_('lote_ativo') || '') === '1',
      modo:   String(getConfig_('lote_modo') || 'mensal'),
      nome:   String(getConfig_('lote_nome') || ''),
      total:  String(getConfig_('lote_total') || ''),
      inicio: String(getConfig_('lote_inicio') || ''),
      fim:    String(getConfig_('lote_fim') || ''),
      previa: previa
    } };
  } catch (e) { return { ok: false, error: e.message }; }
}

function salvarLoteConfig(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  var d = data || {};

  var ativo = d.ativo ? '1' : '';
  var modo  = String(d.modo || 'mensal') === 'fixo' ? 'fixo' : 'mensal';

  if (ativo) {
    // Só deixa ativar com os dados que tornam o número verdadeiro.
    var total = parseInt(d.total, 10);
    if (!total || total < 1) return { ok: false, error: 'Informe quantas vagas o lote tem.' };

    if (modo === 'fixo') {
      if (!d.inicio) return { ok: false, error: 'Informe a data de abertura do lote.' };
      var ini = new Date(d.inicio);
      if (isNaN(ini.getTime())) return { ok: false, error: 'Data de abertura inválida.' };
      if (d.fim) {
        var f = new Date(d.fim);
        if (isNaN(f.getTime())) return { ok: false, error: 'Data de encerramento inválida.' };
        if (f.getTime() <= ini.getTime()) return { ok: false, error: 'O encerramento tem que ser depois da abertura.' };
      }
    }
  }

  setConfig_('lote_ativo',  ativo);
  setConfig_('lote_modo',   modo);
  setConfig_('lote_nome',   String(d.nome || '').slice(0, 60));
  setConfig_('lote_total',  String(parseInt(d.total, 10) || ''));
  setConfig_('lote_inicio', String(d.inicio || ''));
  setConfig_('lote_fim',    String(d.fim || ''));

  // O cache de 5 min guarda o resultado antigo; sem isso a mudança
  // levaria até 5 minutos para aparecer na página.
  try {
    var c = CacheService.getScriptCache();
    for (var i = 1; i <= 12; i++) c.remove('atv_' + i);
  } catch (e) {}

  logAction(user.email, 'LOTE_CONFIG', 'checkout', '', ativo ? 'ativo' : 'desativado');
  return { ok: true, message: ativo ? 'Lote ativo. As vagas já aparecem no checkout.' : 'Lote desativado. O bloco some do checkout.' };
}
