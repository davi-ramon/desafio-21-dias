// ============================================================
// notifications.gs — Sistema de Notificações para Alunos
// ============================================================

const SHEET_NOTIFICACOES = 'notificacoes';

function initNotificacoesSheet_() {
  var sheet = getSheet(SHEET_NOTIFICACOES);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['id', 'titulo', 'mensagem', 'tipo', 'criada_em', 'ativo', 'lidos_json', 'destinatario']);
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#6c47ff').setFontColor('#ffffff');
    return;
  }
  // v108: migração — a aba nasceu sem destinatário, então TODA notificação
  // era broadcast global. Era por isso que "seu trial vence amanhã" aparecia
  // para todos os alunos. Coluna vazia = broadcast (retrocompatível).
  try {
    var headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0]
                    .map(function (h) { return String(h); });
    if (headers.indexOf('destinatario') === -1) {
      var col = headers.length + 1;
      sheet.getRange(1, col).setValue('destinatario')
        .setFontWeight('bold').setBackground('#6c47ff').setFontColor('#ffffff');
    }
  } catch (e) {}
}

// Cria notificação. destinatario vazio/ausente = todos (broadcast).
function _notifCriar_(titulo, mensagem, tipo, destinatario) {
  initNotificacoesSheet_();
  var sheet   = getSheet(SHEET_NOTIFICACOES);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
                  .map(function (h) { return String(h); });
  var id  = generateId();
  var val = {
    id: id, titulo: titulo, mensagem: mensagem,
    tipo: tipo || 'info', criada_em: nowISO(), ativo: true, lidos_json: '[]',
    destinatario: String(destinatario || '').toLowerCase().trim()
  };
  var linha = headers.map(function (h) { return (val[h] !== undefined) ? val[h] : ''; });
  sheet.appendRow(linha);
  return id;
}

// Já existe notificação com este título para este destinatário nos
// últimos N dias? Evita o mesmo aviso pingando dia após dia.
function _notifJaEnviada_(destinatario, titulo, dias) {
  try {
    initNotificacoesSheet_();
    var rows  = sheetToObjects(getSheet(SHEET_NOTIFICACOES));
    var alvo  = String(destinatario || '').toLowerCase().trim();
    var corte = Date.now() - (parseInt(dias || 3) * 86400000);
    for (var i = rows.length - 1; i >= 0; i--) {
      var r = rows[i];
      if (String(r.destinatario || '').toLowerCase().trim() !== alvo) continue;
      if (String(r.titulo || '') !== String(titulo)) continue;
      if (new Date(r.criada_em).getTime() >= corte) return true;
    }
  } catch (e) {}
  return false;
}

// ── Admin: criar / enviar notificação ────────────────────────
function sendNotification(token, data) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };

  var titulo   = String(data.titulo   || '').trim();
  var mensagem = String(data.mensagem || '').trim();
  if (!titulo || !mensagem) return { ok: false, error: 'Titulo e mensagem obrigatorios.' };

  initNotificacoesSheet_();
  var id = generateId();
  var tipo = (data.tipo && ['info', 'success', 'alerta'].indexOf(data.tipo) >= 0) ? data.tipo : 'info';

  getSheet(SHEET_NOTIFICACOES).appendRow([id, titulo, mensagem, tipo, nowISO(), true, '[]']);
  logAction(user.email, 'SEND_NOTIFICATION', 'notificacao', id, titulo);
  return { ok: true, id: id };
}

// ─────────────────────────────────────────────────────────────
// v108: LIMPEZA — desativa os avisos de trial que foram criados como
// broadcast global (sem destinatário) e por isso apareciam para todos
// os alunos, inclusive quem já pagou. Rode UMA VEZ no editor GAS.
// Não apaga linha: só marca ativo=false, o histórico fica auditável.
// ─────────────────────────────────────────────────────────────
function limparNotificacoesTrialOrfas() {
  initNotificacoesSheet_();
  var sheet   = getSheet(SHEET_NOTIFICACOES);
  var data    = sheet.getDataRange().getValues();
  var headers = data[0].map(function (h) { return String(h); });
  var iTitulo = headers.indexOf('titulo');
  var iAtivo  = headers.indexOf('ativo');
  var iDest   = headers.indexOf('destinatario');
  if (iTitulo < 0 || iAtivo < 0) return { ok: false, error: 'Estrutura inesperada.' };

  var desativadas = 0;
  for (var i = 1; i < data.length; i++) {
    var titulo = String(data[i][iTitulo] || '');
    var dest   = (iDest >= 0) ? String(data[i][iDest] || '').trim() : '';
    var ativo  = data[i][iAtivo] === true || String(data[i][iAtivo]).toLowerCase() === 'true';
    if (!ativo) continue;
    if (dest) continue;                                   // já é pessoal, preserva
    if (titulo.indexOf('trial vence') === -1) continue;    // só os avisos de trial
    sheet.getRange(i + 1, iAtivo + 1).setValue(false);
    desativadas++;
  }
  Logger.log('Notificações de trial órfãs desativadas: ' + desativadas);
  return { ok: true, desativadas: desativadas };
}

