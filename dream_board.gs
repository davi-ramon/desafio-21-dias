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

// ─────────────────────────────────────────────────────────────
// StorageProvider — camada desacoplada de armazenamento (v122)
// O resto do módulo só conhece _dreamUploadImagem_(). Para trocar
// de provedor, escreva outro _storage*_ e mude DREAM_STORAGE.
// Assinatura do contrato: (base64, mimeType, filename) -> URL | null
// ─────────────────────────────────────────────────────────────
var DREAM_STORAGE = 'drive';   // 'drive' — futuros: 'imgbb', 'supabase', 'r2'

// Retorna { url } em sucesso ou { erro } com a mensagem REAL.
// Antes devolvia null e o motivo morria no log — impossível diagnosticar
// sem acesso à planilha.
function _dreamUploadImagem_(base64, mimeType, filename) {
  var provider = _storageProvider_(DREAM_STORAGE);
  if (!provider) return { erro: 'Provedor de armazenamento inválido: ' + DREAM_STORAGE };

  try {
    if (base64 && base64.indexOf(',') !== -1) base64 = base64.split(',')[1];
    if (!base64) return { erro: 'Imagem vazia.' };
    return provider(base64, mimeType, filename);
  } catch (e) {
    var msg = (e && e.message) ? e.message : String(e);
    logAction('system', 'DREAM_UPLOAD_ERRO', 'dream_board', DREAM_STORAGE, msg);
    return { erro: msg };
  }
}

function _storageProvider_(nome) {
  var mapa = { drive: _storageDrive_ };
  return mapa[nome] || null;
}

// ─────────────────────────────────────────────────────────────
// DIAGNÓSTICO — rode no editor do Apps Script para ver o erro REAL
// do upload sem precisar passar pela interface do app.
// ─────────────────────────────────────────────────────────────
function testarUploadMural() {
  // PNG 1x1 transparente — payload mínimo, isola o problema do tamanho
  var px = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  var r = _dreamUploadImagem_(px, 'image/png', 'teste_mural_' + Date.now());
  Logger.log(JSON.stringify(r, null, 2));

  if (r && r.url) {
    Logger.log('OK — upload funcionou. URL: ' + r.url);
  } else {
    Logger.log('FALHOU. Motivo: ' + ((r && r.erro) || 'desconhecido'));
  }
  return r;
}

// Provider: Google Drive (pasta própria, compartilhada por link)
function _storageDrive_(base64, mimeType, filename) {
  var bytes = Utilities.base64Decode(base64);

  // Extensão coerente com o mime: sem ela o Drive as vezes trata o
  // arquivo como binário genérico e a URL de visualização não renderiza.
  var ext = ({ 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
               'image/webp': '.webp', 'image/gif': '.gif' })[String(mimeType).toLowerCase()] || '.jpg';
  if (filename.indexOf('.') === -1) filename = filename + ext;

  var blob   = Utilities.newBlob(bytes, mimeType, filename);
  var pastas = DriveApp.getFoldersByName(DREAM_MEDIA_FOLDER);
  var pasta  = pastas.hasNext() ? pastas.next() : DriveApp.createFolder(DREAM_MEDIA_FOLDER);
  var file   = pasta.createFile(blob);

  // Compartilhamento pode falhar sozinho (conta com restrição de
  // compartilhamento por link). Isolado para não derrubar o upload e
  // para o erro dizer exatamente o que aconteceu.
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (eShare) {
    return { erro: 'Arquivo salvo, mas a conta não permite compartilhar por link: ' +
                   ((eShare && eShare.message) || eShare) };
  }

  // lh3 é o endpoint de imagem do Google e é mais confiável para
  // renderizar em <img> do que o antigo uc?export=view.
  return { url: 'https://lh3.googleusercontent.com/d/' + file.getId() };
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

// v108: mesmo portão premium dos demais módulos. Admin é isento e
// quem não tem registro de assinatura cai no acesso legado — a regra
// de quem entra fica centralizada em checkAcessoPremium_.
function _dreamBloqueado_(token) {
  try {
    var user = getUserByToken(token);
    if (!user) return { ok: false, error: 'Não autorizado.' };
    if (user.role === 'admin') return null;
    var acesso = checkAcessoPremium_(String(user.email || '').toLowerCase().trim());
    if (acesso && acesso.allowed) return null;
    return { ok: false, error: 'Seu acesso está suspenso. Regularize sua assinatura para usar o Mural.', bloqueado: true };
  } catch (e) { return null; }   // falha no gate não derruba o módulo
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

  var bloq = _dreamBloqueado_(token); if (bloq) return bloq;

  var sh = initDreamBoardSheet_();
  if (sh.getLastRow() < 2) return { ok: true, data: [] };

  var dados = sh.getDataRange().getValues();
  var itens = [];
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][_DR_.USER_ID] || '').toLowerCase().trim() !== email) continue;
    itens.push(_dreamLinha2Obj_(dados[i]));
  }
  itens.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
  return { ok: true, data: itens, config: _dreamConfig_() };
}

