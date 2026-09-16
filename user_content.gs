// ============================================================
// user_content.gs — Conteudo privado e reutilizavel do aluno
// Modulos: meditacao, leitura e audio
// ============================================================

var USER_CONTENT_SHEET = 'user_content';
var USER_CONTENT_PROGRESS_SHEET = 'user_content_progress';
var USER_CONTENT_MAX_FILE_BYTES = 5 * 1024 * 1024;
var USER_CONTENT_MAX_COVER_BYTES = 1 * 1024 * 1024;
var USER_CONTENT_HEADERS = [
  'id','userId','module','type','source','sourceUrl','storageUrl','title','author',
  'thumbnail','duration','fileSize','visibility','favorite','randomEnabled',
  'enabled','sortOrder','createdAt','updatedAt','metadata'
];
var USER_CONTENT_PROGRESS_HEADERS = ['userId','contentId','progress','lastPoint','updatedAt'];

// Idempotente: cria as abas e tambem acrescenta colunas futuras sem apagar dados.
function initUserContentSheet_() {
  var sheet = getSheet(USER_CONTENT_SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(USER_CONTENT_HEADERS);
    sheet.getRange(1, 1, 1, USER_CONTENT_HEADERS.length)
      .setFontWeight('bold').setBackground('#2e7d32').setFontColor('#ffffff');
  } else {
    var lastCol = Math.max(1, sheet.getLastColumn());
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
    USER_CONTENT_HEADERS.forEach(function(header) {
      if (headers.indexOf(header) < 0) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
        headers.push(header);
      }
    });
  }

  var progress = getSheet(USER_CONTENT_PROGRESS_SHEET);
  if (progress.getLastRow() === 0) {
    progress.appendRow(USER_CONTENT_PROGRESS_HEADERS);
    progress.getRange(1, 1, 1, USER_CONTENT_PROGRESS_HEADERS.length)
      .setFontWeight('bold').setBackground('#2e7d32').setFontColor('#ffffff');
  }
  return sheet;
}

function initUserContent(token) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };
  initUserContentSheet_();
  return { ok: true };
}

function _ucModule_(value) {
  var module = String(value || '').toLowerCase().trim();
  return ['meditation','reading','audio'].indexOf(module) >= 0 ? module : '';
}

function _ucText_(value, maxLen) {
  var text = String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (typeof _limparXSS_ === 'function') text = _limparXSS_(text);
  text = text.replace(/<[^>]*>/g, '').trim();
  if (maxLen && text.length > maxLen) text = text.slice(0, maxLen).trim();
  return typeof _sanitFormula_ === 'function' ? _sanitFormula_(text) : text;
}

function _ucBool_(value, fallback) {
  if (value === true || value === 1 || String(value).toLowerCase() === 'true') return true;
  if (value === false || value === 0 || String(value).toLowerCase() === 'false') return false;
  return !!fallback;
}

function _ucJson_(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch (_e) { return {}; }
}

function _ucRows_() {
  var sheet = initUserContentSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(String);
  return values.slice(1).map(function(row, index) {
    var item = { _row: index + 2 };
    headers.forEach(function(header, col) { item[header] = row[col]; });
    item.favorite = _ucBool_(item.favorite, false);
    item.randomEnabled = _ucBool_(item.randomEnabled, true);
    item.enabled = _ucBool_(item.enabled, true);
    item.duration = Number(item.duration || 0);
    item.fileSize = Number(item.fileSize || 0);
    item.sortOrder = Number(item.sortOrder || 0);
    item.metadata = _ucJson_(item.metadata);
    return item;
  }).filter(function(item) { return !!item.id; });
}

function _ucFind_(id) {
  var wanted = String(id || '');
  var rows = _ucRows_();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) === wanted) return rows[i];
  }
  return null;
}

function _ucCanRead_(user, item) {
  return !!(user && item && (
    user.role === 'admin' || String(item.userId) === String(user.id) || item.visibility === 'global'
  ));
}

function _ucCanEdit_(user, item) {
  return !!(user && item && (user.role === 'admin' || String(item.userId) === String(user.id)));
}

