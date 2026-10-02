// ============================================================
// indicacoes.gs — Compartilhamento e rastreio (v159)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// Cada aluno — assinante ou em teste — ganha um código próprio.
// O link leva para o checkout e tudo que acontece depois fica
// amarrado a ele: clique, cadastro no teste, e assinatura paga.
//
// POR ORA NÃO HÁ RECOMPENSA. Foi decisão do cliente: primeiro o
// rastreio, o dinheiro depois. Mas a estrutura já nasce com a
// forma que o programa de afiliados vai precisar — quem indicou,
// quem entrou, quando virou pagante — para que ligar comissão
// seja só somar em cima, sem refazer nada.
//
// PRIVACIDADE: o painel do aluno mostra primeiro nome e inicial
// do sobrenome de quem entrou. Nunca e-mail nem telefone — quem
// indicou não ganha o contato de quem foi indicado.
// ============================================================

var IND_ABA_CODIGOS = 'indicacoes_codigos';
var IND_ABA_EVENTOS = 'indicacoes_eventos';
var IND_BASE        = 'https://wpktavares.com.br';
var IND_CLIQUE_TTL  = 6 * 3600;   // mesma pessoa clicando de novo em 6h não conta 2 vezes

function _indNorm_(e) { return String(e || '').toLowerCase().trim(); }

function _indAbaCodigos_() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(IND_ABA_CODIGOS);
  if (!sh) {
    sh = ss.insertSheet(IND_ABA_CODIGOS);
    sh.appendRow(['email', 'codigo', 'nome', 'criado_em', 'cliques', 'ativo']);
    sh.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#00695c').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function _indAbaEventos_() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(IND_ABA_EVENTOS);
  if (!sh) {
    sh = ss.insertSheet(IND_ABA_EVENTOS);
    sh.appendRow(['quando', 'codigo', 'tipo', 'email_indicado', 'nome_indicado', 'dias', 'detalhe']);
    sh.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#00695c').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Código curto e legível: dá para ditar por telefone.
// Sem vogais reduz a chance de sair palavra sem querer.
function _indGerarCodigo_(nome) {
  var base = String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
              .replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 5);
  if (base.length < 3) base = 'AMIGO';
  var alfabeto = '23456789BCDFGHJKLMNPQRSTVWXZ';
  var sufixo = '';
  for (var i = 0; i < 3; i++) {
    sufixo += alfabeto.charAt(Math.floor(Math.random() * alfabeto.length));
  }
  return base + sufixo;
}

// Devolve o código do aluno, criando na primeira vez.
function _indCodigoDe_(email, nome) {
  email = _indNorm_(email);
  if (!email) return '';

  var sh = _indAbaCodigos_();
  var d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    if (_indNorm_(d[i][0]) === email) return String(d[i][1] || '');
  }

  // Não existe: cria garantindo que ninguém já tem esse código
  var usados = {};
  for (var j = 1; j < d.length; j++) usados[String(d[j][1] || '')] = true;

  var codigo = '';
  for (var t = 0; t < 12 && !codigo; t++) {
    var c = _indGerarCodigo_(nome);
    if (!usados[c]) codigo = c;
  }
  if (!codigo) codigo = 'AMIGO' + String(Date.now()).slice(-5);

  sh.appendRow([email, codigo, String(nome || ''), new Date().toISOString(), 0, true]);
  logAction(email, 'INDICACAO_CODIGO_CRIADO', 'indicacao', codigo, '');
  return codigo;
}

function _indLinhaPorCodigo_(codigo) {
  codigo = String(codigo || '').toUpperCase().trim();
  if (!codigo) return null;
  var sh = _indAbaCodigos_();
  var d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][1] || '').toUpperCase().trim() === codigo) {
      return { linha: i + 1, email: _indNorm_(d[i][0]), codigo: String(d[i][1]),
               nome: String(d[i][2] || ''), cliques: Number(d[i][4]) || 0,
               ativo: d[i][5] !== false };
    }
  }
  return null;
}