// ── Aluno: listar notificações ativas (com campo lida) ───────
function getNotificacoes(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };

  initNotificacoesSheet_();
  var rows = sheetToObjects(getSheet(SHEET_NOTIFICACOES));

  var meuEmail = String(user.email || '').toLowerCase().trim();
  var result = [];
  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i];
    var ativo = r.ativo === true || String(r.ativo).toLowerCase() === 'true';
    if (!ativo) continue;
    // v108: notificação com destinatário é PESSOAL — só o dono vê.
    // Vazio = broadcast (comportamento antigo, preservado).
    var dest = String(r.destinatario || '').toLowerCase().trim();
    if (dest && dest !== meuEmail) continue;
    var lidos = [];
    try { lidos = JSON.parse(String(r.lidos_json || '[]')); } catch(e) {}
    result.push({
      id:        r.id,
      titulo:    r.titulo,
      mensagem:  r.mensagem,
      tipo:      r.tipo || 'info',
      criada_em: r.criada_em,
      lida:      lidos.indexOf(user.email) >= 0
    });
  }
  return { ok: true, data: result };
}

// ── Aluno/Admin: marcar como lida ────────────────────────────
function marcarNotificacaoLida(token, notifId) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };

  var sheet   = getSheet(SHEET_NOTIFICACOES);
  var data    = sheet.getDataRange().getValues();
  if (data.length < 2) return { ok: true }; // sem notifs, nao e erro

  var headers  = data[0].map(function(h) { return String(h); });
  var idIdx    = headers.indexOf('id');
  var lidosIdx = headers.indexOf('lidos_json');

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) !== String(notifId)) continue;
    var lidos = [];
    try { lidos = JSON.parse(String(data[i][lidosIdx] || '[]')); } catch(e) {}
    if (lidos.indexOf(user.email) < 0) {
      lidos.push(user.email);
      sheet.getRange(i + 1, lidosIdx + 1).setValue(JSON.stringify(lidos));
    }
    return { ok: true };
  }
  return { ok: true }; // nao encontrada, sem erro — pode ter sido apagada
}

// ── Admin: listar todas as notificações ─────────────────────
function getNotificacoesAdmin(token) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };

  initNotificacoesSheet_();
  var rows = sheetToObjects(getSheet(SHEET_NOTIFICACOES));

  var result = [];
  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i];
    var lidos = [];
    try { lidos = JSON.parse(String(r.lidos_json || '[]')); } catch(e) {}
    result.push({
      id:         r.id,
      titulo:     r.titulo,
      mensagem:   r.mensagem,
      tipo:       r.tipo || 'info',
      criada_em:  r.criada_em,
      ativo:      r.ativo === true || String(r.ativo).toLowerCase() === 'true',
      totalLidas: lidos.length
    });
  }
  return { ok: true, data: result };
}

// ── Admin: desativar notificação ─────────────────────────────
function deleteNotificacao(token, notifId) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };

  var sheet    = getSheet(SHEET_NOTIFICACOES);
  var data     = sheet.getDataRange().getValues();
  if (data.length < 2) return { ok: false, error: 'Notificacao nao encontrada.' };

  var headers  = data[0].map(function(h) { return String(h); });
  var idIdx    = headers.indexOf('id');
  var ativoIdx = headers.indexOf('ativo');

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(notifId)) {
      sheet.getRange(i + 1, ativoIdx + 1).setValue(false);
      logAction(user.email, 'DELETE_NOTIFICATION', 'notificacao', notifId, '');
      return { ok: true };
    }
  }
  return { ok: false, error: 'Notificacao nao encontrada.' };
}