function _ucProgressMap_(userId, ids) {
  var out = {};
  if (!ids || !ids.length) return out;
  var wanted = {};
  ids.forEach(function(id) { wanted[String(id)] = true; });
  var sheet = getSheet(USER_CONTENT_PROGRESS_SHEET);
  var rows = sheetToObjects(sheet);
  rows.forEach(function(row) {
    if (String(row.userId) === String(userId) && wanted[String(row.contentId)]) {
      out[String(row.contentId)] = {
        progress: Math.max(0, Math.min(100, Number(row.progress || 0))),
        lastPoint: String(row.lastPoint || ''),
        updatedAt: row.updatedAt || ''
      };
    }
  });
  return out;
}

// Remove ids internos do Drive antes de responder ao navegador.
function _ucClientItem_(item, user, progress) {
  var metadata = _ucJson_(item.metadata);
  var cleanMeta = {};
  Object.keys(metadata).forEach(function(key) {
    if (key !== 'fileId' && key !== 'coverFileId' && key !== 'ownerEmail' && key !== 'moderatedBy') cleanMeta[key] = metadata[key];
  });
  if (progress) {
    cleanMeta.progress = progress.progress;
    cleanMeta.lastPoint = progress.lastPoint;
    cleanMeta.progressUpdatedAt = progress.updatedAt;
  }
  var owner = String(item.userId) === String(user && user.id);
  return {
    id: String(item.id),
    userId: owner || (user && user.role === 'admin') ? String(item.userId || '') : '',
    module: String(item.module || ''),
    type: String(item.type || ''),
    source: String(item.source || ''),
    sourceUrl: String(item.sourceUrl || ''),
    storageUrl: item.storageUrl ? 'private://' + String(item.id) : '',
    title: String(item.title || ''),
    author: String(item.author || ''),
    thumbnail: String(item.thumbnail || ''),
    duration: Number(item.duration || 0),
    fileSize: Number(item.fileSize || 0),
    visibility: String(item.visibility || 'private'),
    favorite: !!item.favorite,
    randomEnabled: !!item.randomEnabled,
    enabled: !!item.enabled,
    sortOrder: Number(item.sortOrder || 0),
    createdAt: item.createdAt || '',
    updatedAt: item.updatedAt || '',
    metadata: cleanMeta,
    ownerEmail: user && user.role === 'admin' ? String(metadata.ownerEmail || '') : '',
    isOwner: owner,
    origin: owner ? 'personal' : 'global'
  };
}

function getUserContent(token, module) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  var safeModule = _ucModule_(module);
  if (!safeModule) return { ok: false, error: 'Modulo invalido.' };
  var items = _ucRows_().filter(function(item) {
    return item.module === safeModule && _ucCanRead_(user, item);
  });
  var progress = _ucProgressMap_(user.id, items.map(function(item) { return item.id; }));
  items.sort(function(a, b) {
    return Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.createdAt).localeCompare(String(b.createdAt));
  });
  return {
    ok: true,
    data: items.map(function(item) { return _ucClientItem_(item, user, progress[String(item.id)]); })
  };
}

