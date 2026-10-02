// ============================================================
// teste.gs — Testes e utilitários de desenvolvimento

// ─────────────────────────────────────────────────────────────
// LIMPAR DUPLICATAS (causadas por reenvio de webhook antes do dedup)
// compradores: remove OrderId repetido (mantém a 1ª linha)
// assinaturas: remove Email repetido (mantém a última = mais recente)
// Rodar no editor. Mostra no log quantas removeu.
// ─────────────────────────────────────────────────────────────
function limparDuplicatas() {
  var ss = getSpreadsheet_();
  var rem = { compradores: 0, assinaturas: 0 };

  // compradores — por OrderId (coluna A, índice 0)
  var comp = ss.getSheetByName('compradores');
  if (comp) {
    var d = comp.getDataRange().getValues();
    var vistos = {};
    for (var i = d.length - 1; i >= 1; i--) {
      var oid = String(d[i][0] || '').trim();
      if (!oid) continue;
      if (vistos[oid]) { comp.deleteRow(i + 1); rem.compradores++; }
      else vistos[oid] = true;
    }
  }

  // assinaturas — por Email (coluna A, índice 0); mantém a última
  var ass = ss.getSheetByName('assinaturas');
  if (ass) {
    var a = ass.getDataRange().getValues();
    var seen = {};
    // varre de baixo p/ cima → a 1ª vista (de baixo) é a mais recente, mantém
    for (var j = a.length - 1; j >= 1; j--) {
      var em = String(a[j][0] || '').toLowerCase().trim();
      if (!em) continue;
      if (seen[em]) { ass.deleteRow(j + 1); rem.assinaturas++; }
      else seen[em] = true;
    }
  }

  Logger.log('🗑️ Removidas — compradores: ' + rem.compradores + ' | assinaturas: ' + rem.assinaturas);
  return rem;
}


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

// ══════════════════════════════════════════════════════════════
// CAKTO API — Criar ofertas trial (7 / 14 / 21 dias)
//
// ORDEM DE EXECUÇÃO:
//   1▶️  cakto_1_getToken()        → busca token e salva internamente
//   2▶️  cakto_2_listarProdutos()  → lista produtos, copie o UUID do "Desafio 21 Dias"
//   3▶️  cakto_3_criarTrials()     → cole o UUID em PRODUCT_ID abaixo e execute
//
// Ao final do passo 3 o log mostra os 3 links prontos — me manda e eu subo o deploy.
// Credenciais: tokens/token_Cakto.txt na raiz do projeto
// ══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
// PASSO 1 — Gerar o token de acesso Cakto (dura 10h)
// ⬇️ Preencha CLIENT_ID e CLIENT_SECRET com os valores do arquivo tokens/token_Cakto.txt
// ─────────────────────────────────────────────────────────────
function cakto_1_getToken() {
  var CLIENT_ID     = 'SEU_CLIENT_ID_AQUI';     // ⬇️ cole aqui
  var CLIENT_SECRET = 'SEU_CLIENT_SECRET_AQUI'; // ⬇️ cole aqui

  var resp = UrlFetchApp.fetch('https://api.cakto.com.br/public_api/token/', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: 'client_id=' + CLIENT_ID + '&client_secret=' + CLIENT_SECRET,
    muteHttpExceptions: true,
  });

  var code = resp.getResponseCode();
  var body = resp.getContentText();

  if (code !== 200) {
    Logger.log('❌ Erro ao obter token — HTTP ' + code + '\n' + body);
    return;
  }

  var json  = JSON.parse(body);
  var token = json.access_token;

  // Salva para as próximas funções usarem automaticamente (sem precisar copiar)
  PropertiesService.getScriptProperties().setProperty('CAKTO_TOKEN', token);

  Logger.log('✅ Token obtido e salvo! Expira em ' + (json.expires_in / 3600) + 'h');
  Logger.log('→ Próximo passo: execute cakto_2_listarProdutos()');
}

