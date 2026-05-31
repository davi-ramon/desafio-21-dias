// ============================================================
// teste.gs — Testes e utilitários de desenvolvimento

// ══════════════════════════════════════════════════════════════
// ASSINATURAS — Funções de teste e gestão manual
// ══════════════════════════════════════════════════════════════

// TESTE 1: TRIAL para o usuário aluno do Davi (deyvid.win7@gmail.com)
function testarAssinaturaTrial() {
  var email = 'deyvid.win7@gmail.com';
  var dias  = 7; // mude para 14 ou 21
  var trialFim = new Date(Date.now() + dias * 86400000).toISOString();
  _upsertAssinatura_(email, {
    sub_id: 'TESTE-TRIAL-' + Date.now(), cakto_status: 'active', app_status: AS.TRIAL,
    plan: 'monthly', trial_start: new Date().toISOString(), trial_end: trialFim,
    trial_days: dias, trial_rem: dias, next_billing: trialFim, amount: 17,
  });
  _syncAcesso_(email, AS.TRIAL);
  Logger.log('✅ Trial de ' + dias + ' dias para ' + email);
  return 'OK';
}

// TESTE 2: ASSINANTE ATIVO (pago, em dia)
function testarAssinaturaAtiva() {
  var email = 'deyvid.win7@gmail.com';
  var prox  = new Date(Date.now() + 30 * 86400000).toISOString();
  _upsertAssinatura_(email, {
    sub_id: 'TESTE-ATIVA-' + Date.now(), cakto_status: 'active', app_status: AS.ACTIVE,
    plan: 'monthly', trial_start: '', trial_end: '', trial_days: 0, trial_rem: 0,
    next_billing: prox, failed_at: '', grace_day: 0, next_retry: '', blocked_at: '', amount: 17,
  });
  _syncAcesso_(email, AS.ACTIVE);
  Logger.log('✅ Assinatura ATIVA para ' + email);
  return 'OK';
}

// TESTE 3: INADIMPLÊNCIA grace dia 2 (banner amarelo, acesso liberado)
function testarAssinaturaGrace() {
  var email = 'deyvid.win7@gmail.com';
  _upsertAssinatura_(email, {
    sub_id: 'TESTE-GRACE-' + Date.now(), cakto_status: 'payment_failed', app_status: AS.GRACE,
    plan: 'monthly', failed_at: new Date().toISOString(), grace_day: 2,
    next_retry: new Date(Date.now() + 3 * 86400000).toISOString(), amount: 17,
  });
  _syncAcesso_(email, AS.GRACE);
  Logger.log('✅ Grace dia 2 para ' + email);
  return 'OK';
}

// TESTE 4: BLOQUEIO total (premium negado)
function testarAssinaturaBloqueada() {
  var email = 'deyvid.win7@gmail.com';
  _upsertAssinatura_(email, {
    sub_id: 'TESTE-BLOCK-' + Date.now(), cakto_status: 'payment_failed', app_status: AS.BLOCKED,
    plan: 'monthly', failed_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    grace_day: 5, blocked_at: new Date().toISOString(), amount: 17,
  });
  _syncAcesso_(email, AS.BLOCKED);
  Logger.log('✅ Bloqueio para ' + email);
  return 'OK';
}

// LIMPAR: remove linha de teste do usuário
function limparAssinaturaTeste() {
  var email = 'deyvid.win7@gmail.com';
  var sh = getSpreadsheet_().getSheetByName('assinaturas');
  if (!sh) return 'Aba não existe';
  var dados = sh.getDataRange().getValues();
  for (var i = dados.length - 1; i >= 1; i--) {
    if (String(dados[i][0]).toLowerCase().trim() === email) { sh.deleteRow(i + 1); }
  }
  Logger.log('🗑️ Removido: ' + email);
  return 'OK';
}

// PRODUÇÃO: 45 dias grátis aos usuários de feedback
function conceder45DiasFeedback() {
  var FEEDBACK_USERS = [
    'deyvid.win7@gmail.com',
    // adicione os outros 3 e-mails:
    // 'email2@gmail.com', 'email3@gmail.com', 'email4@gmail.com',
  ];
  var fim = new Date(Date.now() + 45 * 86400000).toISOString();
  FEEDBACK_USERS.forEach(function(email) {
    email = String(email).toLowerCase().trim();
    _upsertAssinatura_(email, {
      sub_id: 'CORTESIA-45D-' + Date.now(), cakto_status: 'courtesy', app_status: AS.TRIAL,
      plan: 'monthly', trial_start: new Date().toISOString(), trial_end: fim,
      trial_days: 45, trial_rem: 45, next_billing: fim, amount: 0,
    });
    _syncAcesso_(email, AS.TRIAL);
    Logger.log('✅ 45 dias cortesia → ' + email);
  });
  return 'OK — ' + FEEDBACK_USERS.length + ' liberados';
}

// ─────────────────────────────────────────────────────────────
// ENVIAR E-MAIL DE INGRESSO DE TESTE
// Selecione esta função e clique ▶️ Executar
// ─────────────────────────────────────────────────────────────
function testarEnvioEmailIngresso() {
  var ingressoTeste = {
    uuid:    'F39D606D-0B92-437F-9E59-DFCA517EB0C3',
    codigo:  'F39D606D',
    orderId: 'TESTE-DAVI-001',
    nome:    'Deyvid Ramon Ferreira Amaral',
    email:   'ads.deyvid@gmail.com',
    cpf:     '062.105.711-82',
    tel:     '',
    produto: 'Ingresso - Seminário Empresarial Fábio Luiz',
    valor:   'R$ 87,00',
    pagto:   'PIX',
    comprou: new Date().toISOString(),
  };

  try {
    enviarEmailIngresso_(ingressoTeste);
    Logger.log('✅ E-mail enviado para: ' + ingressoTeste.email);
    return 'OK';
  } catch(e) {
    Logger.log('❌ Erro: ' + e.message);
    return e.message;
  }
}