function getUserContentAdmin(token, filters) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };
  filters = filters || {};
  var module = filters.module ? _ucModule_(filters.module) : '';
  var visibility = String(filters.visibility || '').toLowerCase();
  var items = _ucRows_().filter(function(item) {
    return (!module || item.module === module) && (!visibility || item.visibility === visibility);
  });
  items.sort(function(a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
  return {
    ok: true,
    youtubeEnhancedMetadata: !!PropertiesService.getScriptProperties().getProperty('YOUTUBE_API_KEY'),
    data: items.map(function(item) { return _ucClientItem_(item, user, null); })
  };
}

function _ucYouTubeId_(url) {
  var raw = String(url || '').trim().replace(/&amp;/g, '&');
  if (!/^https:\/\//i.test(raw) || raw.length > 500) return '';
  var allowed = /^https:\/\/(?:www\.|m\.|music\.)?youtube\.com\//i.test(raw) ||
                /^https:\/\/youtu\.be\//i.test(raw) ||
                /^https:\/\/(?:www\.)?youtube-nocookie\.com\//i.test(raw);
  if (!allowed) return '';
  var matches = [
    raw.match(/[?&]v=([A-Za-z0-9_-]{11})(?:[&#]|$)/),
    raw.match(/youtu\.be\/([A-Za-z0-9_-]{11})(?:[?&#/]|$)/i),
    raw.match(/\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})(?:[?&#/]|$)/i)
  ];
  for (var i = 0; i < matches.length; i++) if (matches[i]) return matches[i][1];
  return '';
}

function _ucIsoDuration_(value) {
  var match = String(value || '').match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  return Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 +
         Number(match[3] || 0) * 60 + Number(match[4] || 0);
}

function _ucYouTubeMetadata_(url) {
  var videoId = _ucYouTubeId_(url);
  if (!videoId) throw new Error('Informe uma URL publica valida do YouTube.');
  var cache = CacheService.getScriptCache();
  var apiKey = PropertiesService.getScriptProperties().getProperty('YOUTUBE_API_KEY') || '';
  var cacheKey = 'uc_yt_' + videoId + (apiKey ? '_api' : '_oembed');
  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (_e) {}
  }

  var canonical = 'https://www.youtube.com/watch?v=' + videoId;
  var metadata = {
    videoId: videoId,
    canonicalUrl: canonical,
    title: '', author: '', thumbnail: '', duration: 0,
    description: '', captionsAvailable: false,
    transcriptStatus: 'unavailable', embeddable: true
  };

  var oembedUrl = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(canonical);
  var oembedResp = UrlFetchApp.fetch(oembedUrl, { muteHttpExceptions: true, followRedirects: true });
  if (oembedResp.getResponseCode() < 200 || oembedResp.getResponseCode() >= 300) {
    throw new Error('Video indisponivel, privado ou URL invalida.');
  }
  var oembed = JSON.parse(oembedResp.getContentText() || '{}');
  metadata.title = _ucText_(oembed.title || '', 180);
  metadata.author = _ucText_(oembed.author_name || '', 120);
  metadata.thumbnail = /^https:\/\/i\.ytimg\.com\//i.test(String(oembed.thumbnail_url || ''))
    ? String(oembed.thumbnail_url) : 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg';

  // A chave e opcional. Sem ela o oEmbed ainda valida URL/titulo/canal/capa.
  if (apiKey) {
    var apiUrl = 'https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=' +
      encodeURIComponent(videoId) + '&key=' + encodeURIComponent(apiKey);
    var apiResp = UrlFetchApp.fetch(apiUrl, { muteHttpExceptions: true, followRedirects: true });
    if (apiResp.getResponseCode() >= 200 && apiResp.getResponseCode() < 300) {
      var apiData = JSON.parse(apiResp.getContentText() || '{}');
      if (!apiData.items || !apiData.items.length) throw new Error('Video nao encontrado ou nao publico.');
      var video = apiData.items[0];
      var status = video.status || {};
      if (status.privacyStatus && status.privacyStatus !== 'public') throw new Error('Somente videos publicos sao aceitos.');
      if (status.embeddable === false) throw new Error('Este video nao permite reproducao incorporada.');
      var snippet = video.snippet || {};
      var details = video.contentDetails || {};
      metadata.title = _ucText_(snippet.title || metadata.title, 180);
      metadata.author = _ucText_(snippet.channelTitle || metadata.author, 120);
      metadata.description = _ucText_(snippet.description || '', 3000);
      metadata.duration = _ucIsoDuration_(details.duration);
      metadata.captionsAvailable = String(details.caption) === 'true';
      metadata.transcriptStatus = metadata.captionsAvailable ? 'captions_in_player' : 'unavailable';
      metadata.embeddable = status.embeddable !== false;
      var thumbs = snippet.thumbnails || {};
      var thumb = (thumbs.high || thumbs.medium || thumbs.default || {}).url || '';
      if (/^https:\/\/i\.ytimg\.com\//i.test(String(thumb))) metadata.thumbnail = String(thumb);
    }
  }
  if (!metadata.title) metadata.title = 'Conteudo do YouTube';
  try { cache.put(cacheKey, JSON.stringify(metadata), 21600); } catch (_cacheErr) {}
  return metadata;
}

function previewUserContentUrl(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  data = data || {};
  var module = _ucModule_(data.module);
  if (module !== 'meditation' && module !== 'audio') return { ok: false, error: 'Modulo nao aceita URL.' };
  if (typeof _rateLimit_ === 'function' && _rateLimit_('ucytprev', user.id, 50, 3600)) {
    return { ok: false, error: 'Muitas consultas. Aguarde alguns minutos.' };
  }
  try {
    var meta = _ucYouTubeMetadata_(data.url);
    return { ok: true, data: meta };
  } catch (e) { return { ok: false, error: e.message }; }
}

function _ucNextOrder_(userId, module) {
  var max = 0;
  _ucRows_().forEach(function(item) {
    if (String(item.userId) === String(userId) && item.module === module) max = Math.max(max, Number(item.sortOrder || 0));
  });
  return max + 10;
}

function _ucAppend_(item) {
  var sheet = initUserContentSheet_();
  var metadata = item.metadata || {};
  var row = USER_CONTENT_HEADERS.map(function(header) {
    if (header === 'metadata') return JSON.stringify(metadata);
    return item[header] !== undefined ? item[header] : '';
  });
  sheet.appendRow(row);
}

function createUserContentFromYouTube(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  data = data || {};
  var module = _ucModule_(data.module);
  if (module !== 'meditation' && module !== 'audio') return { ok: false, error: 'Modulo invalido para YouTube.' };
  if (typeof _rateLimit_ === 'function' && _rateLimit_('ucytadd', user.id, 20, 3600)) {
    return { ok: false, error: 'Limite de inclusoes atingido. Tente novamente mais tarde.' };
  }
  try {
    var meta = _ucYouTubeMetadata_(data.url);
    var id = generateId();
    var now = nowISO();
    var item = {
      id: id, userId: user.id, module: module,
      type: module === 'meditation' ? 'ambient_video' : 'motivational_video',
      source: 'youtube', sourceUrl: meta.canonicalUrl, storageUrl: '',
      title: meta.title, author: meta.author, thumbnail: meta.thumbnail,
      duration: meta.duration || 0, fileSize: 0, visibility: 'private',
      favorite: false, randomEnabled: true, enabled: true,
      sortOrder: _ucNextOrder_(user.id, module), createdAt: now, updatedAt: now,
      metadata: {
        videoId: meta.videoId,
        description: meta.description || '',
        channel: meta.author || '',
        captionsAvailable: !!meta.captionsAvailable,
        transcriptStatus: meta.transcriptStatus || 'unavailable',
        ownerEmail: String(user.email || '')
      }
    };
    _ucAppend_(item);
    logAction(user.email, 'CREATE_USER_CONTENT', 'user_content', id, { module: module, source: 'youtube' });
    return { ok: true, data: _ucClientItem_(item, user, null) };
  } catch (e) { return { ok: false, error: e.message }; }
}

function _ucDecodeDataUrl_(value, claimedMime, maxBytes) {
  var raw = String(value || '');
  var match = raw.match(/^data:([^;,]*);base64,([A-Za-z0-9+\/=\r\n]+)$/);
  if (!match) throw new Error('Arquivo invalido. Envie em base64.');
  var declaredMime = String(match[1] || '').toLowerCase().trim();
  var claimed = String(claimedMime || '').toLowerCase().trim();
  var mime = declaredMime || claimed || 'application/octet-stream';
  if (declaredMime && claimed && claimed !== declaredMime) {
    throw new Error('Tipo MIME inconsistente.');
  }
  var bytes;
  try { bytes = Utilities.base64Decode(match[2].replace(/[\r\n]/g, '')); }
  catch (_e) { throw new Error('Arquivo base64 corrompido.'); }
  if (!bytes || !bytes.length) throw new Error('Arquivo vazio.');
  if (bytes.length > maxBytes) throw new Error('Arquivo excede o limite de ' + Math.round(maxBytes / 1024 / 1024) + ' MB.');
  return { bytes: bytes, mime: mime, size: bytes.length };
}

function _ucFileName_(name, fallback, extension) {
  var clean = String(name || fallback || 'arquivo')
    .replace(/^.*[\\\/]/, '').replace(/[^A-Za-z0-9._ -]/g, '_').trim();
  if (!clean) clean = fallback || 'arquivo';
  if (extension && clean.toLowerCase().slice(-(extension.length + 1)) !== '.' + extension) clean += '.' + extension;
  return clean.slice(0, 120);
}

function _ucStartsWith_(bytes, chars) {
  if (bytes.length < chars.length) return false;
  for (var i = 0; i < chars.length; i++) {
    if ((bytes[i] & 255) !== chars.charCodeAt(i)) return false;
  }
  return true;
}

function _ucValidateBook_(decoded, fileName) {
  var ext = String(fileName || '').toLowerCase().split('.').pop();
  if (ext === 'pdf') {
    if (decoded.mime !== 'application/pdf' && decoded.mime !== 'application/octet-stream') throw new Error('MIME de PDF invalido.');
    if (!_ucStartsWith_(decoded.bytes, '%PDF-')) throw new Error('O arquivo nao e um PDF valido.');
    var pdfText = Utilities.newBlob(decoded.bytes).getDataAsString('ISO-8859-1');
    if (/\/(?:JavaScript|JS|Launch|OpenAction|EmbeddedFile|RichMedia)\b/i.test(pdfText)) {
      throw new Error('PDF bloqueado por conter recursos ativos ou anexos.');
    }
    return { type: 'pdf', mime: 'application/pdf' };
  }
  if (ext === 'epub') {
    if (['application/epub+zip','application/zip','application/octet-stream'].indexOf(decoded.mime) < 0) {
      throw new Error('MIME de EPUB invalido.');
    }
    if (!_ucStartsWith_(decoded.bytes, 'PK')) throw new Error('O arquivo nao e um EPUB valido.');
    var blobs;
    try { blobs = Utilities.unzip(Utilities.newBlob(decoded.bytes, 'application/zip', 'book.epub')); }
    catch (_e) { throw new Error('EPUB corrompido ou invalido.'); }
    if (!blobs.length || blobs.length > 500) throw new Error('Estrutura EPUB invalida.');
    var foundMime = false, foundContainer = false, foundPackage = false, expanded = 0;
    blobs.forEach(function(blob) {
      expanded += blob.getBytes().length;
      if (expanded > 25 * 1024 * 1024) throw new Error('EPUB expandido excede o limite de seguranca.');
      var entryName = String(blob.getName()).replace(/\\/g, '/').replace(/^\.\//, '');
      if (!entryName || /^\//.test(entryName) || /(^|\/)\.\.($|\/)/.test(entryName) || /^[A-Za-z]:/.test(entryName)) {
        throw new Error('EPUB contem caminho de arquivo inseguro.');
      }
      if (entryName === 'mimetype') {
        foundMime = blob.getDataAsString().trim() === 'application/epub+zip';
      }
      if (entryName.toLowerCase() === 'meta-inf/container.xml') foundContainer = true;
      if (/\.opf$/i.test(entryName)) foundPackage = true;
      if (/\.(?:xhtml?|html?|svg)$/i.test(entryName)) {
        var markup = blob.getDataAsString();
        if (/<\s*(?:script|iframe|object|embed|form)\b|javascript\s*:|\son[a-z]+\s*=/i.test(markup)) {
          throw new Error('EPUB bloqueado por conter conteudo ativo.');
        }
      }
    });
    if (!foundMime) throw new Error('EPUB sem identificacao valida.');
    if (!foundContainer || !foundPackage) throw new Error('EPUB sem estrutura obrigatoria.');
    return { type: 'epub', mime: 'application/epub+zip' };
  }
  throw new Error('Formato nao permitido. Use PDF ou EPUB.');
}

function _ucValidateCover_(decoded, fileName) {
  var ext = String(fileName || '').toLowerCase().split('.').pop();
  var isPng = decoded.bytes.length > 8 && (decoded.bytes[0] & 255) === 137 && _ucStartsWith_(decoded.bytes.slice(1), 'PNG');
  var isJpeg = decoded.bytes.length > 3 && (decoded.bytes[0] & 255) === 255 && (decoded.bytes[1] & 255) === 216 && (decoded.bytes[2] & 255) === 255;
  var isWebp = decoded.bytes.length > 12 && _ucStartsWith_(decoded.bytes, 'RIFF') &&
    String.fromCharCode(decoded.bytes[8] & 255, decoded.bytes[9] & 255, decoded.bytes[10] & 255, decoded.bytes[11] & 255) === 'WEBP';
  if (isPng && (ext === 'png') && (decoded.mime === 'image/png' || decoded.mime === 'application/octet-stream')) return { mime: 'image/png', ext: 'png' };
  if (isJpeg && (ext === 'jpg' || ext === 'jpeg') && (decoded.mime === 'image/jpeg' || decoded.mime === 'application/octet-stream')) return { mime: 'image/jpeg', ext: 'jpg' };
  if (isWebp && ext === 'webp' && (decoded.mime === 'image/webp' || decoded.mime === 'application/octet-stream')) return { mime: 'image/webp', ext: 'webp' };
  throw new Error('Capa invalida. Use PNG, JPG ou WebP.');
}

function _ucRootFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('USER_CONTENT_ROOT_FOLDER_ID') || '';
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (_e) {}
  }
  var folder = DriveApp.createFolder('Desafio21Dias_User_Content_Private');
  props.setProperty('USER_CONTENT_ROOT_FOLDER_ID', folder.getId());
  return folder;
}

function _ucUserFolder_(userId) {
  var root = _ucRootFolder_();
  var name = 'user_' + String(userId || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  var folders = root.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : root.createFolder(name);
}

function _ucStorageSave_(userId, bytes, mime, name) {
  var blob = Utilities.newBlob(bytes, mime, name);
  return _ucUserFolder_(userId).createFile(blob);
}

function _ucStorageTrash_(fileId) {
  if (!fileId) return;
  try { DriveApp.getFileById(String(fileId)).setTrashed(true); } catch (_e) {}
}

function uploadUserContent(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  data = data || {};
  if (_ucModule_(data.module) !== 'reading') return { ok: false, error: 'Upload disponivel apenas na leitura.' };
  if (typeof _rateLimit_ === 'function' && _rateLimit_('ucupload', user.id, 8, 3600)) {
    return { ok: false, error: 'Limite de 8 uploads por hora atingido.' };
  }
  var file = null, cover = null;
  try {
    var decoded = _ucDecodeDataUrl_(data.fileBase64, data.mimeType, USER_CONTENT_MAX_FILE_BYTES);
    var validated = _ucValidateBook_(decoded, data.fileName);
    var safeName = _ucFileName_(data.fileName, 'livro', validated.type);
    var coverDecoded = null, coverValidated = null, coverName = '';
    if (data.coverBase64) {
      coverDecoded = _ucDecodeDataUrl_(data.coverBase64, data.coverMimeType, USER_CONTENT_MAX_COVER_BYTES);
      coverValidated = _ucValidateCover_(coverDecoded, data.coverName);
      coverName = _ucFileName_(data.coverName, 'capa', coverValidated.ext);
    }

    var title = _ucText_(data.title || safeName.replace(/\.(pdf|epub)$/i, ''), 180);
    if (!title) throw new Error('Informe o titulo do livro.');
    var author = _ucText_(data.author || '', 120);
    file = _ucStorageSave_(user.id, decoded.bytes, validated.mime, safeName);
    if (coverDecoded) cover = _ucStorageSave_(user.id, coverDecoded.bytes, coverValidated.mime, coverName);

    var id = generateId(), now = nowISO();
    var item = {
      id: id, userId: user.id, module: 'reading', type: validated.type,
      source: 'upload', sourceUrl: '', storageUrl: 'drive-private://' + file.getId(),
      title: title, author: author,
      thumbnail: cover ? 'private-cover://' + id : '', duration: 0,
      fileSize: decoded.size, visibility: 'private', favorite: false,
      randomEnabled: true, enabled: true, sortOrder: _ucNextOrder_(user.id, 'reading'),
      createdAt: now, updatedAt: now,
      metadata: {
        fileId: file.getId(), coverFileId: cover ? cover.getId() : '',
        mimeType: validated.mime, originalFileName: safeName,
        ownerEmail: String(user.email || '')
      }
    };
    _ucAppend_(item);
    logAction(user.email, 'UPLOAD_USER_CONTENT', 'user_content', id, { module: 'reading', type: validated.type, size: decoded.size });
    return { ok: true, data: _ucClientItem_(item, user, null) };
  } catch (e) {
    if (file) _ucStorageTrash_(file.getId());
    if (cover) _ucStorageTrash_(cover.getId());
    return { ok: false, error: e.message };
  }
}

function _ucReadAsset_(token, id, kind) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  var item = _ucFind_(id);
  if (!item || !_ucCanRead_(user, item)) return { ok: false, error: 'Conteudo nao encontrado.' };
  var metadata = _ucJson_(item.metadata);
  var fileId = kind === 'cover' ? metadata.coverFileId : metadata.fileId;
  if (!fileId) return { ok: false, error: kind === 'cover' ? 'Capa nao disponivel.' : 'Arquivo nao disponivel.' };
  if (typeof _rateLimit_ === 'function' && _rateLimit_('ucasset', user.id, 80, 300)) {
    return { ok: false, error: 'Muitas transferencias. Aguarde alguns minutos.' };
  }
  try {
    var file = DriveApp.getFileById(String(fileId));
    var blob = file.getBlob();
    var bytes = blob.getBytes();
    var max = kind === 'cover' ? USER_CONTENT_MAX_COVER_BYTES : USER_CONTENT_MAX_FILE_BYTES;
    if (bytes.length > max) return { ok: false, error: 'Arquivo excede o limite permitido.' };
    var mime = blob.getContentType() || metadata.mimeType || 'application/octet-stream';
    return {
      ok: true,
      data: 'data:' + mime + ';base64,' + Utilities.base64Encode(bytes),
      mimeType: mime, name: file.getName(), size: bytes.length
    };
  } catch (_e) { return { ok: false, error: 'Arquivo privado indisponivel.' }; }
}

function getUserContentFile(token, id) { return _ucReadAsset_(token, id, 'file'); }
function getUserContentCover(token, id) { return _ucReadAsset_(token, id, 'cover'); }

function _ucHeaderMap_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var map = {};
  headers.forEach(function(header, index) { map[header] = index + 1; });
  return map;
}

function updateUserContent(token, id, updates) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  var item = _ucFind_(id);
  if (!item || !_ucCanEdit_(user, item)) return { ok: false, error: 'Conteudo nao encontrado.' };
  if (item.visibility === 'global' && user.role !== 'admin') return { ok: false, error: 'Conteudo global so pode ser alterado por admin.' };
  updates = updates || {};
  var values = {};
  if (updates.title !== undefined) {
    values.title = _ucText_(updates.title, 180);
    if (!values.title) return { ok: false, error: 'Titulo obrigatorio.' };
  }
  if (updates.author !== undefined) values.author = _ucText_(updates.author, 120);
  ['favorite','randomEnabled','enabled'].forEach(function(key) {
    if (updates[key] !== undefined) values[key] = _ucBool_(updates[key], false);
  });
  if (updates.sortOrder !== undefined) values.sortOrder = Math.max(0, Math.min(1000000, Number(updates.sortOrder) || 0));
  values.updatedAt = nowISO();
  var sheet = initUserContentSheet_();
  var map = _ucHeaderMap_(sheet);
  Object.keys(values).forEach(function(key) { sheet.getRange(item._row, map[key]).setValue(values[key]); });
  logAction(user.email, 'UPDATE_USER_CONTENT', 'user_content', item.id, Object.keys(values));
  var fresh = _ucFind_(id);
  return { ok: true, data: _ucClientItem_(fresh, user, null) };
}

function reorderUserContent(token, module, ids) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  var safeModule = _ucModule_(module);
  if (!safeModule || !Array.isArray(ids) || ids.length > 200) return { ok: false, error: 'Ordem invalida.' };
  var unique = {};
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i] || '');
    if (!id || unique[id]) return { ok: false, error: 'Lista de ordem invalida.' };
    unique[id] = true;
    var item = _ucFind_(id);
    if (!item || item.module !== safeModule || !_ucCanEdit_(user, item) || (item.visibility === 'global' && user.role !== 'admin')) {
      return { ok: false, error: 'Conteudo sem permissao na ordenacao.' };
    }
  }
  var sheet = initUserContentSheet_(), map = _ucHeaderMap_(sheet), now = nowISO();
  ids.forEach(function(id, index) {
    var item = _ucFind_(id);
    sheet.getRange(item._row, map.sortOrder).setValue((index + 1) * 10);
    sheet.getRange(item._row, map.updatedAt).setValue(now);
  });
  return { ok: true };
}

function deleteUserContent(token, id) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  var item = _ucFind_(id);
  if (!item || !_ucCanEdit_(user, item)) return { ok: false, error: 'Conteudo nao encontrado.' };
  if (item.visibility === 'global' && user.role !== 'admin') return { ok: false, error: 'Conteudo global so pode ser removido por admin.' };
  var metadata = _ucJson_(item.metadata);
  _ucStorageTrash_(metadata.fileId);
  _ucStorageTrash_(metadata.coverFileId);
  initUserContentSheet_().deleteRow(item._row);

  var progress = getSheet(USER_CONTENT_PROGRESS_SHEET);
  var data = progress.getDataRange().getValues();
  var headers = data.length ? data[0].map(String) : [];
  var contentCol = headers.indexOf('contentId');
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][contentCol]) === String(id)) progress.deleteRow(i + 1);
  }
  logAction(user.email, 'DELETE_USER_CONTENT', 'user_content', id, { module: item.module });
  return { ok: true };
}

