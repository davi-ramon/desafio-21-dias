// ============================================================
// reconciliacao.gs — Worker de Reconciliação de Acesso
// ============================================================
// Compara as 3 abas que controlam acesso e corrige inconsistências:
//   users        → quem pode LOGAR (email+senha)
//   compradores  → quem COMPROU (Cakto cria automaticamente)
//   assinaturas  → quem tem COBRANÇA gerenciada (trial/pago/grace/bloqueio)
//
// REGRA DE OURO (produção):
//   Todo ALUNO precisa estar nas 3 abas. ADMIN é isento.
//
// Inconsistências detectadas e ações:
//   A) Comprou mas SEM login    → cria login + e-mail "crie seu acesso" (3x)
//   B) Comprou mas SEM assinatura→ cria registro de assinatura (espelha compra)
//   C) Tem login (aluno) SEM assinatura → BLOQUEIA acesso (fecha a porta)
//   D) Admin                    → sempre liberado, ignora tudo
// ============================================================

// E-mails ADMIN — nunca são bloqueados, nunca exigem assinatura
var _ADMINS_ = [
  'admin@wpktavares.com',
  'ads.deyvid@gmail.com',
];

// ─────────────────────────────────────────────────────────────
// WORKER PRINCIPAL — roda 1x/dia via trigger
// ─────────────────────────────────────────────────────────────
function reconciliarAcessos_() {
  var ss   = getSpreadsheet_();
  var uSh  = ss.getSheetByName(SHEET_USERS);
  var cSh  = ss.getSheetByName(SHEET_COMPRADORES);
  var aSh  = ss.getSheetByName(SHEET_ASSINATURAS) || initAssinaturasSheet_();
  if (!uSh || !cSh) return { ok: false, error: 'Abas users/compradores ausentes.' };

  var relatorio = { criouLogin: 0, criouAssinatura: 0, bloqueou: 0, lembrou: 0, ok: 0 };

  // Índices
  var uRows = uSh.getDataRange().getValues();
  var uHdr  = uRows[0].map(function(h){ return String(h); });
  var uEmailIdx = uHdr.indexOf('email');
  var uRoleIdx  = uHdr.indexOf('role');
  var uActiveIdx= uHdr.indexOf('active');

  var cRows = cSh.getDataRange().getValues();
  var aRows = aSh.getDataRange().getValues();

  // Mapas para lookup rápido
  var loginMap = {};   // email → {row, role, active}
  for (var i = 1; i < uRows.length; i++) {
    var em = String(uRows[i][uEmailIdx] || '').toLowerCase().trim();
    if (em) loginMap[em] = { rowIndex: i + 1, role: String(uRows[i][uRoleIdx] || 'aluno'), active: uRows[i][uActiveIdx] };
  }

  var assinMap = {};   // email → app_status
  for (var j = 1; j < aRows.length; j++) {
    var ea = String(aRows[j][_ASS_.EMAIL] || '').toLowerCase().trim();
    if (ea) assinMap[ea] = String(aRows[j][_ASS_.APP_STATUS] || '');
  }

  var compradorEmails = {};
  for (var k = 1; k < cRows.length; k++) {
    var ec = String(cRows[k][COL_COMP.EMAIL] || '').toLowerCase().trim();
    if (ec) compradorEmails[ec] = { nome: String(cRows[k][COL_COMP.NOME] || '') };
  }

  // ─── VARREDURA 1: por COMPRADOR ───────────────────────────
  Object.keys(compradorEmails).forEach(function(email) {
    if (_ehAdmin_(email)) { relatorio.ok++; return; }

    var temLogin  = !!loginMap[email];
    var temAssin  = !!assinMap[email];

    // A) Comprou mas SEM login → cria login + e-mail
    if (!temLogin) {
      try {
        var criou = _garantirLoginAluno_(email);
        if (criou) relatorio.criouLogin++;
      } catch(e) {
        logAction('system', 'RECON_LOGIN_ERRO', 'user', email, e.message);
      }
      _lembrarPrimeiroAcesso_(email);
      relatorio.lembrou++;
    }

    // B) Comprou mas SEM assinatura → cria registro espelhando a compra
    if (!temAssin) {
      _criarAssinaturaPadrao_(email);
      relatorio.criouAssinatura++;
    }
  });

  // ─── VARREDURA 2: por LOGIN (fecha portas) ────────────────
  // Recarrega assinaturas (podem ter sido criadas acima)
  var aRows2 = aSh.getDataRange().getValues();
  var assinMap2 = {};
  for (var m = 1; m < aRows2.length; m++) {
    var e2 = String(aRows2[m][_ASS_.EMAIL] || '').toLowerCase().trim();
    if (e2) assinMap2[e2] = String(aRows2[m][_ASS_.APP_STATUS] || '');
  }

  Object.keys(loginMap).forEach(function(email) {
    var info = loginMap[email];
    if (_ehAdmin_(email) || info.role === 'admin') { relatorio.ok++; return; }

    var status = assinMap2[email];
    // C) Aluno com login mas SEM assinatura válida → fecha a porta
    if (!status) {
      // Sem registro de assinatura nenhum → bloqueia (active=false)
      _setUserActive_(uSh, info.rowIndex, false);
      relatorio.bloqueou++;
      logAction('system', 'RECON_BLOQUEIO_SEM_ASSIN', 'user', email, '');
    }
    // Se status existe (trial/active/grace), o controle de acesso do app já cuida
  });

  logAction('system', 'RECON_CONCLUIDA', 'system', '', JSON.stringify(relatorio));
  return { ok: true, relatorio: relatorio };
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function _ehAdmin_(email) {
  return _ADMINS_.indexOf(String(email).toLowerCase().trim()) !== -1;
}

/** Cria registro de assinatura padrão (quando comprou mas não há linha) */
function _criarAssinaturaPadrao_(email) {
  // Sem dados da Cakto, cria como ACTIVE por segurança (comprou de fato)
  // Será sobrescrito pelo próximo webhook real da Cakto.
  _upsertAssinatura_(email, {
    sub_id:       'RECON-' + Date.now(),
    cakto_status: 'reconciled',
    app_status:   AS.ACTIVE,
    plan:         'monthly',
    next_billing: new Date(Date.now() + 30 * 86400000).toISOString(),
    amount:       17,
  });
  _syncAcesso_(email, AS.ACTIVE);
}

/** Liga/desliga o campo active do usuário */
function _setUserActive_(uSh, rowIndex, val) {
  var hdr = uSh.getRange(1, 1, 1, uSh.getLastColumn()).getValues()[0].map(function(h){ return String(h); });
  var idx = hdr.indexOf('active');
  if (idx >= 0) uSh.getRange(rowIndex, idx + 1).setValue(val);
}

/** Lembrete de primeiro acesso — máx 3 envios, depois alerta o técnico */
function _lembrarPrimeiroAcesso_(email) {
  var props = PropertiesService.getScriptProperties();
  var key   = 'primeiro_acesso_' + email;
  var count = parseInt(props.getProperty(key) || '0');

  if (count >= 3) {
    // Já mandou 3x — alerta o técnico (Davi) uma única vez
    var alertKey = 'primeiro_acesso_alerta_' + email;
    if (!props.getProperty(alertKey)) {
      try {
        MailApp.sendEmail('ads.deyvid@gmail.com',
          '[Desafio 21] Primeiro acesso pendente: ' + email,
          'O comprador ' + email + ' nao criou o primeiro acesso apos 3 lembretes.\n' +
          'Verifique manualmente.');
        props.setProperty(alertKey, '1');
      } catch(e) {}
    }
    return;
  }

  // Envia lembrete
  try {
    MailApp.sendEmail(email,
      'Crie seu acesso ao Desafio 21 Dias',
      'Ola!\n\nVoce comprou o Desafio 21 Dias mas ainda nao criou seu acesso.\n\n' +
      'Crie agora em: https://app.wpktavares.com.br/reabertura\n\n' +
      'Use o mesmo e-mail da compra: ' + email + '\n\nEquipe WPK Tavares');
    props.setProperty(key, String(count + 1));
  } catch(e) {}
}

// ─────────────────────────────────────────────────────────────
// SETUP DO TRIGGER DIÁRIO (07:00)
// ─────────────────────────────────────────────────────────────
function setupReconciliacaoTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'reconciliarAcessos_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('reconciliarAcessos_')
    .timeBased().atHour(7).everyDays(1).create();
  return { ok: true, msg: 'Trigger de reconciliacao configurado (07:00 diario).' };
}

// ─────────────────────────────────────────────────────────────
// EXECUÇÃO MANUAL (para teste imediato no editor)
// ─────────────────────────────────────────────────────────────
function rodarReconciliacaoAgora() {
  var r = reconciliarAcessos_();
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}
