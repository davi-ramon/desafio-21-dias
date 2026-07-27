// ============================================================
// dream_board.gs — Mural de Declarações / Quadro dos Sonhos
// Desafio 21 Dias — WPK Tavares  (v107)
// ------------------------------------------------------------
// Mural privado por usuário. Cada item guarda o CONTEXTO do
// desafio no momento da criação (dia, % concluído, pilares) —
// é isso que transforma o mural num registro emocional da
// jornada, não só num quadro de recados.
//
// Aba: dream_board
// Imagens: Google Drive (mesmo padrão da comunidade), pasta
// própria, compartilhadas por link.
// ============================================================

var SHEET_DREAM        = 'dream_board';
var DREAM_MEDIA_FOLDER = 'Mural Declaracoes Media';
var DREAM_MAX_TEXTO    = 125;   // limite de caracteres da declaração
var DREAM_MAX_NOTAS    = 600;
var DREAM_MAX_ITENS    = 300;   // teto por usuário (protege planilha e render)

var _DR_ = {
  ID:        0,   // A
  USER_ID:   1,   // B — e-mail do dono (minúsculo)
  TYPE:      2,   // C — 'texto' | 'imagem'
  TEXT:      3,   // D — declaração (<=125)
  IMAGE_URL: 4,   // E
  NOTES:     5,   // F — observações
  CREATED:   6,   // G — ISO
  DAY:       7,   // H — dia do desafio na criação
  PERCENT:   8,   // I — % concluído na criação
  PILLARS:   9,   // J — pilares feitos naquele dia (CSV)
  BOARD_X:  10,   // K — posição no Quadro dos Sonhos (%)
  BOARD_Y:  11,   // L
  METADATA: 12,   // M — JSON livre p/ evolução futura
};

// ── Estrutura ────────────────────────────────────────────────
function initDreamBoardSheet_() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(SHEET_DREAM);
  if (!sh) {
    sh = ss.insertSheet(SHEET_DREAM);
    var cab = ['id', 'userId', 'type', 'text', 'imageUrl', 'notes', 'createdAt',
               'challengeDay', 'completionPercent', 'completedPillars',
               'boardX', 'boardY', 'metadata'];
    sh.appendRow(cab);
    sh.getRange(1, 1, 1, cab.length)
      .setFontWeight('bold').setBackground('#2e6b31').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ── Upload de imagem (Drive, pasta própria) ──────────────────
function _dreamUploadImagem_(base64, mimeType, filename) {
  try {
    if (base64 && base64.indexOf(',') !== -1) base64 = base64.split(',')[1];
    var bytes  = Utilities.base64Decode(base64);
    var blob   = Utilities.newBlob(bytes, mimeType, filename);
    var pastas = DriveApp.getFoldersByName(DREAM_MEDIA_FOLDER);
    var pasta  = pastas.hasNext() ? pastas.next() : DriveApp.createFolder(DREAM_MEDIA_FOLDER);
    var file   = pasta.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'https://drive.google.com/uc?export=view&id=' + file.getId();
  } catch (e) {
    logAction('system', 'DREAM_UPLOAD_ERRO', 'dream_board', '', e.message);
    return null;
  }
}

// ── Contexto do desafio no momento da criação ────────────────
// Admin (ou quem não tem linha em compradores) grava zeros — não
// quebra, só não tem jornada para registrar.
function _dreamContextoAtual_(token) {
  var ctx = { dia: 0, percent: 0, pilares: '' };
  try {
    var aluno = getAlunoByToken_(token);
    if (!aluno) return ctx;

    var pilaresJson = _getPilaresJson_(aluno.row, aluno.headers);
    var diaInfo     = _calcDiaAtualFromInicio_(pilaresJson, aluno.row);
    var stats       = _calcProgresso_(aluno.row, pilaresJson);
    var doDia       = pilaresJson[String(diaInfo.dia)] || {};

    ctx.dia     = diaInfo.dia || 0;
    ctx.percent = stats.progresso || 0;
    ctx.pilares = PILARES_PADRAO.filter(function (p) { return doDia[p] === true; }).join(',');
  } catch (e) {}
  return ctx;
}

// ── Helpers ──────────────────────────────────────────────────
function _dreamUser_(token) {
  var user = getUserByToken(token);
  if (!user) return null;
  return String(user.email || '').toLowerCase().trim();
}

function _dreamLinha2Obj_(row) {
  return {
    id:                String(row[_DR_.ID] || ''),
    type:              String(row[_DR_.TYPE] || 'texto'),
    text:              String(row[_DR_.TEXT] || ''),
    imageUrl:          String(row[_DR_.IMAGE_URL] || ''),
    notes:             String(row[_DR_.NOTES] || ''),
    createdAt:         String(row[_DR_.CREATED] || ''),
    challengeDay:      parseInt(row[_DR_.DAY]) || 0,
    completionPercent: parseInt(row[_DR_.PERCENT]) || 0,
    completedPillars:  String(row[_DR_.PILLARS] || '').split(',').filter(Boolean),
    boardX:            (row[_DR_.BOARD_X] === '' || row[_DR_.BOARD_X] == null) ? null : Number(row[_DR_.BOARD_X]),
    boardY:            (row[_DR_.BOARD_Y] === '' || row[_DR_.BOARD_Y] == null) ? null : Number(row[_DR_.BOARD_Y]),
  };
}

function _dreamSanitizar_(s, max) {
  var t = String(s == null ? '' : s);
  if (typeof _limparXSS_ === 'function') t = _limparXSS_(t);
  t = t.trim();
  if (max && t.length > max) t = t.substring(0, max);
  return t;
}

// ─────────────────────────────────────────────────────────────
// ROTA: getDreamBoard — todos os itens do usuário (mais novo primeiro)
// ─────────────────────────────────────────────────────────────
function getDreamBoard(token) {
  var email = _dreamUser_(token);
  if (!email) return { ok: false, error: 'Não autorizado.' };

  var sh = initDreamBoardSheet_();
  if (sh.getLastRow() < 2) return { ok: true, data: [] };

  var dados = sh.getDataRange().getValues();
  var itens = [];
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][_DR_.USER_ID] || '').toLowerCase().trim() !== email) continue;
    itens.push(_dreamLinha2Obj_(dados[i]));
  }
  itens.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
  return { ok: true, data: itens };
}