// ─────────────────────────────────────────────────────────────
// INSERIR LINHA DE TESTE na aba ingressos_evento
// ─────────────────────────────────────────────────────────────
function inserirLinhaTesteIngresso() {
  var uuid   = 'F39D606D-0B92-437F-9E59-DFCA517EB0C3';
  var codigo = 'F39D606D';
  var ss  = SpreadsheetApp.openById('1KLn6C4LRW0GGTYVZnxYRrEaTQjPfxVfmAG9r3-ixhOU');
  var aba = ss.getSheetByName('ingressos_evento');

  if (!aba) {
    aba = ss.insertSheet('ingressos_evento');
    var cab = [
      'UUID','Codigo','OrderId','Nome','Email','CPF','Telefone',
      'Produto','Valor','Pagamento','CompradoEm',
      'CheckinEm','Status','EmailEnviado'
    ];
    aba.appendRow(cab);
    aba.getRange(1, 1, 1, cab.length)
       .setFontWeight('bold').setBackground('#1a237e').setFontColor('#ffffff');
    aba.setFrozenRows(1);
    Logger.log('Aba ingressos_evento criada.');
  }

  aba.appendRow([
    uuid,
    codigo,
    'TESTE-DAVI-001',
    'Deyvid Ramon Ferreira Amaral',
    'ads.deyvid@gmail.com',
    '062.105.711-82',
    '',                                          // telefone
    'Ingresso - Seminário Empresarial Fábio Luiz',
    'R$ 87,00',
    'PIX',
    new Date().toISOString(),
    '',                                          // CheckinEm — vazio
    'valido',
    'false'
  ]);

  Logger.log('✅ Linha de teste inserida! UUID: ' + uuid);
  return 'OK — ' + uuid;
}

// ============================================================
// Força autorização de todos os escopos OAuth
// COMO USAR:
//   1. No editor do Apps Script, selecione a função
//      "autorizarTodosEscopos" no menu de funções
//   2. Clique ▶️ Executar
//   3. O Google vai pedir para você autorizar todos os escopos
//   4. Clique em "Permitir"
//   5. Pronto — GmailApp, SpreadsheetApp, DriveApp, etc. autorizados
//   6. Pode apagar este arquivo depois se quiser
// ============================================================

function autorizarTodosEscopos() {
  var log = [];

  // ── SpreadsheetApp ───────────────────────────────────────
  try {
    var ss = SpreadsheetApp.openById('1KLn6C4LRW0GGTYVZnxYRrEaTQjPfxVfmAG9r3-ixhOU');
    log.push('✅ SpreadsheetApp — ' + ss.getName());
  } catch(e) {
    log.push('⚠️ SpreadsheetApp — ' + e.message);
  }

  // ── GmailApp ─────────────────────────────────────────────
  try {
    // Envia um e-mail real de teste para confirmar autorização
    GmailApp.sendEmail(
      'ads.deyvid@gmail.com',
      '✅ GmailApp autorizado — WPK Tavares',
      'Este e-mail confirma que o GmailApp está autorizado e funcionando no Apps Script.'
    );
    log.push('✅ GmailApp — e-mail de teste enviado para ads.deyvid@gmail.com');
  } catch(e) {
    log.push('⚠️ GmailApp — ' + e.message);
  }

  // ── DriveApp ─────────────────────────────────────────────
  try {
    var about = DriveApp.getRootFolder().getName();
    log.push('✅ DriveApp — root: ' + about);
  } catch(e) {
    log.push('⚠️ DriveApp — ' + e.message);
  }

  // ── UrlFetchApp ──────────────────────────────────────────
  try {
    var resp = UrlFetchApp.fetch('https://httpstat.us/200', { muteHttpExceptions: true });
    log.push('✅ UrlFetchApp — status: ' + resp.getResponseCode());
  } catch(e) {
    log.push('⚠️ UrlFetchApp — ' + e.message);
  }

  // ── CacheService ─────────────────────────────────────────
  try {
    CacheService.getScriptCache().put('teste_auth', '1', 10);
    log.push('✅ CacheService — OK');
  } catch(e) {
    log.push('⚠️ CacheService — ' + e.message);
  }

  // ── PropertiesService ────────────────────────────────────
  try {
    PropertiesService.getScriptProperties().setProperty('teste_auth', '1');
    log.push('✅ PropertiesService — OK');
  } catch(e) {
    log.push('⚠️ PropertiesService — ' + e.message);
  }

  // ── ScriptApp ────────────────────────────────────────────
  try {
    var url = ScriptApp.getService().getUrl();
    log.push('✅ ScriptApp — URL: ' + url);
  } catch(e) {
    log.push('⚠️ ScriptApp — ' + e.message);
  }

  // ── Utilities ────────────────────────────────────────────
  try {
    var uuid = Utilities.getUuid();
    log.push('✅ Utilities — UUID gerado: ' + uuid);
  } catch(e) {
    log.push('⚠️ Utilities — ' + e.message);
  }

  // Resultado no log
  Logger.log('\n=== RESULTADO DA AUTORIZAÇÃO ===\n' + log.join('\n'));
  return log;
}
