// ============================================================
// crm_etapas.gs — etapas do pipeline configuráveis (v172)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// As 5 etapas eram fixas no código (STAGES), no servidor e no
// painel. Agora vivem na config `pipelines_config` — a mesma que o
// dashboard já lia e nada gravava — e o admin cria, renomeia,
// reordena, colore e apaga etapas pelo painel.
//
// Três etapas têm PAPEL, porque as automações dependem delas:
//   entrada     — onde todo lead novo cai
//   qualificado — quem chegou à tela do cartão
//   fechado     — quem virou cliente (e a conversão do dashboard)
// Etapa com papel pode ser renomeada e reordenada, nunca apagada.
// Renomear MIGRA os leads: o CRM guarda o nome da etapa no lead.
// ============================================================

var CRM_ETAPAS_PADRAO = [
  { id: 'interessado', nome: 'Interessado',      cor: '#4caf50', papel: 'entrada' },
  { id: 'qualificado', nome: 'Qualificado',      cor: '#3b82f6', papel: 'qualificado' },
  { id: 'atendimento', nome: 'Em Atendimento',   cor: '#f59e0b', papel: '' },
  { id: 'proposta',    nome: 'Proposta Enviada', cor: '#e84040', papel: '' },
  { id: 'fechado',     nome: 'Fechado',          cor: '#6dde71', papel: 'fechado' }
];
var CRM_PAPEIS = ['entrada', 'qualificado', 'fechado'];

function _crmEtapas_() {
  var lista = null;
  try {
    var raw = getConfig_('pipelines_config');
    if (raw) {
      var cfg = JSON.parse(String(raw));
      if (cfg && Array.isArray(cfg.etapas) && cfg.etapas.length) lista = cfg.etapas;
    }
  } catch (e) {}
  if (!lista) lista = CRM_ETAPAS_PADRAO;
  return lista
    .filter(function (e) { return e && e.nome && e.ativa !== false; })
    .map(function (e, i) {
      return { id: String(e.id || ''), nome: String(e.nome), cor: String(e.cor || '#8a9a8e'),
               papel: String(e.papel || ''), ordem: Number(e.ordem) || (i + 1) };
    })
    .sort(function (a, b) { return a.ordem - b.ordem; });
}

function _crmNomesEtapas_() {
  return _crmEtapas_().map(function (e) { return e.nome; });
}

// Nome ATUAL da etapa que cumpre um papel (as automações usam isto)
function _crmEtapaPorPapel_(papel) {
  var lista = _crmEtapas_();
  var e = lista.filter(function (x) { return x.papel === papel; })[0];
  if (e) return e.nome;
  var p = CRM_ETAPAS_PADRAO.filter(function (x) { return x.papel === papel; })[0];
  return p ? p.nome : (lista[0] ? lista[0].nome : 'Interessado');
}

// ROTA (usuário do CRM): etapas atuais, na ordem
function crmGetEtapas(token) {
  var user = getUserByToken(token);
  if (!user || user.role === 'aluno') return { ok: false, error: 'Não autorizado.' };
  return { ok: true, data: _crmEtapas_() };
}

