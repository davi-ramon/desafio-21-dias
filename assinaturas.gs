// ============================================================
// assinaturas.gs — Gestão do Ciclo de Vida de Assinaturas
// Cakto → App Desafio 21 Dias
// ============================================================
// Prioridade de implementação (spec):
//   1. Estrutura DB         ✅ initAssinaturasSheet_
//   2. Webhooks Cakto       ✅ processWebhookAssinatura_
//   3. Controle de acesso   ✅ checkAcessoPremium_
//   4. Tela Gerenciar       ✅ getAssinaturaInfo (dados p/ frontend)
//   5. Banners dinâmicos    ✅ retornados junto com status
//   6. Trial countdown      ✅ trialRemaining calculado
//   7. Tolerância           ✅ grace 1-5 dias, bloqueio dia 5
//   8. Upgrade (estrutura)  ✅ campo plan preparado
// ============================================================

var SHEET_ASSINATURAS = 'assinaturas';

// ── Índices das colunas (base-0) ─────────────────────────────
var _ASS_ = {
  EMAIL:        0,  // A
  SUB_ID:       1,  // B — ID da assinatura na Cakto
  CAKTO_STATUS: 2,  // C — status raw enviado pela Cakto
  APP_STATUS:   3,  // D — status processado pelo app
  PLAN:         4,  // E — monthly | quarterly | yearly
  TRIAL_START:  5,  // F
  TRIAL_END:    6,  // G — = next_payment_date quando trial ativo
  TRIAL_DAYS:   7,  // H — dias de trial configurados na oferta
  TRIAL_REM:    8,  // I — dias restantes (recalculado diariamente)
  NEXT_BILLING: 9,  // J — próxima cobrança normal
  FAILED_AT:   10,  // K — data da 1ª falha de pagamento
  GRACE_DAY:   11,  // L — dia atual no grace period (1–5)
  NEXT_RETRY:  12,  // M — próxima tentativa de cobrança
  BLOCKED_AT:  13,  // N — quando o acesso foi bloqueado
  AMOUNT:      14,  // O — valor da assinatura (BRL)
  UPDATED_AT:  15,  // P
};

// ── Status do App ─────────────────────────────────────────────
var AS = {
  TRIAL:       'trial',       // Em período de teste
  ACTIVE:      'active',      // Assinante pago, em dia
  GRACE:       'grace',       // Pagamento falhou, dias 1–3 (acesso liberado, banner amarelo)
  GRACE_FINAL: 'grace_final', // Dia 4 (acesso liberado, banner vermelho)
  BLOCKED:     'blocked',     // Acesso bloqueado (trial falhou OU grace expirou)
  CANCELLED:   'cancelled',   // Assinatura cancelada
  PAUSED:      'paused',      // Assinatura pausada
};

// ─────────────────────────────────────────────────────────────
// 1. ESTRUTURA DO BANCO
// ─────────────────────────────────────────────────────────────
function initAssinaturasSheet_() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(SHEET_ASSINATURAS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_ASSINATURAS);
    sh.appendRow([
      'Email', 'SubId', 'CaktoStatus', 'AppStatus', 'Plano',
      'TrialInicio', 'TrialFim', 'TrialDias', 'TrialRestantes',
      'ProxCobranca', 'FalhouEm', 'DiasGrace', 'ProxTentativa',
      'BloqueadoEm', 'Valor', 'AtualizadoEm'
    ]);
    sh.getRange(1, 1, 1, 16)
      .setFontWeight('bold').setBackground('#4a148c').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    Logger.log('[Assinaturas] Aba criada.');
  }
  return sh;
}

