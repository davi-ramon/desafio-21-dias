// ============================================================
// modules.gs — Contacts, Log, Tasks + Router central
// Versão: 5.0 — + Meta API + Teste 21 dias + Dashboard Full
// ============================================================

// ── Contacts ─────────────────────────────────────────────────
function getContacts(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  return { ok: true, data: sheetToObjects(getSheet(SHEET_CONTACTS)) };
}
function createContact(token, contactData) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  var id = generateId(), now = nowISO();
  getSheet(SHEET_CONTACTS).appendRow([id, contactData.name||'', contactData.email||'', contactData.phone||'', contactData.company||'', contactData.tags||'', contactData.notes||'', now]);
  logAction(user.email,'CREATE_CONTACT','contact',id,contactData.name);
  return { ok: true, id: id };
}
function updateContact(token, contactId, updates) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  var sheet = getSheet(SHEET_CONTACTS), data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h){ return String(h); }), idIdx = headers.indexOf('id');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(contactId)) {
      ['name','email','phone','company','tags','notes'].forEach(function(key) {
        if (updates[key] !== undefined) sheet.getRange(i+1, headers.indexOf(key)+1).setValue(updates[key]);
      });
      logAction(user.email,'UPDATE_CONTACT','contact',contactId,'');
      return { ok: true };
    }
  }
  return { ok: false, error: 'Contato nao encontrado.' };
}
function deleteContact(token, contactId) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };
  var sheet = getSheet(SHEET_CONTACTS), data = sheet.getDataRange().getValues();
  var idIdx = data[0].map(function(h){ return String(h); }).indexOf('id');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(contactId)) {
      sheet.deleteRow(i+1);
      logAction(user.email,'DELETE_CONTACT','contact',contactId,'');
      return { ok: true };
    }
  }
  return { ok: false, error: 'Contato nao encontrado.' };
}

// ── Log ───────────────────────────────────────────────────────
function logAction(userEmail, action, entity, entityId, details) {
  try {
    getSheet(SHEET_LOG).appendRow([generateId(), userEmail, action, entity, entityId,
      (typeof details === 'string') ? details : JSON.stringify(details), nowISO()]);
  } catch(e) {}
}
function getLogs(token, limit) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };
  return { ok: true, data: sheetToObjects(getSheet(SHEET_LOG)).reverse().slice(0, limit || 200) };
}

// ── Tasks ─────────────────────────────────────────────────────
function getTasks(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  var tasks = sheetToObjects(getSheet(SHEET_TASKS));
  return { ok: true, data: user.role === 'admin' ? tasks : tasks.filter(function(t){ return t.assigned_to === user.email; }) };
}
function createTask(token, taskData) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  var id = generateId();
  getSheet(SHEET_TASKS).appendRow([id, taskData.title, taskData.description||'', taskData.assigned_to||user.email, taskData.lead_id||'', taskData.status||'Pendente', taskData.due_date||'', nowISO()]);
  logAction(user.email,'CREATE_TASK','task',id,taskData.title);
  return { ok: true, id: id };
}
function updateTask(token, taskId, updates) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  var sheet = getSheet(SHEET_TASKS), data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h){ return String(h); }), idIdx = headers.indexOf('id');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(taskId)) {
      ['title','description','assigned_to','status','due_date'].forEach(function(key) {
        if (updates[key] !== undefined) sheet.getRange(i+1, headers.indexOf(key)+1).setValue(updates[key]);
      });
      logAction(user.email,'UPDATE_TASK','task',taskId,'');
      return { ok: true };
    }
  }
  return { ok: false, error: 'Tarefa nao encontrada.' };
}