// ─────────────────────────────────────────────────────────────
// Config do Mural — vive na aba `config` (chave/valor), editável
// pelo painel administrativo. Sem nada configurado, os padrões
// abaixo mantêm o módulo funcionando exatamente como hoje.
// ─────────────────────────────────────────────────────────────
function _dreamConfig_() {
  function ler(chave, padrao) {
    try {
      var v = getConfig_(chave);
      return (v === '' || v == null) ? padrao : v;
    } catch (e) { return padrao; }
  }
  function num(chave, padrao, min, max) {
    var n = parseFloat(ler(chave, padrao));
    if (isNaN(n)) n = padrao;
    return Math.max(min, Math.min(max, n));
  }
  function bool(chave, padrao) {
    var v = String(ler(chave, padrao ? 'true' : 'false')).toLowerCase();
    return v === 'true' || v === '1' || v === 'sim';
  }

  return {
    musicaUrl:      String(ler('mural_musica_url', '')).trim(),
    musicaAtiva:    bool('mural_musica_ativa', true),
    musicaVolume:   num('mural_musica_volume', 22, 0, 100),   // % quando é o único som
    maxFlutuantes:  num('mural_max_flutuantes', 80, 10, 300),
    glitchAtivo:    bool('mural_glitch_ativo', true),
    particulas:     num('mural_particulas', 34, 0, 120),
    paralaxe:       bool('mural_paralaxe', true)
  };
}