// ─────────────────────────────────────────────────────────────
// 2. WEBHOOK — ponto de entrada
//    Chamado de code.gs quando raw.data.subscription existe
// ─────────────────────────────────────────────────────────────
function processWebhookAssinatura_(caktoEvt) {
  try {
    var d         = caktoEvt.data || caktoEvt;
    var eventType = String(caktoEvt.event || '').toLowerCase();
    var customer  = d.customer || {};
    var email     = String(customer.email || '').toLowerCase().trim();
    var sub       = d.subscription;

    if (!email) {
      logAction('system', 'ASSIN_SEM_EMAIL', 'webhook', '', eventType);
      return _okAssinatura_('ignored', 'Sem e-mail');
    }

    // Notificação Telegram do evento (não quebra o fluxo se falhar)
    try { if (typeof tgNotificarAssinatura_ === 'function') tgNotificarAssinatura_(eventType, email, d, sub); } catch(_t) {}

    switch (eventType) {
      // Eventos REAIS da Cakto (confirmados na doc) + aliases legados
      case 'purchase_approved':       // pagamento aprovado (1ª compra ou trial)
      case 'subscription_created':    // assinatura criada
      case 'subscription_renewed':    // renovação cobrada com sucesso
        return _onPurchaseApproved_(email, d, sub);

      case 'subscription_renewal_refused': // renovação recusada (Cakto real)
      case 'purchase_refused':             // compra recusada
      case 'payment_failed':               // alias legado
      case 'subscription_payment_failed':  // alias legado
        return _onPaymentFailed_(email, d, sub);

      case 'subscription_canceled':   // cancelada (Cakto real — 1 L)
      case 'subscription_cancelled':  // alias legado (2 L)
      case 'purchase_cancelled':
      case 'chargeback':              // chargeback → bloqueia
      case 'refund':                  // reembolso → bloqueia
      case 'subscription_refunded':
        return _onCancelled_(email, d);

      case 'subscription_paused':
        return _onPaused_(email);

      case 'subscription_resumed':
        return _onResumed_(email, d, sub);

      case 'plan_upgraded':
      case 'subscription_upgraded':
        return _onUpgraded_(email, d, sub);

      default:
        logAction('system', 'ASSIN_EVENTO_IGNORADO', 'webhook', email, eventType);
        return _okAssinatura_('ignored', 'Evento: ' + eventType);
    }
  } catch(err) {
    logAction('system', 'ASSIN_ERRO_WEBHOOK', 'webhook', '', err.message);
    try { if (typeof tgEnviarErro_ === 'function') tgEnviarErro_('Webhook assinatura', err.message); } catch(_t) {}
    return _okAssinatura_('error', err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// HANDLERS POR TIPO DE EVENTO
// ─────────────────────────────────────────────────────────────

/** purchase_approved — primeiro pagamento OU renovação bem-sucedida */
function _onPurchaseApproved_(email, d, sub) {
  var trialDays  = parseInt((sub && sub.trial_days)             || 0);
  var paidCount  = parseInt((sub && sub.paid_payments_quantity) || 1);
  var subStatus  = String((sub  && sub.status)                  || 'active').toLowerCase();
  var nextDate   = (sub && sub.next_payment_date) || '';
  var amount     = d.amount || (sub && sub.amount) || 0;
  var subId      = (sub && sub.id) || String(d.id || '');
  var plan       = _detectPlan_((sub && sub.recurrence_period) || 30);

  var appStatus, trialStart, trialEnd, trialRem;

  if (trialDays > 0 && paidCount <= 1) {
    // TRIAL: primeiro acesso sem cobrança real
    appStatus  = AS.TRIAL;
    trialStart = new Date().toISOString();
    trialEnd   = nextDate || new Date(Date.now() + trialDays * 86400000).toISOString();
    trialRem   = _calcTrialRemaining_(trialEnd);
  } else {
    // Pagamento aprovado (novo ou renovação)
    appStatus  = AS.ACTIVE;
    trialStart = '';
    trialEnd   = '';
    trialRem   = 0;
  }

  _upsertAssinatura_(email, {
    sub_id:       subId,
    cakto_status: subStatus,
    app_status:   appStatus,
    plan:         plan,
    trial_start:  trialStart,
    trial_end:    trialEnd,
    trial_days:   trialDays,
    trial_rem:    trialRem,
    next_billing: nextDate,
    failed_at:    '',
    grace_day:    0,
    next_retry:   '',
    blocked_at:   '',
    amount:       amount,
  });

  _syncAcesso_(email, appStatus);

  // PRIMEIRO ACESSO: cria login automático + envia senha por e-mail
  // (só na primeira compra — se o usuário já existe, não faz nada)
  try { _garantirLoginAluno_(email); } catch(e) {
    logAction('system', 'ASSIN_LOGIN_ERRO', 'assinatura', email, e.message);
  }

  logAction('system', 'ASSIN_' + appStatus.toUpperCase(), 'assinatura', email, plan);
  return _okAssinatura_('ok', appStatus + ' · ' + plan);
}

/**
 * Garante que o aluno tenha login (aba users).
 * Se não existir, cria com senha provisória e envia e-mail de boas-vindas.
 * Retorna true se criou um novo login, false se já existia.
 */
function _garantirLoginAluno_(email) {
  var ss    = getSpreadsheet_();
  var users = ss.getSheetByName(SHEET_USERS);
  if (!users) return false;

  var emailNorm = String(email).toLowerCase().trim();
  var rows      = users.getDataRange().getValues();
  var headers   = rows[0].map(function(h){ return String(h); });
  var emailIdx  = headers.indexOf('email');

  // Já existe login? não faz nada
  for (var i = 1; i < rows.length; i++) {
    // v102: compara normalizado (legacy data pode estar com caps/espaco)
    if (String(rows[i][emailIdx] || '').toLowerCase().trim() === emailNorm) return false;
  }

  // Busca nome em compradores
  var nome = '';
  var comp = ss.getSheetByName(SHEET_COMPRADORES);
  if (comp) {
    var cRows = comp.getDataRange().getValues();
    for (var k = 1; k < cRows.length; k++) {
      if (String(cRows[k][COL_COMP.EMAIL]).toLowerCase().trim() === emailNorm) {
        nome = String(cRows[k][COL_COMP.NOME] || ''); break;
      }
    }
  }

  // Cria login com senha provisória (reusa gerador legível do reabertura.gs)
  var senha = (typeof _gerarSenhaTemp_ === 'function')
    ? _gerarSenhaTemp_()
    : Math.random().toString(36).slice(-8);
  var hash  = hashPassword(senha);
  users.appendRow([generateId(), nome, emailNorm, hash, 'aluno', '', true, nowISO()]);

  // E-mail de boas-vindas (reusa template HTML bonito do reabertura.gs)
  try {
    var wsNome = 'WPK Tavares';
    try { wsNome = getWorkspaceConfig().nome || wsNome; } catch(e) {}
    var appUrl  = 'https://app.wpktavares.com.br';
    _enviarCredenciaisReinabertura_(emailNorm, nome || emailNorm, senha, wsNome, appUrl);
  } catch(e) {
    // Fallback texto simples
    try {
      MailApp.sendEmail(emailNorm, 'Bem-vindo ao Desafio 21 Dias — seu acesso',
        'E-mail: ' + emailNorm + '\nSenha provisoria: ' + senha +
        '\n\nAcesse: https://app.wpktavares.com.br');
    } catch(e2) {}
  }

  logAction('system', 'ASSIN_LOGIN_CRIADO', 'user', emailNorm, nome);
  return true;
}

/** payment_failed — cobrança recusada */
function _onPaymentFailed_(email, d, sub) {
  var existing = _getAssinaturaRow_(email);
  if (!existing) {
    logAction('system', 'ASSIN_FALHA_SEM_REGISTRO', 'webhook', email, '');
    return _okAssinatura_('ignored', 'Sem registro: ' + email);
  }

  var currentStatus = String(existing[_ASS_.APP_STATUS] || AS.ACTIVE);
  var trialDays     = parseInt(existing[_ASS_.TRIAL_DAYS] || 0);
  var now           = new Date().toISOString();
  var nextRetry     = (sub && sub.next_payment_date) || '';

  // TRIAL: bloqueio imediato (sem período de tolerância)
  if (currentStatus === AS.TRIAL || (trialDays > 0 && currentStatus !== AS.ACTIVE)) {
    _upsertAssinatura_(email, {
      cakto_status: 'payment_failed',
      app_status:   AS.BLOCKED,
      failed_at:    now,
      grace_day:    0,
      blocked_at:   now,
    });
    _syncAcesso_(email, AS.BLOCKED);
    logAction('system', 'ASSIN_TRIAL_BLOQUEADA', 'assinatura', email, 'falha na 1a cobrança');
    return _okAssinatura_('ok', 'Trial bloqueado');
  }

  // ASSINANTE PAGO: período de tolerância
  var failedAt = String(existing[_ASS_.FAILED_AT] || '') || now;
  var graceDay = parseInt(existing[_ASS_.GRACE_DAY] || 0) + 1;
  var newStatus;

  if (graceDay >= 5) {
    // Dia 5: bloqueio definitivo
    newStatus = AS.BLOCKED;
    _upsertAssinatura_(email, {
      cakto_status: 'payment_failed',
      app_status:   AS.BLOCKED,
      failed_at:    failedAt,
      grace_day:    graceDay,
      next_retry:   nextRetry,
      blocked_at:   now,
    });
    _syncAcesso_(email, AS.BLOCKED);
    logAction('system', 'ASSIN_BLOQUEADA_GRACE', 'assinatura', email, 'dia ' + graceDay);
  } else if (graceDay >= 4) {
    // Dia 4: último aviso (banner vermelho)
    newStatus = AS.GRACE_FINAL;
    _upsertAssinatura_(email, {
      cakto_status: 'payment_failed',
      app_status:   AS.GRACE_FINAL,
      failed_at:    failedAt,
      grace_day:    graceDay,
      next_retry:   nextRetry,
    });
    logAction('system', 'ASSIN_GRACE_FINAL', 'assinatura', email, 'dia ' + graceDay);
  } else {
    // Dias 1–3: tolerância (banner amarelo)
    newStatus = AS.GRACE;
    _upsertAssinatura_(email, {
      cakto_status: 'payment_failed',
      app_status:   AS.GRACE,
      failed_at:    failedAt,
      grace_day:    graceDay,
      next_retry:   nextRetry,
    });
    logAction('system', 'ASSIN_GRACE', 'assinatura', email, 'dia ' + graceDay);
  }

  return _okAssinatura_('ok', 'Grace dia ' + graceDay + ' → ' + newStatus);
}

/** subscription_cancelled */
function _onCancelled_(email, d) {
  var now = new Date().toISOString();
  _upsertAssinatura_(email, {
    cakto_status: 'cancelled',
    app_status:   AS.CANCELLED,
    blocked_at:   now,
  });
  _syncAcesso_(email, AS.CANCELLED);
  logAction('system', 'ASSIN_CANCELADA', 'assinatura', email, '');
  return _okAssinatura_('ok', 'Cancelada');
}

/** subscription_paused */
function _onPaused_(email) {
  _upsertAssinatura_(email, { cakto_status: 'paused', app_status: AS.PAUSED });
  _syncAcesso_(email, AS.PAUSED);
  logAction('system', 'ASSIN_PAUSADA', 'assinatura', email, '');
  return _okAssinatura_('ok', 'Pausada');
}

/** subscription_resumed */
function _onResumed_(email, d, sub) {
  var nextDate = (sub && sub.next_payment_date) || '';
  _upsertAssinatura_(email, {
    cakto_status: 'active',
    app_status:   AS.ACTIVE,
    failed_at:    '',
    grace_day:    0,
    next_retry:   '',
    blocked_at:   '',
    next_billing: nextDate,
  });
  _syncAcesso_(email, AS.ACTIVE);
  logAction('system', 'ASSIN_RETOMADA', 'assinatura', email, '');
  return _okAssinatura_('ok', 'Retomada');
}

/** plan_upgraded */
function _onUpgraded_(email, d, sub) {
  var plan     = _detectPlan_((sub && sub.recurrence_period) || 30);
  var nextDate = (sub && sub.next_payment_date) || '';
  var amount   = d.amount || (sub && sub.amount) || 0;
  _upsertAssinatura_(email, {
    cakto_status: 'active',
    app_status:   AS.ACTIVE,
    plan:         plan,
    next_billing: nextDate,
    amount:       amount,
    failed_at:    '',
    grace_day:    0,
    blocked_at:   '',
  });
  logAction('system', 'ASSIN_UPGRADE', 'assinatura', email, plan);
  return _okAssinatura_('ok', 'Upgrade → ' + plan);
}

// ─────────────────────────────────────────────────────────────
// 3. CONTROLE DE ACESSO PREMIUM
// ─────────────────────────────────────────────────────────────

/**
 * Retorna objeto completo com status + se tem acesso + dados para o app.
 * Usado por getAlunoData() para incluir subscription no payload do aluno.
 */
function checkAcessoPremium_(email) {
  var row = _getAssinaturaRow_(email);
  if (!row) {
    // Sem registro de assinatura → acesso legado (compradores antigos)
    return { allowed: true, status: 'legacy', plan: '', banner: null };
  }

  var status   = String(row[_ASS_.APP_STATUS] || AS.BLOCKED);
  var allowed  = [AS.TRIAL, AS.ACTIVE, AS.GRACE, AS.GRACE_FINAL].indexOf(status) !== -1;
  var trialEnd = String(row[_ASS_.TRIAL_END] || '');
  var trialRem = _calcTrialRemaining_(trialEnd);

  // Banner para exibição no app
  var banner = _buildBanner_(status, trialRem, parseInt(row[_ASS_.GRACE_DAY] || 0));

  return {
    allowed:        allowed,
    status:         status,
    plan:           String(row[_ASS_.PLAN]        || ''),
    trialDays:      parseInt(row[_ASS_.TRIAL_DAYS] || 0),
    trialEnd:       trialEnd,
    trialRemaining: trialRem,
    nextBilling:    String(row[_ASS_.NEXT_BILLING] || ''),
    nextRetry:      String(row[_ASS_.NEXT_RETRY]   || ''),
    graceDay:       parseInt(row[_ASS_.GRACE_DAY]  || 0),
    failedAt:       String(row[_ASS_.FAILED_AT]    || ''),
    blockedAt:      String(row[_ASS_.BLOCKED_AT]   || ''),
    amount:         String(row[_ASS_.AMOUNT]        || ''),
    banner:         banner,
  };
}

function _buildBanner_(status, trialRem, graceDay) {
  if (status === AS.ACTIVE || status === 'legacy') return null;

  if (status === AS.TRIAL) {
    if (trialRem <= 1) return {
      type: 'warning',
      msg:  'Hoje e o ultimo dia do seu periodo de teste. Para continuar, mantenha seu metodo de pagamento valido.'
    };
    return {
      type: 'info',
      msg:  'Voce esta em periodo de teste. Restam ' + trialRem + ' dia' + (trialRem !== 1 ? 's' : '') + '.'
    };
  }
  if (status === AS.GRACE) return {
    type: 'yellow',
    msg:  'Nao foi possivel processar sua renovacao. Tentaremos novamente em breve. Atualize seu metodo de pagamento.'
  };
  if (status === AS.GRACE_FINAL) return {
    type: 'red',
    msg:  'Atencao. Este e o ultimo aviso antes do bloqueio da sua assinatura. Atualize seu metodo de pagamento imediatamente.'
  };
  if (status === AS.BLOCKED) return {
    type: 'blocked',
    msg:  'Seu metodo de pagamento apresentou falha. Atualize seu cartao para continuar utilizando o Desafio 21 Dias.'
  };
  if (status === AS.CANCELLED) return {
    type: 'blocked',
    msg:  'Sua assinatura foi cancelada. Assine novamente para recuperar o acesso.'
  };
  if (status === AS.PAUSED) return {
    type: 'yellow',
    msg:  'Sua assinatura esta pausada. Entre em contato para reativar.'
  };
  return null;
}

// ─────────────────────────────────────────────────────────────
// 4. API — getAssinaturaInfo (chamado diretamente do app)
// ─────────────────────────────────────────────────────────────
function getAssinaturaInfo(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  var info = checkAcessoPremium_(user.email);
  return { ok: true, data: info };
}

// ─────────────────────────────────────────────────────────────
// 7. TRIGGER DIÁRIO — processa grace e trial countdown
//    Executa todo dia às 06:00 via setupAssinaturaTrigger()
// ─────────────────────────────────────────────────────────────
function processarAssinaturasdiarias_() {
  var sh    = initAssinaturasSheet_();
  var dados = sh.getDataRange().getValues();
  var agora = new Date();

  for (var i = 1; i < dados.length; i++) {
    var row    = dados[i];
    var email  = String(row[_ASS_.EMAIL]      || '');
    var status = String(row[_ASS_.APP_STATUS] || '');
    if (!email) continue;

    // ── Atualiza dias restantes do trial ──────────────────
    if (status === AS.TRIAL) {
      var trialEnd = String(row[_ASS_.TRIAL_END] || '');
      var rem      = _calcTrialRemaining_(trialEnd);
      sh.getRange(i + 1, _ASS_.TRIAL_REM + 1).setValue(rem);

      if (rem <= 0) {
        // Trial expirado sem pagamento aprovado → bloqueia
        sh.getRange(i + 1, _ASS_.APP_STATUS  + 1).setValue(AS.BLOCKED);
        sh.getRange(i + 1, _ASS_.BLOCKED_AT  + 1).setValue(agora.toISOString());
        _syncAcesso_(email, AS.BLOCKED);
        logAction('system', 'ASSIN_TRIAL_EXPIRADO', 'assinatura', email, '');
      }
    }

    // ── Incrementa contador de grace ─────────────────────
    if (status === AS.GRACE || status === AS.GRACE_FINAL) {
      var graceDay = parseInt(row[_ASS_.GRACE_DAY] || 0) + 1;
      var newSt;
      if (graceDay >= 5) {
        newSt = AS.BLOCKED;
        sh.getRange(i + 1, _ASS_.BLOCKED_AT + 1).setValue(agora.toISOString());
        _syncAcesso_(email, AS.BLOCKED);
        logAction('system', 'ASSIN_GRACE_EXPIRADO', 'assinatura', email, 'dia ' + graceDay);
      } else if (graceDay >= 4) {
        newSt = AS.GRACE_FINAL;
      } else {
        newSt = AS.GRACE;
      }
      sh.getRange(i + 1, _ASS_.GRACE_DAY   + 1).setValue(graceDay);
      sh.getRange(i + 1, _ASS_.APP_STATUS  + 1).setValue(newSt);
    }
  }
  Logger.log('[Assinaturas] Processamento diário concluído: ' + (dados.length - 1) + ' registros.');
}

/** Configura trigger diário às 06:00 */
function setupAssinaturaTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'processarAssinaturasdiarias_') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('processarAssinaturasdiarias_')
    .timeBased().atHour(6).everyDays(1).create();
  return { ok: true, msg: 'Trigger diario configurado (06:00).' };
}

// ─────────────────────────────────────────────────────────────
// HELPERS DE SHEET
// ─────────────────────────────────────────────────────────────

function _getAssinaturaRow_(email) {
  var sh        = initAssinaturasSheet_();
  var dados     = sh.getDataRange().getValues();
  var emailNorm = String(email).toLowerCase().trim();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][_ASS_.EMAIL]).toLowerCase().trim() === emailNorm) return dados[i];
  }
  return null;
}