// ============================================================
// Router — handleRequest v5.0
// ============================================================
function handleRequest(payload) {
  var action = payload.action;
  var token  = payload.token;
  var data   = payload.data || {};

  switch(action) {
    // Auth
    case 'login':               return login(data.email, data.password);
    case 'logout':              return logout(token);

    // Leads
    case 'getLeadsLite':        return getLeadsLite(token);
    case 'getLeads':            return getLeads(token);
    case 'getLead':             return getLead(token, data.id);
    case 'createLead':          return createLead(token, data);
    case 'updateLead':          return updateLead(token, data.id, data.updates);
    case 'deleteLead':          return deleteLead(token, data.id);

    // Dashboard
    case 'getDashboard':        return getDashboardMetrics(token);
    case 'getDashboardFull':    return getDashboardFull(token, data); // data.dias = filtro de período

    // Sincronização
    case 'manualSync':          return manualSync(token);
    case 'setupTriggers':       return setupTriggers();
    case 'removeAllTriggers':   return removeAllTriggers();
    case 'getSyncStatus':       return getSyncStatus(token);
    case 'syncContacts':        return syncContactsFromLeads(token);
    case 'cleanupCRM':          return cleanupCRMSheet(token);

    // Contatos
    case 'getContacts':         return getContacts(token);
    case 'createContact':       return createContact(token, data);
    case 'updateContact':       return updateContact(token, data.id, data.updates);
    case 'deleteContact':       return deleteContact(token, data.id);

    // Usuários
    case 'getUsers':            return getUsers(token);
    case 'getMyProfile':        return getMyProfile(token);
    case 'getUserFull':         return getUserFull(token, data.userId);
    case 'updateMyProfile':     return updateMyProfile(token, data.updates);
    case 'updateUserFull':      return updateUserFull(token, data.userId, data.updates);
    case 'changeMyPassword':    return changeMyPassword(token, data.currentPwd, data.newPwd);
    case 'resetUserPassword':   return resetUserPassword(token, data.userId, data.newPwd);
    case 'uploadUserAsset':     return uploadUserAssetBase64(token, data.fileBase64, data.fileName, data.kind);
    case 'logUserAccess':       return logUserAccess(token, data.ip);
    case 'createUserExtended':  return createUserExtended(token, data);
    case 'createUser':          return createUser(token, data);
    case 'updateUser':          return updateUser(token, data.id, data.updates);

    // Tarefas
    case 'getTasks':            return getTasks(token);
    case 'createTask':          return createTask(token, data);
    case 'updateTask':          return updateTask(token, data.id, data.updates);

    // Logs
    case 'getLogs':             return getLogs(token, data.limit);

    // Init
    case 'initSheets':          return initSheets();

    // Automações v4+
    case 'getConfig':                return getFullConfig(token);
    case 'saveConfig':               return saveFullConfig(token, data.config);
    case 'getAutomacaoStatus':       return getAutomacaoStatus(token);
    case 'registrarCheckin':         return registrarCheckin_(data.telefone, data.resposta);
    case 'setupAutomacaoTriggers':   return setupAutomacaoTriggers();
    case 'setupAllTriggers': { setupTriggers(); return setupAutomacaoTriggers(); }

    // Compradores / Teste 21 dias (novo v5)
    case 'getCompradoresList':          return getCompradoresList(token);
    case 'iniciarTesteAcompanhamento':  return iniciarTesteAcompanhamentoV2(token, data);

    // Meta Marketing API (novo v5)
    case 'testarConexaoMeta':    return testarConexaoMeta(token);
    case 'syncMetaManual':       return syncMetaManual(token);
    case 'getMetaStatus':        return getMetaStatus(token);
    case 'setupMetaTrigger':     return setupMetaTrigger();
    // Meta Marketing API — criacao (meta_ads_create.gs, v89+)
    case 'validarMetaToken':         return validarMetaToken(data.token, data.accountId);
    case 'salvarMetaToken':          return setupMetaToken_(data.token, data.accountId);
    case 'uploadAdImage':            return uploadAdImage(token, data.fileBase64, data.nome);
    case 'criarCampanhaMeta':        return criarCampanhaMeta(token, data);
    case 'criarAdSetMeta':           return criarAdSetMeta(token, data);
    case 'criarAdCreativeMeta':      return criarAdCreativeMeta(token, data);
    case 'criarAdMeta':              return criarAdMeta(token, data);
    case 'criarCampanhaCompletaMeta':return criarCampanhaCompletaMeta(token, data);
    case 'setAdStatusMeta':          return setAdStatusMeta(token, data.adId, data.status);
    case 'listarCriativos':          return listarCriativos(token);
    case 'salvarCriativo':           return salvarCriativo(token, data);
    case 'setCriativoStatus':        return setCriativoStatus(token, data.criativoId, data.status);
    case 'getTopCriativosHistoricos':return getTopCriativosHistoricos(token);
    case 'criarCriativoReciclado':   return criarCriativoReciclado(token, data.topAdNome);
    case 'setupAllTriggersV2': {
      setupTriggers();
      setupAutomacaoTriggers();
      return setupMetaTrigger();
    }

    // Auth — recuperação de senha (sem token, por isso fora do bloco autenticado)
    case 'sendPasswordReset':        return sendPasswordReset(data.email);
    case 'verifyAndResetPassword':   return verifyAndResetPassword(data.email, data.code, data.newPassword);

    // Área do aluno
    case 'getAlunoData':             return getAlunoData(token);
    case 'marcarPilar':              return marcarPilar(token, data.pilar, data.valor);
    case 'getConteudoAluno':         return getConteudoAluno(token);
    case 'saveMedProgress':          return saveMedProgress(token, data.elapsedSeconds, data.totalSeconds);
    case 'getMedProgress':           return getMedProgress(token);
    case 'registrarCheckinWeb':      return registrarCheckinWeb(token);
    case 'reiniciarDesafio':         return reiniciarDesafio(token);
    case 'getAudioBase64':           return getAudioBase64(token, data.fileId);
    case 'getTextFileContent':       return getTextFileContent(token, data.url);
    case 'getMeditacaoConfig':       return getMeditacaoConfig(token);
    case 'saveMeditacaoConfig':      return saveMeditacaoConfig(token, data);

    // Admin — gestão de alunos/compradores
    case 'getCompradoresAdmin':      return getCompradoresAdmin(token);
    case 'getCompradoresDetalhes':   return getCompradoresDetalhes(token, data.email);

    // Workspace config
    case 'getWorkspaceConfig':       return getWorkspaceConfigAuth(token);

    // Áudios 21 Dias
    case 'getAudios21':              return getAudios21(token);
    case 'saveAudio21':              return saveAudio21(token, data);
    case 'saveAllAudios21':          return saveAllAudios21(token, data.audios);

    // Pipeline configurável (armazena etapas como JSON)
    case 'getPipelinesConfig':       return getPipelinesConfig(token);
    case 'savePipelinesConfig':      return savePipelinesConfig(token, data.config);

    // Notificações para alunos
    case 'sendNotification':         return sendNotification(token, data);
    case 'getNotificacoes':          return getNotificacoes(token);
    case 'marcarNotificacaoLida':    return marcarNotificacaoLida(token, data.id);
    case 'getNotificacoesAdmin':     return getNotificacoesAdmin(token);
    case 'deleteNotificacao':        return deleteNotificacao(token, data.id);

    // Reabertura de acesso (público — sem token)
    case 'reaberturaAccess':         return reaberturaAccess(data.email);

    // Trial gratuito (público — sem token)
    case 'registrarTrial':           return registrarTrial_(data);
    case 'salvarLeadIncompleto':     return salvarLeadIncompleto_(data);
    case 'trackVsl':                 return trackVsl_(data);

    // Eventos (CRUD)
    case 'getEventoBySlug':          return getEventoBySlug(data.slug);
    case 'trackPageEvent':           return trackPageEvent(data);
    case 'getEventosAtivos':         return getEventosAtivos(token);
    case 'getEventos':               return getEventos(token);
    case 'createEvento':             return createEvento(token, data);
    case 'updateEvento':             return updateEvento(token, data.id, data.updates);
    case 'deleteEvento':             return deleteEvento(token, data.id);
    case 'initEventosAction':        return initEventosAction(token);

    // Comunidade — Feed Social + Grupo Chat
    case 'getComunidadeFeed':    return getComunidadeFeed(token, data.page, data.limit);
    case 'criarPost':            return criarPost(token, data.type, data.content, data.mediaBase64, data.mediaType, data.bgStyle);
    case 'toggleLikePost':       return toggleLikePost(token, data.postId);
    case 'criarComentario':      return criarComentario(token, data.postId, data.content);
    case 'getPostComentarios':   return getPostComentarios(token, data.postId);
    case 'getGrupoMensagens':    return getGrupoMensagens(token, data.afterId);
    case 'enviarMensagemGrupo':  return enviarMensagemGrupo(token, data.content);

    // Ingressos — Check-in do Seminário (público — sem token)
    case 'verificarIngresso':    return verificarIngressoUUID_(data.uuid, data.staff);

    // Assinaturas — Ciclo de vida Cakto ↔ App
    case 'getAssinaturaInfo':         return getAssinaturaInfo(token);
    case 'getAssinaturaDetalhe':      return getAssinaturaDetalhe(token);
    case 'cancelarAssinatura':        return cancelarAssinatura(token);
    case 'getStripePortal':           return getStripePortal(token);
    case 'criarCheckoutStripe':       return criarCheckoutStripe(data);
    case 'getAssinaturaHub':          return getAssinaturaHub(token);
    case 'iniciarMigracaoStripe':    return iniciarMigracaoStripe(token, data);

    // DIAGNÓSTICO TEMPORÁRIO (remover depois)
    case 'diagEmailSample': {
      var _al = []; try { _al = GmailApp.getAliases(); } catch(e) {}
      var _para = (data && data.to) || 'ads.deyvid@gmail.com';
      var _diag = _enviarBoasVindasTrial_(_para, 'David Ramon', 'Foco#482', 7);
      return { ok: true, enviadoPara: _para, aliasesDoScript: _al, diag: _diag };
    }
    case 'setupAssinaturaTrigger':    return setupAssinaturaTrigger();
    case 'setupReconciliacaoTrigger': return setupReconciliacaoTrigger();
    case 'rodarReconciliacao':        return rodarReconciliacaoAgora();

    default:
      return { ok: false, error: 'Acao desconhecida: ' + action };
  }
}