// ─────────────────────────────────────────────────────────────
// ROTA: criarDreamItem
// data: { type:'texto'|'imagem', text, notes, imageBase64, imageType }
// ─────────────────────────────────────────────────────────────
function criarDreamItem(token, data) {
  var email = _dreamUser_(token);
  if (!email) return { ok: false, error: 'Não autorizado.' };
  data = data || {};

  var tipo  = String(data.type || 'texto').toLowerCase();
  if (tipo !== 'texto' && tipo !== 'imagem') tipo = 'texto';

  var texto = _dreamSanitizar_(data.text,  DREAM_MAX_TEXTO);
  var notas = _dreamSanitizar_(data.notes, DREAM_MAX_NOTAS);

  if (String(data.text || '').trim().length > DREAM_MAX_TEXTO) {
    return { ok: false, error: 'A declaração deve ter no máximo ' + DREAM_MAX_TEXTO + ' caracteres.' };
  }
  if (tipo === 'texto' && !texto) {
    return { ok: false, error: 'Escreva sua declaração.' };
  }

  var sh = initDreamBoardSheet_();

  // Teto por usuário
  var meus = 0;
  if (sh.getLastRow() >= 2) {
    var todas = sh.getDataRange().getValues();
    for (var i = 1; i < todas.length; i++) {
      if (String(todas[i][_DR_.USER_ID] || '').toLowerCase().trim() === email) meus++;
    }
  }
  if (meus >= DREAM_MAX_ITENS) {
    return { ok: false, error: 'Seu mural atingiu o limite de ' + DREAM_MAX_ITENS + ' itens. Exclua algum para adicionar outro.' };
  }

  // Imagem (opcional mesmo em item de texto)
  var imageUrl = '';
  if (data.imageBase64 && data.imageType) {
    imageUrl = _dreamUploadImagem_(data.imageBase64, data.imageType,
                 'mural_' + Date.now() + '_' + email.replace(/[^a-z0-9]/g, '')) || '';
    if (!imageUrl) return { ok: false, error: 'Não conseguimos salvar a imagem. Tente novamente.' };
  }
  if (tipo === 'imagem' && !imageUrl) {
    return { ok: false, error: 'Selecione uma imagem.' };
  }

  var ctx = _dreamContextoAtual_(token);
  var id  = generateId();
  var sf  = (typeof _sanitFormula_ === 'function') ? _sanitFormula_ : function (v) { return v; };

  sh.appendRow([
    id, email, tipo, sf(texto), imageUrl, sf(notas), nowISO(),
    ctx.dia, ctx.percent, ctx.pilares,
    '', '', '{}'
  ]);

  logAction(email, 'DREAM_CRIAR', 'dream_board', id, tipo);
  return {
    ok: true,
    data: {
      id: id, type: tipo, text: texto, imageUrl: imageUrl, notes: notas,
      createdAt: nowISO(), challengeDay: ctx.dia, completionPercent: ctx.percent,
      completedPillars: ctx.pilares.split(',').filter(Boolean),
      boardX: null, boardY: null
    }
  };
}