function _upsertAssinatura_(email, upd) {
  var sh        = initAssinaturasSheet_();
  var dados     = sh.getDataRange().getValues();
  var emailNorm = String(email).toLowerCase().trim();
  var now       = new Date().toISOString();

  var colMap = {
    sub_id:       _ASS_.SUB_ID,
    cakto_status: _ASS_.CAKTO_STATUS,
    app_status:   _ASS_.APP_STATUS,
    plan:         _ASS_.PLAN,
    trial_start:  _ASS_.TRIAL_START,
    trial_end:    _ASS_.TRIAL_END,
    trial_days:   _ASS_.TRIAL_DAYS,
    trial_rem:    _ASS_.TRIAL_REM,
    next_billing: _ASS_.NEXT_BILLING,
    failed_at:    _ASS_.FAILED_AT,
    grace_day:    _ASS_.GRACE_DAY,
    next_retry:   _ASS_.NEXT_RETRY,
    blocked_at:   _ASS_.BLOCKED_AT,
    amount:       _ASS_.AMOUNT,
  };

  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][_ASS_.EMAIL]).toLowerCase().trim() !== emailNorm) continue;
    // Linha existente — atualiza apenas os campos fornecidos
    Object.keys(upd).forEach(function(k) {
      if (colMap[k] !== undefined && upd[k] !== undefined) {
        sh.getRange(i + 1, colMap[k] + 1).setValue(upd[k]);
      }
    });
    sh.getRange(i + 1, _ASS_.UPDATED_AT + 1).setValue(now);
    return;
  }

  // Nova linha
  var row = new Array(16).fill('');
  row[_ASS_.EMAIL]      = email;
  row[_ASS_.UPDATED_AT] = now;
  Object.keys(upd).forEach(function(k) {
    if (colMap[k] !== undefined) row[colMap[k]] = upd[k];
  });
  sh.appendRow(row);
}