// ─────────────────────────────────────────────────────────────
// PASSO 2 — Listar produtos e achar o UUID do Desafio 21 Dias
// Olhe no log e copie o "id" do produto correto.
// ─────────────────────────────────────────────────────────────
function cakto_2_listarProdutos() {
  var token = PropertiesService.getScriptProperties().getProperty('CAKTO_TOKEN');
  if (!token) {
    Logger.log('❌ Token não encontrado. Execute cakto_1_getToken() primeiro.');
    return;
  }

  var resp = UrlFetchApp.fetch('https://api.cakto.com.br/public_api/products/', {
    method: 'get',
    headers: { 'Authorization': 'Bearer ' + token },
    muteHttpExceptions: true,
  });

  var code = resp.getResponseCode();
  var body = resp.getContentText();

  if (code !== 200) {
    Logger.log('❌ Erro ao listar produtos — HTTP ' + code + '\n' + body);
    return;
  }

  var json  = JSON.parse(body);
  var lista = json.results || json; // Cakto pode retornar array direto ou { results: [] }

  Logger.log('── PRODUTOS ENCONTRADOS ──────────────────────');
  var arr = Array.isArray(lista) ? lista : [lista];
  arr.forEach(function(p) {
    Logger.log('📦 ' + p.name);
    Logger.log('   id:   ' + p.id);
    Logger.log('   tipo: ' + (p.type || '–'));
    Logger.log('');
  });
  Logger.log('──────────────────────────────────────────────');
  Logger.log('→ Copie o "id" do produto "Desafio 21 Dias"');
  Logger.log('→ Cole na constante PRODUCT_ID dentro de cakto_3_criarTrials()');
  Logger.log('→ Execute: cakto_3_criarTrials()');
}

// ─────────────────────────────────────────────────────────────
// PASSO 3 — Criar as 3 ofertas trial (7 / 14 / 21 dias)
// ⬇️ ANTES DE EXECUTAR: cole o UUID do produto abaixo em PRODUCT_ID
// ─────────────────────────────────────────────────────────────
function cakto_3_criarTrials() {
  var PRODUCT_ID = 'COLE-O-UUID-AQUI'; // ⬇️ cole aqui o id do passo 2

  if (PRODUCT_ID === 'COLE-O-UUID-AQUI') {
    Logger.log('⚠️ Cole o UUID do produto antes de executar.');
    Logger.log('   Execute cakto_2_listarProdutos() e copie o id do produto correto.');
    return;
  }

  var token = PropertiesService.getScriptProperties().getProperty('CAKTO_TOKEN');
  if (!token) {
    Logger.log('❌ Token não encontrado. Execute cakto_1_getToken() primeiro.');
    return;
  }

  var ofertas = [
    { nome: 'Trial 7 Dias – Desafio 21 Dias',  dias: 7  },
    { nome: 'Trial 14 Dias – Desafio 21 Dias', dias: 14 },
    { nome: 'Trial 21 Dias – Desafio 21 Dias', dias: 21 },
  ];

  var resultados = [];

  ofertas.forEach(function(oferta) {
    var payload = JSON.stringify({
      name:                 oferta.nome,
      price:                17,
      units:                1,
      product:              PRODUCT_ID,
      status:               'active',
      type:                 'subscription',
      intervalType:         'month',
      interval:             1,
      recurrence_period:    30,
      quantity_recurrences: -1,
      trial_days:           oferta.dias,
      max_retries:          3,
      retry_interval:       1,
    });

    var resp = UrlFetchApp.fetch('https://api.cakto.com.br/public_api/offers/', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: payload,
      muteHttpExceptions: true,
    });

    var code = resp.getResponseCode();
    var body = resp.getContentText();

    if (code === 200 || code === 201) {
      var json = JSON.parse(body);
      var link = 'https://pay.cakto.com.br/' + json.id;
      Logger.log('✅ ' + oferta.nome);
      Logger.log('   offer_id : ' + json.id);
      Logger.log('   link     : ' + link);
      Logger.log('');
      resultados.push({ dias: oferta.dias, id: json.id, link: link });
    } else {
      Logger.log('❌ Erro ao criar "' + oferta.nome + '" — HTTP ' + code + '\n' + body);
    }
  });

  if (resultados.length > 0) {
    Logger.log('══ RESUMO — MANDA ESSES LINKS PRO CLAUDE ═══════');
    resultados.forEach(function(r) {
      Logger.log('Trial ' + r.dias + ' dias → ' + r.link);
    });
    Logger.log('════════════════════════════════════════════════');
  }
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