// ─────────────────────────────────────────────────────────────
// ROTA: atualizarDreamItem — edita texto/observações
// ─────────────────────────────────────────────────────────────
function atualizarDreamItem(token, id, updates) {
  var email = _dreamUser_(token);
  if (!email) return { ok: false, error: 'Não autorizado.' };
  updates = updates || {};
  id = String(id || '');

  if (updates.text != null && String(updates.text).trim().length > DREAM_MAX_TEXTO) {
    return { ok: false, error: 'A declaração deve ter no máximo ' + DREAM_MAX_TEXTO + ' caracteres.' };
  }

  var sh    = initDreamBoardSheet_();
  var dados = sh.getDataRange().getValues();
  var sf    = (typeof _sanitFormula_ === 'function') ? _sanitFormula_ : function (v) { return v; };

  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][_DR_.ID]) !== id) continue;
    // Dono confere — ninguém edita mural alheio
    if (String(dados[i][_DR_.USER_ID] || '').toLowerCase().trim() !== email) {
      return { ok: false, error: 'Não autorizado.' };
    }
    if (updates.text != null) {
      sh.getRange(i + 1, _DR_.TEXT + 1).setValue(sf(_dreamSanitizar_(updates.text, DREAM_MAX_TEXTO)));
    }
    if (updates.notes != null) {
      sh.getRange(i + 1, _DR_.NOTES + 1).setValue(sf(_dreamSanitizar_(updates.notes, DREAM_MAX_NOTAS)));
    }
    logAction(email, 'DREAM_EDITAR', 'dream_board', id, '');
    return { ok: true };
  }
  return { ok: false, error: 'Item não encontrado.' };
}

// ─────────────────────────────────────────────────────────────
// ROTA: salvarPosicoesDream — posições do Quadro dos Sonhos.
// Recebe [{id, x, y}] e grava em lote (arrastar salva de uma vez).
// ─────────────────────────────────────────────────────────────
function salvarPosicoesDream(token, posicoes) {
  var email = _dreamUser_(token);
  if (!email) return { ok: false, error: 'Não autorizado.' };
  if (!posicoes || !posicoes.length) return { ok: true, salvos: 0 };

  var sh    = initDreamBoardSheet_();
  var dados = sh.getDataRange().getValues();

  var mapa = {};
  posicoes.forEach(function (p) { if (p && p.id) mapa[String(p.id)] = p; });

  var salvos = 0;
  for (var i = 1; i < dados.length; i++) {
    var id = String(dados[i][_DR_.ID]);
    if (!mapa[id]) continue;
    if (String(dados[i][_DR_.USER_ID] || '').toLowerCase().trim() !== email) continue;
    var x = Math.max(0, Math.min(100, Number(mapa[id].x) || 0));
    var y = Math.max(0, Math.min(100, Number(mapa[id].y) || 0));
    sh.getRange(i + 1, _DR_.BOARD_X + 1, 1, 2).setValues([[x, y]]);
    salvos++;
  }
  return { ok: true, salvos: salvos };
}

// ─────────────────────────────────────────────────────────────
// ROTA: excluirDreamItem
// ─────────────────────────────────────────────────────────────
function excluirDreamItem(token, id) {
  var email = _dreamUser_(token);
  if (!email) return { ok: false, error: 'Não autorizado.' };
  id = String(id || '');

  var sh    = initDreamBoardSheet_();
  var dados = sh.getDataRange().getValues();

  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][_DR_.ID]) !== id) continue;
    if (String(dados[i][_DR_.USER_ID] || '').toLowerCase().trim() !== email) {
      return { ok: false, error: 'Não autorizado.' };
    }
    sh.deleteRow(i + 1);
    logAction(email, 'DREAM_EXCLUIR', 'dream_board', id, '');
    return { ok: true };
  }
  return { ok: false, error: 'Item não encontrado.' };
}