function saveUserContentProgress(token, id, progressValue, lastPoint) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Nao autorizado.' };
  var item = _ucFind_(id);
  if (!item || item.module !== 'reading' || !_ucCanRead_(user, item)) return { ok: false, error: 'Livro nao encontrado.' };
  var progress = Math.max(0, Math.min(100, Number(progressValue || 0)));
  var point = _ucText_(lastPoint || '', 4000);
  var sheet = getSheet(USER_CONTENT_PROGRESS_SHEET);
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0].map(String), userCol = headers.indexOf('userId'), contentCol = headers.indexOf('contentId');
  var now = nowISO();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][userCol]) === String(user.id) && String(rows[i][contentCol]) === String(id)) {
      sheet.getRange(i + 1, 1, 1, USER_CONTENT_PROGRESS_HEADERS.length)
        .setValues([[user.id, id, progress, point, now]]);
      return { ok: true };
    }
  }
  sheet.appendRow([user.id, id, progress, point, now]);
  return { ok: true };
}

function setUserContentVisibility(token, id, visibility) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };
  var state = String(visibility || '').toLowerCase();
  if (['private','approved','global'].indexOf(state) < 0) return { ok: false, error: 'Visibilidade invalida.' };
  var item = _ucFind_(id);
  if (!item) return { ok: false, error: 'Conteudo nao encontrado.' };
  var current = String(item.visibility || 'private').toLowerCase();
  var transitions = {
    private: ['private','approved'],
    approved: ['private','approved','global'],
    global: ['approved','global']
  };
  if (!transitions[current] || transitions[current].indexOf(state) < 0) {
    return { ok: false, error: 'Fluxo invalido. Use private → approved → global.' };
  }
  var sheet = initUserContentSheet_(), map = _ucHeaderMap_(sheet), now = nowISO();
  var metadata = _ucJson_(item.metadata);
  metadata.moderatedBy = String(user.id || '');
  metadata.moderatedAt = now;
  sheet.getRange(item._row, map.visibility).setValue(state);
  sheet.getRange(item._row, map.updatedAt).setValue(now);
  sheet.getRange(item._row, map.metadata).setValue(JSON.stringify(metadata));
  logAction(user.email, 'VISIBILITY_USER_CONTENT', 'user_content', id, { from: item.visibility, to: state });
  return { ok: true, visibility: state };
}

function setUserContentYouTubeApiKey(token, apiKey) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };
  var key = String(apiKey || '').trim();
  var props = PropertiesService.getScriptProperties();
  if (!key) {
    props.deleteProperty('YOUTUBE_API_KEY');
    return { ok: true, configured: false };
  }
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(key)) return { ok: false, error: 'Formato de chave invalido.' };
  props.setProperty('YOUTUBE_API_KEY', key);
  return { ok: true, configured: true };
}

function getRandomUserContent(token, module) {
  var result = getUserContent(token, module);
  if (!result.ok) return result;
  var pool = result.data.filter(function(item) { return item.enabled && item.randomEnabled; });
  if (!pool.length) return { ok: true, data: null };
  return { ok: true, data: pool[Math.floor(Math.random() * pool.length)] };
}
