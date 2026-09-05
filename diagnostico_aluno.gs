// ============================================================
// diagnostico_aluno.gs — Onde esta pessoa aparece no sistema?
// Desafio 21 Dias — WPK Tavares (v146)
// ------------------------------------------------------------
// Nasceu do caso da Apolyana: aluna cobrando acesso havia uma
// semana e sem receber nenhum e-mail. A rota pública de reset
// responde { ok: true } mesmo quando o e-mail não existe (é
// anti-enumeração, e está correto) — então de fora não dá para
// distinguir "não chegou" de "nunca foi enviado".
//
// Isto varre TODAS as abas procurando o termo. Assim aparece o
// quadro inteiro: se ela pagou mas não tem login, se está só no
// CRM, se o e-mail foi digitado errado no checkout, etc.
// ============================================================

// Colunas que nunca devem sair daqui, mesmo para admin
var DA_COLUNAS_OCULTAS = ['password_hash', 'token', 'wa_token', 'secret'];

function _daNormalizar_(s) {
  return String(s == null ? '' : s).toLowerCase().trim();
}

// Só dígitos — para casar telefone escrito de qualquer jeito
function _daDigitos_(s) {
  return String(s == null ? '' : s).replace(/\D/g, '');
}

function _daBate_(valorCelula, termos, termosDigitos) {
  var v = _daNormalizar_(valorCelula);
  if (!v) return false;
  for (var i = 0; i < termos.length; i++) {
    if (termos[i] && v.indexOf(termos[i]) >= 0) return true;
  }
  var d = _daDigitos_(valorCelula);
  if (d.length >= 8) {
    for (var j = 0; j < termosDigitos.length; j++) {
      // compara os 8 últimos dígitos: ignora DDI/DDD escritos diferente
      var t = termosDigitos[j];
      if (t.length >= 8 && d.slice(-8) === t.slice(-8)) return true;
    }
  }
  return false;
}

// ROTA ADMIN: diagnosticarAluno
function diagnosticarAluno(token, data) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  data = data || {};

  var termos = [_daNormalizar_(data.email), _daNormalizar_(data.nome)]
    .filter(function (x) { return x && x.length >= 3; });
  var termosDigitos = [_daDigitos_(data.whatsapp)].filter(function (x) { return x.length >= 8; });

  if (!termos.length && !termosDigitos.length) {
    return { ok: false, error: 'Informe e-mail, nome ou WhatsApp.' };
  }

  var ss = getSpreadsheet_();
  var achados = [];
  var abasVarridas = [];

  ss.getSheets().forEach(function (aba) {
    var nome = aba.getName();
    abasVarridas.push(nome);
    var ultLinha = aba.getLastRow(), ultCol = aba.getLastColumn();
    if (ultLinha < 2 || ultCol < 1) return;

    var dados = aba.getRange(1, 1, ultLinha, ultCol).getValues();
    var cab = dados[0].map(function (h) { return String(h || ''); });

    for (var i = 1; i < dados.length; i++) {
      var linha = dados[i];
      var bateu = false;
      for (var c = 0; c < linha.length && !bateu; c++) {
        if (_daBate_(linha[c], termos, termosDigitos)) bateu = true;
      }
      if (!bateu) continue;

      var reg = {};
      cab.forEach(function (h, idx) {
        var hl = _daNormalizar_(h);
        var sensivel = DA_COLUNAS_OCULTAS.some(function (x) { return hl.indexOf(x) >= 0; });
        var v = linha[idx];
        if (v === '' || v == null) return;
        reg[h] = sensivel ? '[oculto]' : String(v).slice(0, 300);
      });
      achados.push({ aba: nome, linha: i + 1, dados: reg });
      if (achados.length >= 40) break;   // teto de segurança
    }
  });

  // Leitura em português do que isso significa
  var temUsuario   = achados.some(function (a) { return a.aba === SHEET_USERS; });
  var temComprador = achados.some(function (a) { return /comprador/i.test(a.aba); });
  var temAssinatura= achados.some(function (a) { return /assinatura/i.test(a.aba); });
  var temLead      = achados.some(function (a) { return /crm|lead/i.test(a.aba); });

  var veredito;
  if (!achados.length) {
    veredito = 'Esta pessoa NAO aparece em nenhuma aba. Nunca chegou a se cadastrar, ' +
               'ou o e-mail/telefone usados no cadastro sao outros.';
  } else if (!temUsuario && (temComprador || temAssinatura)) {
    veredito = 'CRITICO: ela tem registro de compra/assinatura mas NAO tem login na aba users. ' +
               'Por isso nao consegue entrar nem recuperar senha — nao ha senha para recuperar. ' +
               'Precisa criar o acesso.';
  } else if (!temUsuario && temLead) {
    veredito = 'Ela aparece so como lead/CRM. Nao concluiu o cadastro nem a compra.';
  } else if (!temUsuario) {
    veredito = 'Ela aparece no sistema, mas sem linha na aba users — nao tem login.';
  } else {
    veredito = 'Ela TEM login na aba users. Se nao recebe e-mail, o problema e de entrega, ' +
               'nao de cadastro. Confira o log da acao PASSWORD_RESET_VIA.';
  }

  return {
    ok: true,
    data: {
      termos: termos, telefone: termosDigitos,
      totalAchados: achados.length,
      temUsuario: temUsuario, temComprador: temComprador,
      temAssinatura: temAssinatura, temLead: temLead,
      veredito: veredito,
      abasVarridas: abasVarridas.length,
      achados: achados
    }
  };
}

// ─────────────────────────────────────────────────────────────
// Atalho para rodar no editor do Apps Script, sem token.
// Selecione a função e clique em Executar; o resultado sai no Log.
// ─────────────────────────────────────────────────────────────
function diagnosticarApolyana() {
  return _daRodarDireto_({
    email: 'lirasantanaapolyana@gmail.com',
    nome: 'apolyana',
    whatsapp: '+55 99 8122-6631'
  });
}

// Versão sem token, para uso exclusivo dentro do editor
function _daRodarDireto_(alvo) {
  var falso = { role: 'admin', email: 'editor-local' };
  var _orig = getUserByToken;
  getUserByToken = function () { return falso; };
  var r;
  try { r = diagnosticarAluno('editor', alvo); }
  finally { getUserByToken = _orig; }

  var d = r.data || {};
  Logger.log('════════ DIAGNOSTICO ════════');
  Logger.log('Termos: ' + JSON.stringify(d.termos) + ' | telefone: ' + JSON.stringify(d.telefone));
  Logger.log('Abas varridas: ' + d.abasVarridas + ' | registros encontrados: ' + d.totalAchados);
  Logger.log('Tem login (users): ' + d.temUsuario);
  Logger.log('Tem comprador: ' + d.temComprador + ' | assinatura: ' + d.temAssinatura +
             ' | lead: ' + d.temLead);
  Logger.log('');
  Logger.log('VEREDITO: ' + d.veredito);
  Logger.log('');
  (d.achados || []).forEach(function (a) {
    Logger.log('── ' + a.aba + ' (linha ' + a.linha + ')');
    Logger.log(JSON.stringify(a.dados, null, 2));
  });
  return r;
}