// ══════════════════════════════════════════════════════════════
// ⭐ RODE ESTA — força a janela de autorização do Google
// ══════════════════════════════════════════════════════════════
// POR QUE a autorização nunca acontecia: a janela de consentimento do
// Apps Script só aparece quando a exceção de permissão PROPAGA. A
// função autorizarTodosEscopos() abaixo envolve tudo em try/catch,
// então ela engolia justamente o erro que dispara o diálogo — e
// terminava "com sucesso" sem nunca pedir nada.
//
// Esta função NÃO captura nada, de propósito. E usa operações de
// ESCRITA (createFolder/createFile), porque leitura pode já estar
// autorizada e não exige o escopo completo do Drive.
//
// Ao executar: o editor mostra "Autorização necessária" → Revisar
// permissões → escolher a conta → "Avançado" → "Acessar ... (não
// seguro)" → Permitir. Isso é normal: o app é seu, não passou pela
// verificação pública do Google.
function forcarJanelaAutorizacao() {
  var log = [];

  // 1. Drive — ESCRITA. É o que estava faltando (DriveApp.createFolder).
  var pastas = DriveApp.getFoldersByName('WPK_Teste_Autorizacao');
  var pasta  = pastas.hasNext() ? pastas.next() : DriveApp.createFolder('WPK_Teste_Autorizacao');
  var arq    = pasta.createFile('teste_auth.txt', 'ok', MimeType.PLAIN_TEXT);
  arq.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  log.push('✅ Drive (escrita + compartilhamento) — pasta: ' + pasta.getName());
  arq.setTrashed(true);   // limpa o arquivo de teste
  log.push('✅ Drive (excluir) — arquivo de teste removido');

  // 2. Planilha — escrita
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  log.push('✅ Planilha — ' + ss.getName());

  // 3. HTTP externo
  var resp = UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
  log.push('✅ HTTP externo — status ' + resp.getResponseCode());

  // 4. Identidade
  log.push('✅ Identidade — ' + Session.getActiveUser().getEmail());

  // 5. Gatilhos
  log.push('✅ Gatilhos — ' + ScriptApp.getProjectTriggers().length + ' ativo(s)');

  // 6. Propriedades e cache
  PropertiesService.getScriptProperties().setProperty('_auth_ok', nowISO());
  CacheService.getScriptCache().put('_auth_ok', '1', 60);
  log.push('✅ Propriedades e cache — OK');

  // 7. Gmail — só lê o rótulo, não envia nada
  log.push('✅ Gmail — ' + GmailApp.getAliases().length + ' alias(es) configurado(s)');

  var txt = '\n=== AUTORIZAÇÃO CONCLUÍDA ===\n' + log.join('\n') +
            '\n\nAgora rode testarUploadMural() para confirmar o upload de imagem.';
  Logger.log(txt);
  return txt;
}

// Diagnóstico seguro: mostra o que ESTÁ e o que NÃO está autorizado,
// sem interromper na primeira falha. Use para conferir depois.
function verificarPermissoes() {
  var checks = [
    ['Drive — leitura',        function () { return DriveApp.getRootFolder().getName(); }],
    ['Drive — criar pasta',    function () {
        var p = DriveApp.getFoldersByName('WPK_Teste_Autorizacao');
        return (p.hasNext() ? p.next() : DriveApp.createFolder('WPK_Teste_Autorizacao')).getName();
      }],
    ['Planilha',               function () { return SpreadsheetApp.openById(SPREADSHEET_ID).getName(); }],
    ['HTTP externo',           function () { return UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true }).getResponseCode(); }],
    ['Identidade',             function () { return Session.getActiveUser().getEmail(); }],
    ['Gatilhos',               function () { return ScriptApp.getProjectTriggers().length + ' ativo(s)'; }],
    ['Gmail (aliases)',        function () { return GmailApp.getAliases().length + ' alias(es)'; }],
    ['Propriedades',           function () { PropertiesService.getScriptProperties().getProperty('_auth_ok'); return 'OK'; }]
  ];

  var linhas = [], faltando = 0;
  checks.forEach(function (c) {
    try { linhas.push('✅ ' + c[0] + ' — ' + c[1]()); }
    catch (e) { faltando++; linhas.push('❌ ' + c[0] + ' — ' + ((e && e.message) || e)); }
  });

  var txt = '\n=== PERMISSÕES ===\n' + linhas.join('\n') +
    (faltando ? '\n\n⚠️ ' + faltando + ' item(ns) sem autorização. Rode forcarJanelaAutorizacao().'
              : '\n\n✅ Tudo autorizado.');
  Logger.log(txt);
  return txt;
}

// ⚠️ Esta função captura os erros e por isso NÃO abre a janela de
// autorização. Mantida por compatibilidade — para autorizar de fato,
// use forcarJanelaAutorizacao() acima.
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