// ROTA ADMIN: salva as etapas.
//   data.etapas: [{ id?, nome, cor }] já na ordem desejada
//   data.mover:  { idDaEtapaApagada: 'nome da etapa destino' }
// O papel NÃO vem do navegador: só as etapas que já o tinham mantêm.
function crmSalvarEtapas(token, data) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  data = data || {};
  var novas = Array.isArray(data.etapas) ? data.etapas : [];
  if (!novas.length) return { ok: false, error: 'O pipeline precisa de pelo menos uma etapa.' };
  if (novas.length > 15) return { ok: false, error: 'No máximo 15 etapas.' };

  var atuais = _crmEtapas_();
  var porId = {};
  atuais.forEach(function (e) { if (e.id) porId[e.id] = e; });
  var ocupados = {};
  Object.keys(porId).forEach(function (k) { ocupados[k] = 1; });

  var nomesVistos = {}, limpa = [];
  for (var i = 0; i < novas.length; i++) {
    var n = novas[i] || {};
    var nome = _crmNomeEtapaLimpo_(n.nome);
    if (!nome) return { ok: false, error: 'Toda etapa precisa de um nome.' };
    var chave = nome.toLowerCase();
    if (nomesVistos[chave]) return { ok: false, error: 'Duas etapas com o nome "' + nome + '".' };
    nomesVistos[chave] = 1;
    var id = String(n.id || '').trim();
    if (!id || (!porId[id] && ocupados[id])) id = _crmIdEtapa_(nome, ocupados);
    ocupados[id] = 1;
    var cor = /^#[0-9a-fA-F]{6}$/.test(String(n.cor || '')) ? String(n.cor) : '#8a9a8e';
    limpa.push({ id: id, nome: nome, cor: cor, papel: porId[id] ? porId[id].papel : '', ordem: i + 1, ativa: true });
  }

  // Etapa com papel não some: as automações escrevem nela
  for (var p = 0; p < CRM_PAPEIS.length; p++) {
    var antes = atuais.filter(function (e) { return e.papel === CRM_PAPEIS[p]; })[0];
    if (antes && !limpa.some(function (e) { return e.papel === CRM_PAPEIS[p]; })) {
      return { ok: false, error: 'A etapa "' + antes.nome + '" é usada pelas automações e não pode ser apagada.' };
    }
  }

  // Renomeadas (mesmo id, outro nome) e apagadas (leads vão para o destino)
  var mapa = {}, renomes = {}, mover = {};
  var nomesNovos = limpa.map(function (e) { return e.nome; });
  var entrada = limpa.filter(function (e) { return e.papel === 'entrada'; })[0] || limpa[0];
  atuais.forEach(function (a) {
    var nova = limpa.filter(function (e) { return e.id === a.id; })[0];
    if (nova) {
      if (nova.nome !== a.nome) { renomes[a.nome] = nova.nome; mapa[a.nome] = nova.nome; }
      return;
    }
    // destino pelo nome, com a mesma limpeza dos nomes e sem diferenciar
    // maiúscula; não achou → etapa de entrada (o lead nunca fica sem etapa)
    var pedido = _crmNomeEtapaLimpo_(data.mover && data.mover[a.id]).toLowerCase();
    var alvo = limpa.filter(function (e) { return e.nome.toLowerCase() === pedido; })[0] || entrada;
    mover[a.nome] = alvo.nome;
    mapa[a.nome] = alvo.nome;
  });

  var migrados = _crmMigrarStatus_(mapa);
  setConfig_('pipelines_config', JSON.stringify({ etapas: limpa, atualizado_em: nowISO(), por: user.email }));
  invalidateLeadsCache_();
  logAction(user.email, 'CRM_ETAPAS_SALVAS', 'crm', '',
            JSON.stringify({ etapas: nomesNovos, renomes: renomes, mover: mover, migrados: migrados }));
  return { ok: true, data: _crmEtapas_(), migrados: migrados };
}

// Nome de etapa como fica gravado: espaços simples, sem = + - @ no começo
// (vira fórmula na planilha) e no máximo 40 letras.
function _crmNomeEtapaLimpo_(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().replace(/^[=+\-@]+/, '').trim().slice(0, 40);
}

function _crmIdEtapa_(nome, ocupados) {
  var base = String(nome).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
               .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'etapa';
  var id = base, n = 2;
  while (ocupados[id]) id = base + '_' + (n++);
  return id;
}

// Troca o status dos leads em lote — { 'Nome antigo': 'Nome novo' }.
// Uma escrita só na coluna inteira (500+ leads não viram 500 chamadas).
function _crmMigrarStatus_(mapa) {
  if (!Object.keys(mapa || {}).length) return 0;
  var sh = getSheet(SHEET_CRM);
  var d = sh.getDataRange().getValues();
  if (d.length < 2) return 0;
  var iSt = d[0].map(String).indexOf('status');
  if (iSt < 0) return 0;
  var n = 0, col = [];
  for (var i = 1; i < d.length; i++) {
    var atual = String(d[i][iSt] || '');
    var novo = Object.prototype.hasOwnProperty.call(mapa, atual) ? mapa[atual] : atual;
    if (novo !== atual) n++;
    col.push([novo]);
  }
  if (n) sh.getRange(2, iSt + 1, col.length, 1).setValues(col);
  return n;
}
