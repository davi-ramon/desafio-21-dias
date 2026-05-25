// ============================================================
// comunidade.gs — Feed Social + Grupo Chat da Comunidade
// ============================================================

const SHEET_COM_POSTS  = 'comunidade_posts';
const SHEET_COM_INTER  = 'comunidade_interacoes';
const SHEET_COM_GRUPO  = 'comunidade_grupo';
const COM_MEDIA_FOLDER = 'Comunidade Media';
const COM_POST_LIMIT   = 3;   // posts/dia
const COM_LIKE_LIMIT   = 3;   // likes/dia
const COM_COMMENT_LIMIT= 3;   // comentários/dia
const COM_MAX_CHARS    = 249; // chars por post/comentário
const COM_MAX_MSG_CHARS= 500; // chars mensagem grupo
const COM_GROUP_COOLDOWN_MS = 10000; // 10s entre msgs do grupo

// ── Helpers ─────────────────────────────────────────────────

function _comToday_() {
  return Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
}

function _comNow_() {
  return new Date().toISOString();
}

function _comUuid_() {
  return Utilities.getUuid();
}

function _comGetUser_(token) {
  const user = getUserByToken(token);
  if (!user) return null;
  return user;
}

// Retorna nome exibível do usuário (de compradores se for aluno)
function _comGetDisplayName_(user) {
  if (!user) return 'Aluno';
  if (user.name && user.name.trim()) return user.name.trim();
  return (user.email || 'Aluno').split('@')[0];
}

// Conta quantos registros o author tem hoje em uma sheet, com filtro por campo
function _comCountToday_(sheet, emailColName, authorEmail, extraColName, extraVal) {
  const today = _comToday_();
  try {
    const data    = sheet.getDataRange().getValues();
    if (data.length < 2) return 0;
    const headers = data[0].map(h => String(h || ''));
    const emailIdx  = headers.indexOf(emailColName);
    const dateIdx   = headers.indexOf('created_at');
    const extraIdx  = extraColName ? headers.indexOf(extraColName) : -1;
    if (emailIdx < 0 || dateIdx < 0) return 0;
    let count = 0;
    for (let i = 1; i < data.length; i++) {
      const rowEmail = String(data[i][emailIdx] || '').toLowerCase();
      const rowDate  = String(data[i][dateIdx]  || '').slice(0, 10);
      if (rowEmail !== authorEmail.toLowerCase()) continue;
      if (rowDate  !== today) continue;
      if (extraIdx >= 0 && String(data[i][extraIdx] || '') !== extraVal) continue;
      count++;
    }
    return count;
  } catch(e) { return 0; }
}

// Garante que a pasta "Comunidade Media" existe no Drive; retorna o Folder
function _comGetMediaFolder_() {
  const folders = DriveApp.getFoldersByName(COM_MEDIA_FOLDER);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(COM_MEDIA_FOLDER);
}

// Salva base64 no Drive e retorna URL pública
function _comUploadMedia_(base64, mimeType, filename) {
  try {
    // Remove prefixo data URL caso o frontend envie por engano
    if (base64 && base64.indexOf(',') !== -1) {
      base64 = base64.split(',')[1];
    }
    const bytes   = Utilities.base64Decode(base64);
    const decoded = Utilities.newBlob(bytes, mimeType, filename);
    const folder  = _comGetMediaFolder_();
    const file    = folder.createFile(decoded);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const url = 'https://drive.google.com/uc?export=view&id=' + file.getId();
    console.log('[Comunidade] Mídia salva: ' + url);
    return url;
  } catch(e) {
    console.error('[Comunidade] Falha ao salvar mídia: ' + e.toString());
    return null;
  }
}

// ── Inicializar abas (cria se não existir) ───────────────────
function initComunidadeSheets() {
  // Posts
  var ps = getSheet(SHEET_COM_POSTS);
  if (ps.getLastRow() === 0) {
    ps.appendRow(['id','author_email','author_name','type','content',
                  'media_url','bg_style','likes_count','comments_count','created_at','ativo']);
  }
  // Interacoes
  var is = getSheet(SHEET_COM_INTER);
  if (is.getLastRow() === 0) {
    is.appendRow(['id','type','post_id','author_email','author_name','content','created_at']);
  }
  // Grupo
  var gs = getSheet(SHEET_COM_GRUPO);
  if (gs.getLastRow() === 0) {
    gs.appendRow(['id','author_email','author_name','content','created_at']);
  }
  return { ok: true };
}