function _detectPlan_(recurrencePeriod) {
  var p = parseInt(recurrencePeriod || 30);
  if (p <= 31)  return 'monthly';
  if (p <= 100) return 'quarterly';
  return 'yearly';
}

function _calcTrialRemaining_(trialEndISO) {
  if (!trialEndISO) return 0;
  try {
    var diff = Math.ceil((new Date(trialEndISO) - new Date()) / 86400000);
    return Math.max(0, diff);
  } catch(e) { return 0; }
}

/**
 * Sincroniza campo 'Ativo' na aba compradores.
 * Mantém retrocompatibilidade com o sistema legado.
 */
function _syncAcesso_(email, appStatus) {
  try {
    var allowed = [AS.TRIAL, AS.ACTIVE, AS.GRACE, AS.GRACE_FINAL].indexOf(appStatus) !== -1;
    var ss  = getSpreadsheet_();
    var sh  = ss.getSheetByName('compradores');
    if (!sh || sh.getLastRow() < 2) return;
    var dados     = sh.getDataRange().getValues();
    var headers   = dados[0].map(function(h) { return String(h); });
    var emailIdx  = headers.indexOf('Email');
    var ativoIdx  = headers.indexOf('Ativo');
    if (emailIdx < 0 || ativoIdx < 0) return;
    var norm = email.toLowerCase().trim();
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][emailIdx]).toLowerCase().trim() === norm) {
        sh.getRange(i + 1, ativoIdx + 1).setValue(allowed);
        return;
      }
    }
  } catch(e) {
    Logger.log('[_syncAcesso_] Erro: ' + e.message);
  }
}

