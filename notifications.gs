// ============================================================
// notifications.gs — Sistema de Notificações para Alunos
// ============================================================

const SHEET_NOTIFICACOES = 'notificacoes';

function initNotificacoesSheet_() {
  var sheet = getSheet(SHEET_NOTIFICACOES);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['id', 'titulo', 'mensagem', 'tipo', 'criada_em', 'ativo', 'lidos_json']);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#6c47ff').setFontColor('#ffffff');
  }
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

// ── Aluno: listar notificações ativas (com campo lida) ───────
function getNotificacoes(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };

  initNotificacoesSheet_();
  var rows = sheetToObjects(getSheet(SHEET_NOTIFICACOES));

  var result = [];
  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i];
    var ativo = r.ativo === true || String(r.ativo).toLowerCase() === 'true';
    if (!ativo) continue;
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