function _indEvento_(codigo, tipo, emailIndicado, nomeIndicado, dias, detalhe) {
  try {
    _indAbaEventos_().appendRow([
      new Date().toISOString(), String(codigo || '').toUpperCase(), tipo,
      _indNorm_(emailIndicado), String(nomeIndicado || ''),
      dias || '', String(detalhe || '')
    ]);
  } catch (e) {
    logAction('system', 'INDICACAO_EVENTO_ERRO', 'indicacao', String(codigo || ''), e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// ROTA PÚBLICA: registrarCliqueIndicacao
// Chamada pelas páginas de checkout quando a URL traz ?ref=
// ─────────────────────────────────────────────────────────────
function registrarCliqueIndicacao(data) {
  var codigo = String((data || {}).ref || '').toUpperCase().trim();
  if (!codigo || codigo.length > 20) return { ok: true };

  var reg = _indLinhaPorCodigo_(codigo);
  if (!reg || !reg.ativo) return { ok: true };   // código inválido: não vaza isso

  // Uma visita da mesma origem em 6h conta uma vez. Sem isso, um F5
  // viraria "cliques" e o painel do aluno mentiria para ele.
  var chave = 'indclick_' + codigo + '_' + String((data || {}).sid || '').slice(0, 40);
  try {
    var c = CacheService.getScriptCache();
    if (c.get(chave)) return { ok: true, repetido: true };
    c.put(chave, '1', IND_CLIQUE_TTL);
  } catch (e) {}

  try {
    _indAbaCodigos_().getRange(reg.linha, 5).setValue(reg.cliques + 1);
    _indEvento_(codigo, 'clique', '', '', (data || {}).dias || '', String((data || {}).origem || ''));
  } catch (e) {}

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Chamado pelos fluxos de cadastro (trial com e sem cartão)
// ─────────────────────────────────────────────────────────────
function indRegistrarConversao_(ref, email, nome, tipo, dias, detalhe) {
  try {
    var codigo = String(ref || '').toUpperCase().trim();
    if (!codigo) return;
    var reg = _indLinhaPorCodigo_(codigo);
    if (!reg || !reg.ativo) return;
    // Ninguém pontua indicando a si mesmo.
    if (reg.email && reg.email === _indNorm_(email)) return;

    _indEvento_(codigo, tipo, email, nome, dias, detalhe);
    logAction(_indNorm_(email), 'INDICACAO_' + String(tipo).toUpperCase(), 'indicacao', codigo, '');
  } catch (e) {}
}

// Nome curto para o painel de quem indicou — sem expor contato.
function _indNomeCurto_(nome, email) {
  var n = String(nome || '').replace(/\s+/g, ' ').trim();
  if (!n) return 'Alguém';
  var p = n.split(' ');
  var primeiro = p[0].charAt(0).toUpperCase() + p[0].slice(1).toLowerCase();
  if (p.length === 1) return primeiro;
  return primeiro + ' ' + p[p.length - 1].charAt(0).toUpperCase() + '.';
}

// ─────────────────────────────────────────────────────────────
// ROTA (auth): getMinhasIndicacoes — o painel do aluno
// ─────────────────────────────────────────────────────────────
function getMinhasIndicacoes(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  var email = _indNorm_(user.email);
  var codigo = _indCodigoDe_(email, user.name || '');

  var m = { cliques: 0, cadastros: 0, assinaturas: 0 };
  var pessoas = [];
  var vistos = {};

  try {
    var reg = _indLinhaPorCodigo_(codigo);
    m.cliques = reg ? reg.cliques : 0;

    var sh = _indAbaEventos_();
    if (sh.getLastRow() > 1) {
      var d = sh.getDataRange().getValues();
      for (var i = d.length - 1; i >= 1; i--) {
        if (String(d[i][1] || '').toUpperCase() !== codigo) continue;
        var tipo = String(d[i][2] || '');
        if (tipo === 'clique') continue;

        var chave = _indNorm_(d[i][3]);
        if (tipo === 'cadastro') m.cadastros++;
        if (tipo === 'assinatura') m.assinaturas++;

        // Uma pessoa aparece uma vez, no estágio mais avançado que atingiu
        if (chave && !vistos[chave]) {
          vistos[chave] = true;
          pessoas.push({
            nome: _indNomeCurto_(d[i][4], d[i][3]),
            estagio: tipo === 'assinatura' ? 'assinou' : 'testando',
            dias: d[i][5] || '',
            quando: _indQuando_(d[i][0])
          });
        } else if (chave && tipo === 'assinatura') {
          for (var k = 0; k < pessoas.length; k++) {
            if (pessoas[k]._e === chave) pessoas[k].estagio = 'assinou';
          }
        }
        if (pessoas.length > 60) break;
      }
    }
  } catch (e) {}

  var diasPermitidos = _indDiasPermitidos_();

  return {
    ok: true,
    data: {
      codigo: codigo,
      nome: String(user.name || '').split(' ')[0],
      linkPadrao: IND_BASE + '/i/' + codigo,
      linkDireto: IND_BASE + '/checkout-trial-cartao/?ref=' + codigo,
      metricas: m,
      pessoas: pessoas.slice(0, 30),
      diasPermitidos: diasPermitidos,
      // Deixado explícito: hoje não existe recompensa, e a tela diz isso.
      recompensaAtiva: false
    }
  };
}

function _indQuando_(iso) {
  try {
    var d = new Date(iso);
    var dias = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (dias <= 0) return 'hoje';
    if (dias === 1) return 'ontem';
    if (dias < 7) return 'há ' + dias + ' dias';
    return Utilities.formatDate(d, 'America/Sao_Paulo', 'dd/MM');
  } catch (e) { return ''; }
}

// Quantos dias de teste um ALUNO pode oferecer no link dele.
// Configurável porque é dar produto de graça: 30 dias na mão de
// todo mundo é um rombo silencioso.
function _indDiasPermitidos_() {
  var bruto = '';
  try { bruto = String(getConfig_('indicacao_dias') || ''); } catch (e) {}
  if (!bruto) bruto = '7,14';
  return bruto.split(',').map(function (x) { return parseInt(x, 10); })
              .filter(function (n) { return [7, 14, 21, 30].indexOf(n) >= 0; });
}

// ─────────────────────────────────────────────────────────────
// ROTA (auth): gerarLinkIndicacao — link de teste de N dias
// ─────────────────────────────────────────────────────────────
function gerarLinkIndicacao(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  var dias = parseInt((data || {}).dias, 10) || 0;
  var permitidos = _indDiasPermitidos_();
  if (permitidos.indexOf(dias) < 0) {
    return { ok: false, error: 'Este período não está disponível para indicação.' };
  }

  var codigo = _indCodigoDe_(_indNorm_(user.email), user.name || '');
  return {
    ok: true,
    data: {
      dias: dias,
      link: IND_BASE + '/checkout-trial-cartao/?ref=' + codigo + '&dias=' + dias,
      texto: 'Tô fazendo o Desafio 21 Dias e tá mudando minha rotina. ' +
             'Te dei ' + dias + ' dias grátis pra experimentar:'
    }
  };
}

// ─────────────────────────────────────────────────────────────
// ADMIN — ranking de quem mais indica
// ─────────────────────────────────────────────────────────────
function getIndicacoesAdmin(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  var porCodigo = {};
  try {
    var sc = _indAbaCodigos_();
    var dc = sc.getDataRange().getValues();
    for (var i = 1; i < dc.length; i++) {
      var cod = String(dc[i][1] || '').toUpperCase();
      if (!cod) continue;
      porCodigo[cod] = { codigo: cod, email: _indNorm_(dc[i][0]), nome: String(dc[i][2] || ''),
                         cliques: Number(dc[i][4]) || 0, cadastros: 0, assinaturas: 0 };
    }

    var se = _indAbaEventos_();
    if (se.getLastRow() > 1) {
      var de = se.getDataRange().getValues();
      for (var j = 1; j < de.length; j++) {
        var c = String(de[j][1] || '').toUpperCase();
        if (!porCodigo[c]) continue;
        var t = String(de[j][2] || '');
        if (t === 'cadastro')   porCodigo[c].cadastros++;
        if (t === 'assinatura') porCodigo[c].assinaturas++;
      }
    }
  } catch (e) { return { ok: false, error: e.message }; }

  var lista = Object.keys(porCodigo).map(function (k) { return porCodigo[k]; })
    .filter(function (x) { return x.cliques || x.cadastros || x.assinaturas; })
    .sort(function (a, b) {
      return (b.assinaturas - a.assinaturas) || (b.cadastros - a.cadastros) || (b.cliques - a.cliques);
    });

  var tot = { cliques: 0, cadastros: 0, assinaturas: 0, indicadores: lista.length };
  lista.forEach(function (x) {
    tot.cliques += x.cliques; tot.cadastros += x.cadastros; tot.assinaturas += x.assinaturas;
  });

  return { ok: true, data: { total: tot, lista: lista.slice(0, 80),
                             diasPermitidos: _indDiasPermitidos_() } };
}

function salvarIndicacaoConfig(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  var dias = String((data || {}).dias || '7,14')
    .split(',').map(function (x) { return parseInt(x, 10); })
    .filter(function (n) { return [7, 14, 21, 30].indexOf(n) >= 0; });
  if (!dias.length) return { ok: false, error: 'Escolha ao menos um período válido (7, 14, 21 ou 30).' };
  setConfig_('indicacao_dias', dias.join(','));
  logAction(user.email, 'INDICACAO_CONFIG', 'indicacao', '', dias.join(','));
  return { ok: true, message: 'Períodos liberados: ' + dias.join(', ') + ' dias.' };
}


// ─────────────────────────────────────────────────────────────
// Fecha o ciclo: quem entrou por indicação e virou PAGANTE.
// Descobrimos o código pelo cadastro anterior desta pessoa, então
// funciona igual para o trial com e sem cartão — nenhum dos dois
// precisa carregar a indicação até a hora do pagamento.
// ─────────────────────────────────────────────────────────────
function indMarcarAssinatura_(email, detalhe) {
  try {
    email = _indNorm_(email);
    if (!email) return;

    var sh = _indAbaEventos_();
    if (sh.getLastRow() < 2) return;
    var d = sh.getDataRange().getValues();

    var codigo = '', nome = '';
    for (var i = d.length - 1; i >= 1; i--) {
      if (_indNorm_(d[i][3]) !== email) continue;
      var tipo = String(d[i][2] || '');
      if (tipo === 'assinatura') return;   // já contabilizado
      if (tipo === 'cadastro') { codigo = String(d[i][1] || ''); nome = String(d[i][4] || ''); break; }
    }
    if (!codigo) return;

    _indEvento_(codigo, 'assinatura', email, nome, '', String(detalhe || ''));
    logAction(email, 'INDICACAO_ASSINATURA', 'indicacao', codigo, String(detalhe || ''));
  } catch (e) {}
}