// ── getFeed ──────────────────────────────────────────────────
// Retorna posts paginados (mais recente primeiro), com flags liked/commented pelo user
function getComunidadeFeed(token, page, limit) {
  const user = _comGetUser_(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  page  = parseInt(page  || 1);
  limit = parseInt(limit || 10);

  try {
    initComunidadeSheets();
    const postsSheet = getSheet(SHEET_COM_POSTS);
    const interSheet = getSheet(SHEET_COM_INTER);

    const postsData = postsSheet.getDataRange().getValues();
    if (postsData.length < 2) return { ok: true, posts: [], hasMore: false };

    const ph = postsData[0].map(h => String(h || ''));
    var allPosts = [];
    for (let i = 1; i < postsData.length; i++) {
      const obj = {};
      ph.forEach((h, j) => { obj[h] = postsData[i][j]; });
      if (String(obj['ativo']) === 'false') continue;
      allPosts.push(obj);
    }

    // Ordena mais recente primeiro
    allPosts.sort(function(a, b) {
      return new Date(b['created_at']) - new Date(a['created_at']);
    });

    const total   = allPosts.length;
    const offset  = (page - 1) * limit;
    const slice   = allPosts.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    // Likes do user (para saber se ele já curtiu cada post)
    var userLikes = {};
    const interData = interSheet.getDataRange().getValues();
    if (interData.length > 1) {
      const ih = interData[0].map(h => String(h || ''));
      const itypeIdx   = ih.indexOf('type');
      const ipostIdx   = ih.indexOf('post_id');
      const iemailIdx  = ih.indexOf('author_email');
      for (let i = 1; i < interData.length; i++) {
        if (String(interData[i][itypeIdx]) === 'like' &&
            String(interData[i][iemailIdx]).toLowerCase() === user.email.toLowerCase()) {
          userLikes[String(interData[i][ipostIdx])] = true;
        }
      }
    }

    const posts = slice.map(function(p) {
      return {
        id:            String(p['id']            || ''),
        author_email:  String(p['author_email']  || ''),
        author_name:   String(p['author_name']   || ''),
        type:          String(p['type']           || 'text'),
        content:       String(p['content']        || ''),
        media_url:     String(p['media_url']      || ''),
        bg_style:      String(p['bg_style']       || ''),
        likes_count:   parseInt(p['likes_count']  || 0),
        comments_count:parseInt(p['comments_count']||0),
        created_at:    String(p['created_at']     || ''),
        liked_by_me:   !!userLikes[String(p['id'])]
      };
    });

    // Limites restantes do dia
    var postsHoje    = _comCountToday_(postsSheet, 'author_email', user.email, null, null);
    var likesHoje    = _comCountToday_(interSheet, 'author_email', user.email, 'type', 'like');
    var commentsHoje = _comCountToday_(interSheet, 'author_email', user.email, 'type', 'comment');

    return {
      ok: true,
      posts: posts,
      hasMore: hasMore,
      page: page,
      limites: {
        posts_restantes:    Math.max(0, COM_POST_LIMIT    - postsHoje),
        likes_restantes:    Math.max(0, COM_LIKE_LIMIT    - likesHoje),
        comments_restantes: Math.max(0, COM_COMMENT_LIMIT - commentsHoje)
      }
    };
  } catch(e) {
    return { ok: false, error: 'Erro ao carregar feed: ' + e.message };
  }
}

// ── criarPost ────────────────────────────────────────────────
function criarPost(token, type, content, mediaBase64, mediaType, bgStyle) {
  const user = _comGetUser_(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  // Apenas alunos e admins podem postar
  if (user.role !== 'aluno' && user.role !== 'admin') {
    return { ok: false, error: 'Apenas alunos podem postar.' };
  }

  content = String(content || '').trim();
  type    = String(type    || 'text');
  bgStyle = String(bgStyle || '');

  if (!content && !mediaBase64) {
    return { ok: false, error: 'Conteúdo não pode ser vazio.' };
  }
  if (content.length > COM_MAX_CHARS) {
    return { ok: false, error: 'Texto muito longo (máx ' + COM_MAX_CHARS + ' caracteres).' };
  }

  try {
    initComunidadeSheets();
    const postsSheet = getSheet(SHEET_COM_POSTS);

    // Limite diário
    var postsHoje = _comCountToday_(postsSheet, 'author_email', user.email, null, null);
    if (postsHoje >= COM_POST_LIMIT) {
      return { ok: false, error: 'Limite de ' + COM_POST_LIMIT + ' publicações por dia atingido.' };
    }

    // Upload de mídia se enviada
    var mediaUrl = '';
    if (mediaBase64 && mediaType) {
      var ext = mediaType.split('/')[1] || 'jpg';
      var fname = 'post_' + Date.now() + '.' + ext;
      mediaUrl = _comUploadMedia_(mediaBase64, mediaType, fname) || '';
      if (!mediaUrl) return { ok: false, error: 'Erro ao salvar imagem. Tente novamente.' };
    }

    const id          = _comUuid_();
    const authorName  = _comGetDisplayName_(user);
    const now         = _comNow_();

    postsSheet.appendRow([
      id, user.email, authorName, type, content,
      mediaUrl, bgStyle, 0, 0, now, true
    ]);

    logAction(user.email, 'CRIAR_POST', 'comunidade', id, type);

    return { ok: true, postId: id };
  } catch(e) {
    return { ok: false, error: 'Erro ao publicar: ' + e.message };
  }
}

// ── toggleLikePost ───────────────────────────────────────────
function toggleLikePost(token, postId) {
  const user = _comGetUser_(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  postId = String(postId || '');
  if (!postId) return { ok: false, error: 'Post inválido.' };

  try {
    initComunidadeSheets();
    const postsSheet = getSheet(SHEET_COM_POSTS);
    const interSheet = getSheet(SHEET_COM_INTER);

    // Verifica se já curtiu este post
    var interData = interSheet.getDataRange().getValues();
    var ih = interData[0].map(h => String(h || ''));
    var itypeIdx  = ih.indexOf('type');
    var ipostIdx  = ih.indexOf('post_id');
    var iemailIdx = ih.indexOf('author_email');
    var existingRow = -1;

    for (let i = 1; i < interData.length; i++) {
      if (String(interData[i][itypeIdx])  === 'like' &&
          String(interData[i][ipostIdx])  === postId &&
          String(interData[i][iemailIdx]).toLowerCase() === user.email.toLowerCase()) {
        existingRow = i + 1; // 1-based
        break;
      }
    }

    // Encontra o post para atualizar contador
    var postsData = postsSheet.getDataRange().getValues();
    var ph = postsData[0].map(h => String(h || ''));
    var pIdIdx    = ph.indexOf('id');
    var pLikesIdx = ph.indexOf('likes_count');
    var postRowIdx = -1;
    var currentLikes = 0;

    for (let i = 1; i < postsData.length; i++) {
      if (String(postsData[i][pIdIdx]) === postId) {
        postRowIdx   = i + 1;
        currentLikes = parseInt(postsData[i][pLikesIdx] || 0);
        break;
      }
    }
    if (postRowIdx < 0) return { ok: false, error: 'Post não encontrado.' };

    var liked;
    if (existingRow > 0) {
      // Já curtiu → remove like (deleta a linha)
      interSheet.deleteRow(existingRow);
      currentLikes = Math.max(0, currentLikes - 1);
      liked = false;
    } else {
      // Não curtiu → verifica limite diário
      var likesHoje = _comCountToday_(interSheet, 'author_email', user.email, 'type', 'like');
      if (likesHoje >= COM_LIKE_LIMIT) {
        return { ok: false, error: 'Limite de ' + COM_LIKE_LIMIT + ' curtidas por dia atingido.' };
      }
      interSheet.appendRow([_comUuid_(), 'like', postId, user.email,
                             _comGetDisplayName_(user), '', _comNow_()]);
      currentLikes = currentLikes + 1;
      liked = true;
    }

    // Atualiza contador no post
    postsSheet.getRange(postRowIdx, pLikesIdx + 1).setValue(currentLikes);

    return { ok: true, liked: liked, likes_count: currentLikes };
  } catch(e) {
    return { ok: false, error: 'Erro: ' + e.message };
  }
}

// ── criarComentario ──────────────────────────────────────────
function criarComentario(token, postId, content) {
  const user = _comGetUser_(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  postId  = String(postId  || '');
  content = String(content || '').trim();

  if (!postId)   return { ok: false, error: 'Post inválido.' };
  if (!content)  return { ok: false, error: 'Comentário não pode ser vazio.' };
  if (content.length > COM_MAX_CHARS) {
    return { ok: false, error: 'Comentário muito longo (máx ' + COM_MAX_CHARS + ' caracteres).' };
  }

  try {
    initComunidadeSheets();
    const interSheet = getSheet(SHEET_COM_INTER);
    const postsSheet = getSheet(SHEET_COM_POSTS);

    // Limite diário
    var commHoje = _comCountToday_(interSheet, 'author_email', user.email, 'type', 'comment');
    if (commHoje >= COM_COMMENT_LIMIT) {
      return { ok: false, error: 'Limite de ' + COM_COMMENT_LIMIT + ' comentários por dia atingido.' };
    }

    const id = _comUuid_();
    const now = _comNow_();
    const authorName = _comGetDisplayName_(user);
    interSheet.appendRow([id, 'comment', postId, user.email, authorName, content, now]);

    // Atualiza contador no post
    var postsData = postsSheet.getDataRange().getValues();
    var ph = postsData[0].map(h => String(h || ''));
    var pIdIdx    = ph.indexOf('id');
    var pCommIdx  = ph.indexOf('comments_count');
    for (let i = 1; i < postsData.length; i++) {
      if (String(postsData[i][pIdIdx]) === postId) {
        var cur = parseInt(postsData[i][pCommIdx] || 0);
        postsSheet.getRange(i + 1, pCommIdx + 1).setValue(cur + 1);
        break;
      }
    }

    return {
      ok: true,
      comentario: { id, author_email: user.email, author_name: authorName, content, created_at: now }
    };
  } catch(e) {
    return { ok: false, error: 'Erro ao comentar: ' + e.message };
  }
}

// ── getPostComentarios ───────────────────────────────────────
function getPostComentarios(token, postId) {
  const user = _comGetUser_(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  postId = String(postId || '');
  if (!postId) return { ok: false, error: 'Post inválido.' };

  try {
    initComunidadeSheets();
    const interSheet = getSheet(SHEET_COM_INTER);
    const interData  = interSheet.getDataRange().getValues();
    if (interData.length < 2) return { ok: true, comentarios: [] };

    const ih       = interData[0].map(h => String(h || ''));
    var comentarios = [];
    for (let i = 1; i < interData.length; i++) {
      const obj = {};
      ih.forEach((h, j) => { obj[h] = String(interData[i][j] || ''); });
      if (obj['type'] !== 'comment') continue;
      if (obj['post_id'] !== postId)  continue;
      comentarios.push({
        id:           obj['id'],
        author_email: obj['author_email'],
        author_name:  obj['author_name'],
        content:      obj['content'],
        created_at:   obj['created_at']
      });
    }

    // Ordena cronologicamente (mais antigo primeiro)
    comentarios.sort(function(a, b) {
      return new Date(a.created_at) - new Date(b.created_at);
    });

    return { ok: true, comentarios: comentarios };
  } catch(e) {
    return { ok: false, error: 'Erro: ' + e.message };
  }
}

// ── getGrupoMensagens ────────────────────────────────────────
// afterId: ID da última mensagem recebida; retorna apenas novas (null = tudo)
function getGrupoMensagens(token, afterId) {
  const user = _comGetUser_(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  try {
    initComunidadeSheets();
    const gs   = getSheet(SHEET_COM_GRUPO);
    const data = gs.getDataRange().getValues();
    if (data.length < 2) return { ok: true, mensagens: [] };

    const gh = data[0].map(h => String(h || ''));
    var msgs = [];
    var afterFound = !afterId; // se não tem afterId, pega tudo

    for (let i = 1; i < data.length; i++) {
      const obj = {};
      gh.forEach((h, j) => { obj[h] = String(data[i][j] || ''); });
      if (!afterFound) {
        if (obj['id'] === afterId) afterFound = true;
        continue;
      }
      msgs.push({
        id:           obj['id'],
        author_email: obj['author_email'],
        author_name:  obj['author_name'],
        content:      obj['content'],
        created_at:   obj['created_at'],
        is_mine:      obj['author_email'].toLowerCase() === user.email.toLowerCase()
      });
    }

    // Limita a 100 mensagens por carga inicial (sem afterId)
    if (!afterId && msgs.length > 100) msgs = msgs.slice(msgs.length - 100);

    return { ok: true, mensagens: msgs };
  } catch(e) {
    return { ok: false, error: 'Erro: ' + e.message };
  }
}

// ── enviarMensagemGrupo ──────────────────────────────────────
function enviarMensagemGrupo(token, content) {
  const user = _comGetUser_(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  content = String(content || '').trim();
  if (!content) return { ok: false, error: 'Mensagem vazia.' };
  if (content.length > COM_MAX_MSG_CHARS) {
    return { ok: false, error: 'Mensagem muito longa (máx ' + COM_MAX_MSG_CHARS + ' caracteres).' };
  }

  try {
    initComunidadeSheets();
    const gs = getSheet(SHEET_COM_GRUPO);

    // Cooldown: verifica última mensagem do usuário
    const data = gs.getDataRange().getValues();
    if (data.length > 1) {
      const gh = data[0].map(h => String(h || ''));
      const emailIdx = gh.indexOf('author_email');
      const dateIdx  = gh.indexOf('created_at');
      // Percorre do fim para o início
      for (let i = data.length - 1; i >= 1; i--) {
        if (String(data[i][emailIdx]).toLowerCase() === user.email.toLowerCase()) {
          const lastMs = new Date(String(data[i][dateIdx])).getTime();
          if (Date.now() - lastMs < COM_GROUP_COOLDOWN_MS) {
            return { ok: false, error: 'Aguarde alguns segundos antes de enviar outra mensagem.' };
          }
          break;
        }
      }
    }

    const id         = _comUuid_();
    const now        = _comNow_();
    const authorName = _comGetDisplayName_(user);
    gs.appendRow([id, user.email, authorName, content, now]);

    return {
      ok: true,
      mensagem: {
        id, author_email: user.email, author_name: authorName,
        content, created_at: now, is_mine: true
      }
    };
  } catch(e) {
    return { ok: false, error: 'Erro ao enviar: ' + e.message };
  }
}