function _okAssinatura_(status, msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: status, msg: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}

// v102: endpoint PUBLICO pra resolver "paguei mas nao consigo acessar".
// Encontra usuario na aba users, gera nova senha provisoria, reenvia email.
// Rate-limit compartilhado com _gatePublico_ (chamado pelo doPost).
function reenviarCredenciaisPublic(email) {
  try {
    var emailNorm = String(email || '').toLowerCase().trim();
    if (!emailNorm) return { ok: false, error: 'Email invalido.' };
    var sh = getSpreadsheet_();
    var users = sh.getSheetByName(SHEET_USERS);
    if (!users) return { ok: false, error: 'Aba users nao existe.' };

    var rows = users.getDataRange().getValues();
    var headers = rows[0].map(function(h){ return String(h); });
    var emailIdx = headers.indexOf('email');
    var nomeIdx  = headers.indexOf('name');
    var hashIdx  = headers.indexOf('password_hash');

    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][emailIdx] || '').toLowerCase().trim() === emailNorm) {
        var nome = String(rows[i][nomeIdx] || '');
        var newPwd = (typeof _gerarSenhaTemp_ === 'function')
          ? _gerarSenhaTemp_()
          : Math.random().toString(36).slice(-8);
        // Reseta hash com nova senha
        if (hashIdx >= 0) {
          users.getRange(i + 1, hashIdx + 1).setValue(hashPassword(newPwd));
        }
        // Reenvia o email
        try {
          var wsNome = 'WPK Tavares';
          try { wsNome = (typeof getWorkspaceConfig === 'function' ? (getWorkspaceConfig().nome || wsNome) : wsNome); } catch(e) {}
          if (typeof _enviarCredenciaisReinabertura_ === 'function') {
            _enviarCredenciaisReinabertura_(emailNorm, nome || emailNorm, newPwd, wsNome, 'https://app.wpktavares.com.br');
          } else {
            MailApp.sendEmail(emailNorm, 'WPK Tavares - Seu acesso', 'Sua nova senha: ' + newPwd);
          }
          try { logAction(emailNorm, 'CREDENCIAIS_REENVIADAS', 'auth', '', 'senha resetada e email reenviado'); } catch(_e) {}
          return { ok: true, message: 'Senha nova gerada e email reenviado para ' + emailNorm + '.' };
        } catch (e) {
          try { logAction(emailNorm, 'CREDENCIAIS_REENVIO_ERRO', 'auth', '', e.message); } catch(_e) {}
          return { ok: false, error: 'Usuario existe mas email nao pode ser enviado: ' + e.message };
        }
      }
    }
    try { logAction(emailNorm, 'CREDENCIAIS_REENVIADAS_NAO_EXISTE', 'auth', '', ''); } catch(_e) {}
    return { ok: false, error: 'Email nao cadastrado. Voce comprou ou criou a conta com este email? Se sim, entre em contato com o suporte.' };
  } catch (e) { return { ok: false, error: e.message }; }
}