// ─────────────────────────────────────────────────────────────
// ROTA: diagnosticarMusicaMural — responde POR QUE a trilha não toca.
// Lê o que está realmente gravado na aba config e BATE NA URL de
// verdade (status HTTP + content-type), em vez de a gente adivinhar.
// ─────────────────────────────────────────────────────────────
function diagnosticarMusicaMural(token) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };

  var cfg = _dreamConfig_();
  var out = {
    url: cfg.musicaUrl, ativa: cfg.musicaAtiva, volume: cfg.musicaVolume,
    problemas: [], avisos: []
  };

  if (!cfg.musicaUrl) {
    out.problemas.push('Nenhuma URL está gravada (chave mural_musica_url da aba config está vazia). ' +
                       'Se você preencheu o campo, o Salvar não chegou até aqui.');
    out.veredito = 'Não há música configurada.';
    return { ok: true, data: out };
  }

  if (!cfg.musicaAtiva)     out.problemas.push('A música está marcada como INATIVA no painel.');
  if (cfg.musicaVolume === 0) out.problemas.push('O volume está em 0%.');
  // Caminho começando com "/" é servido pelo próprio app — o ideal
  var interna = cfg.musicaUrl.charAt(0) === '/';
  if (!interna && !/^https:\/\//i.test(cfg.musicaUrl)) {
    out.problemas.push('A URL não começa com https:// nem com "/". O app roda em HTTPS e o ' +
                       'navegador bloqueia áudio servido por http://.');
  }

  // ── O engano nº 1, e o mais traiçoeiro: Google Drive ──────────
  // A v129 dava "está tudo certo" aqui, porque o UrlFetch do Apps Script
  // sai autenticado como Google e recebe o MP3 de verdade. O <audio> do
  // aluno vai de outra origem e sem cookie, e leva página HTML, redirect
  // ou bloqueio de rastreamento. Comprovado em campo: HTTP 200 +
  // audio/mpeg no servidor e NotSupportedError no Edge, mesmo arquivo.
  if (/drive\.google\.com|docs\.google\.com|drive\.usercontent\.google\.com/i.test(cfg.musicaUrl)) {
    out.problemas.push('O Google Drive NÃO serve áudio para o navegador do aluno — nem no formato ' +
                       'uc?export=download, nem com o arquivo público. O servidor consegue baixar; ' +
                       'o <audio> não. Use a trilha hospedada no próprio app (botão "Usar a trilha ' +
                       'do app") ou outro host que sirva o arquivo direto.');
  }
  if (/pixabay\.com\/(music|sound-effects)\//i.test(cfg.musicaUrl)) {
    out.problemas.push('Esse é o link da PÁGINA do Pixabay, não do arquivo. Baixe o MP3 e ' +
                       'hospede no app.');
  }
  if (/youtube\.com|youtu\.be|spotify\.com|soundcloud\.com|deezer\./i.test(cfg.musicaUrl)) {
    out.problemas.push('YouTube, Spotify, SoundCloud e Deezer não entregam arquivo de áudio direto. ' +
                       'Não é possível tocar por <audio> — precisa ser um MP3/OGG/M4A hospedado.');
  }

  // Caminho interno: não há o que testar por HTTP, é o próprio Firebase
  if (interna) {
    out.veredito = out.problemas.length
      ? 'Encontrei ' + out.problemas.length + ' problema(s).'
      : 'A trilha é servida pelo próprio app (' + cfg.musicaUrl + '). É a configuração ideal: ' +
        'mesma origem, sem bloqueio de terceiros, com suporte a streaming e cache longo.';
    return { ok: true, data: out };
  }

  // Bate na URL de verdade
  try {
    var resp = UrlFetchApp.fetch(cfg.musicaUrl, { muteHttpExceptions: true, followRedirects: true });
    var code = resp.getResponseCode();
    var hdr  = resp.getAllHeaders() || {};
    var ct   = String(hdr['Content-Type'] || hdr['content-type'] || '');
    var len  = Number(hdr['Content-Length'] || hdr['content-length'] || 0);

    out.httpStatus  = code;
    out.contentType = ct || '(não informado)';
    if (!len) { try { len = resp.getContent().length; } catch (e) {} }
    out.tamanhoKB = len ? Math.round(len / 1024) : 0;

    if (code >= 400) {
      out.problemas.push('O servidor respondeu HTTP ' + code + '. O arquivo não está acessível ' +
                         'publicamente — se for Drive, marque "qualquer pessoa com o link".');
    }
    if (ct && ct.toLowerCase().indexOf('audio') < 0 && ct.toLowerCase().indexOf('octet-stream') < 0) {
      out.problemas.push('A URL devolve "' + ct + '" em vez de áudio. É uma página, não o arquivo.');
    }
    if (out.tamanhoKB && out.tamanhoKB < 20) {
      out.avisos.push('O conteúdo tem só ' + out.tamanhoKB + ' KB — pequeno demais para uma trilha.');
    }
  } catch (e) {
    out.problemas.push('Não consegui acessar a URL: ' + e.message);
  }

  out.veredito = out.problemas.length
    ? 'Encontrei ' + out.problemas.length + ' problema(s) — a lista abaixo diz o que corrigir.'
    : 'O SERVIDOR consegue baixar a URL e ela é áudio. Atenção: isso não garante que o navegador ' +
      'do aluno consiga — hosts que exigem cookie, redirect ou sessão entregam para cá e não para ' +
      'o <audio>. Se não tocar no app, olhe o console do aluno: a partir da v129 o motivo real ' +
      'aparece lá. Hospedar no próprio app elimina essa classe inteira de problema.';

  return { ok: true, data: out };
}

// ─────────────────────────────────────────────────────────────
// ROTA: criarDreamItem
// data: { type:'texto'|'imagem', text, notes, imageBase64, imageType }
// ─────────────────────────────────────────────────────────────
function criarDreamItem(token, data) {
  var email = _dreamUser_(token);
  if (!email) return { ok: false, error: 'Não autorizado.' };
  var bloq = _dreamBloqueado_(token); if (bloq) return bloq;
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
    var up = _dreamUploadImagem_(data.imageBase64, data.imageType,
               'mural_' + Date.now() + '_' + email.replace(/[^a-z0-9]/g, ''));
    if (!up || up.erro || !up.url) {
      // devolve o motivo real em vez de uma mensagem genérica
      return { ok: false, error: 'Falha ao salvar a imagem: ' + ((up && up.erro) || 'motivo desconhecido') };
    }
    imageUrl = up.url;
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
  var bloq = _dreamBloqueado_(token); if (bloq) return bloq;
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
  var bloq = _dreamBloqueado_(token); if (bloq) return bloq;
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
