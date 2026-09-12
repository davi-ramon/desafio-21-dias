// ============================================================
// preferencias.gs — Personalização da experiência do aluno (v132)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// Um JSON por aluno, na coluna `Preferencias` da linha dele em
// `compradores`. Quem nunca abriu Configurações tem a coluna
// vazia e recebe exatamente os padrões de hoje — a migração é
// silenciosa e não muda a experiência de ninguém.
//
// A validação é toda no servidor: o front manda o que quiser,
// aqui só entra o que está na lista branca e dentro da faixa.
// ============================================================

function _prefsPadrao_() {
  return {
    meditacao: {
      duracaoMin: 15,      // 5 | 10 | 15 | 20 | 30
      audioId:    '',      // '' = primeiro do catálogo
      frases:     []       // índices escolhidos; [] = todas
    },
    audio: {
      animacoes:  true,    // visualizador/ondas de fundo
      miniPlayer: true     // continua tocando ao navegar
    },
    leitura: {
      metaMin:       15,
      livrosOcultos: []    // ids de livros que somem da biblioteca
    },
    exercicio: {
      metaMin: 15
    },
    perfil: {
      avatarUrl: ''      // vazio = mostra as iniciais
    }
  };
}

var PREF_DURACOES = [5, 10, 15, 20, 30];

function _prefsNum_(v, padrao, permitidos) {
  var n = parseInt(v, 10);
  if (isNaN(n)) return padrao;
  return permitidos.indexOf(n) >= 0 ? n : padrao;
}

function _prefsBool_(v, padrao) {
  if (v === true  || v === 'true'  || v === 1 || v === '1') return true;
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  return padrao;
}

// Lista de strings curtas, sem duplicata e com teto — impede que
// alguém use a coluna como depósito de texto arbitrário.
function _prefsLista_(v, maxItens, maxLen) {
  if (!Array.isArray(v)) return [];
  var vistos = {}, out = [];
  for (var i = 0; i < v.length && out.length < maxItens; i++) {
    var s = String(v[i] == null ? '' : v[i]).trim().slice(0, maxLen);
    if (!s || vistos[s]) continue;
    vistos[s] = true;
    out.push(s);
  }
  return out;
}

function _prefsSanitizar_(entrada) {
  var p = _prefsPadrao_();
  entrada = entrada || {};

  var m = entrada.meditacao || {};
  p.meditacao.duracaoMin = _prefsNum_(m.duracaoMin, 15, PREF_DURACOES);
  p.meditacao.audioId    = String(m.audioId || '').trim().slice(0, 80);
  // Índices do catálogo de frases (0..99), inteiros e únicos
  p.meditacao.frases = (Array.isArray(m.frases) ? m.frases : [])
    .map(function (x) { return parseInt(x, 10); })
    .filter(function (x, i, arr) {
      return !isNaN(x) && x >= 0 && x < 100 && arr.indexOf(x) === i;
    })
    .slice(0, 100);

  var a = entrada.audio || {};
  p.audio.animacoes  = _prefsBool_(a.animacoes,  true);
  p.audio.miniPlayer = _prefsBool_(a.miniPlayer, true);

  var l = entrada.leitura || {};
  p.leitura.metaMin       = _prefsNum_(l.metaMin, 15, PREF_DURACOES);
  p.leitura.livrosOcultos = _prefsLista_(l.livrosOcultos, 30, 60);

  var e = entrada.exercicio || {};
  p.exercicio.metaMin = _prefsNum_(e.metaMin, 15, PREF_DURACOES);

  // Só aceita https do host de imagem do Google — a URL vai parar num
  // <img> do app, então não pode virar porta pra javascript: ou data:
  var pf = entrada.perfil || {};
  var av = String(pf.avatarUrl || '').trim().slice(0, 300);
  p.perfil.avatarUrl = /^https:\/\/(lh3\.googleusercontent\.com|drive\.google\.com)\//i.test(av) ? av : '';

  return p;
}

// ─────────────────────────────────────────────────────────────
// Leitura/escrita na linha do aluno
// ─────────────────────────────────────────────────────────────
function _prefsColuna_(headers) {
  var i = headers.indexOf('Preferencias');
  return i >= 0 ? i : -1;
}

function _prefsLer_(row, headers) {
  var i = _prefsColuna_(headers);
  if (i < 0) return _prefsPadrao_();
  var bruto = String(row[i] || '').trim();
  if (!bruto) return _prefsPadrao_();
  try {
    return _prefsSanitizar_(JSON.parse(bruto));
  } catch (e) {
    // JSON corrompido não pode derrubar o app do aluno
    return _prefsPadrao_();
  }
}

// ROTA: getPreferencias
function getPreferencias(token) {
  var aluno = getAlunoByToken_(token);
  if (!aluno) {
    // Admin em preview não tem linha de comprador — devolve o padrão
    var user = getUserByToken(token);
    if (user && user.role === 'admin') return { ok: true, data: _prefsPadrao_() };
    return { ok: false, error: 'Não autorizado.' };
  }
  return { ok: true, data: _prefsLer_(aluno.row, aluno.headers) };
}

// ROTA: salvarPreferencias
function salvarPreferencias(token, prefs) {
  var aluno = getAlunoByToken_(token);
  if (!aluno) {
    var user = getUserByToken(token);
    if (user && user.role === 'admin') {
      // Preview do admin: aceita e devolve, sem gravar em lugar nenhum
      return { ok: true, data: _prefsSanitizar_(prefs), preview: true };
    }
    return { ok: false, error: 'Não autorizado.' };
  }

  var limpo = _prefsSanitizar_(prefs);
  var aba   = initCompradoresSheet_();          // garante a coluna Preferencias
  var mapa  = ensureCompradoresMetaColumns_(aba);
  var col   = mapa['Preferencias'];
  if (!col) return { ok: false, error: 'Coluna de preferências indisponível.' };

  var alvo = String(aluno.user.email || '').toLowerCase().trim();
  var dados = aba.getDataRange().getValues();
  var iEmail = dados[0].indexOf('Email');
  if (iEmail < 0) return { ok: false, error: 'Aba de compradores sem coluna Email.' };

  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][iEmail] || '').toLowerCase().trim() === alvo) {
      aba.getRange(i + 1, col).setValue(JSON.stringify(limpo));
      try { logAction(alvo, 'PREFS_SALVAS', 'aluno', '', ''); } catch (e) {}
      return { ok: true, data: limpo };
    }
  }
  return { ok: false, error: 'Não encontrei sua linha para salvar.' };
}

// ROTA: restaurarPreferencias — volta tudo ao padrão
function restaurarPreferencias(token) {
  return salvarPreferencias(token, _prefsPadrao_());
}

// ROTA: salvarFotoAluno — reusa o upload do Mural, que já entrega URL
// do lh3.googleusercontent.com (renderiza em <img> de forma confiável;
// o uc?export=view antigo não). A URL fica no mesmo JSON de prefs.
var PREF_FOTO_MAX_BYTES = 3 * 1024 * 1024;   // 3 MB

function salvarFotoAluno(token, base64, mimeType) {
  var aluno = getAlunoByToken_(token);
  if (!aluno) return { ok: false, error: 'Não autorizado.' };

  var b64 = String(base64 || '');
  if (!b64) return { ok: false, error: 'Nenhuma imagem recebida.' };
  // base64 infla ~33%: converte pro tamanho real antes de aceitar
  if ((b64.length * 3) / 4 > PREF_FOTO_MAX_BYTES) {
    return { ok: false, error: 'A imagem passa de 3 MB. Escolha uma menor.' };
  }
  var mime = String(mimeType || '').toLowerCase();
  if (['image/jpeg','image/jpg','image/png','image/webp'].indexOf(mime) < 0) {
    return { ok: false, error: 'Use uma imagem JPG, PNG ou WEBP.' };
  }

  var email = String(aluno.user.email || '').toLowerCase().trim();
  var up;
  try {
    up = _dreamUploadImagem_(b64, mime, 'avatar_' + email.replace(/[^a-z0-9]/g, '_') + '_' + Date.now());
  } catch (e) {
    return { ok: false, error: 'Falha no upload: ' + (e && e.message ? e.message : e) };
  }
  if (!up || !up.url) return { ok: false, error: (up && up.erro) || 'Não consegui salvar a imagem.' };

  // Grava mantendo o resto das preferências intacto
  var atuais = _prefsLer_(aluno.row, aluno.headers);
  atuais.perfil = atuais.perfil || {};
  atuais.perfil.avatarUrl = up.url;
  var res = salvarPreferencias(token, atuais);
  if (!res || !res.ok) return res;

  try { logAction(email, 'FOTO_ATUALIZADA', 'aluno', '', ''); } catch (e) {}
  return { ok: true, url: up.url, data: res.data };
}

// ROTA: removerFotoAluno
function removerFotoAluno(token) {
  var aluno = getAlunoByToken_(token);
  if (!aluno) return { ok: false, error: 'Não autorizado.' };
  var atuais = _prefsLer_(aluno.row, aluno.headers);
  atuais.perfil = atuais.perfil || {};
  atuais.perfil.avatarUrl = '';
  return salvarPreferencias(token, atuais);
}

// ROTA: salvarNomeAluno — o aluno corrige o próprio nome.
// O e-mail NÃO é editável: é a chave da compra.
function salvarNomeAluno(token, nome) {
  var aluno = getAlunoByToken_(token);
  if (!aluno) return { ok: false, error: 'Não autorizado.' };

  var limpo = String(nome || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (limpo.length < 2) return { ok: false, error: 'Digite seu nome.' };
  // Evita que o nome vire fórmula ao cair na planilha
  if (/^[=+\-@]/.test(limpo)) limpo = "'" + limpo;

  var aba   = initCompradoresSheet_();
  var dados = aba.getDataRange().getValues();
  var iEmail = dados[0].indexOf('Email');
  var iNome  = dados[0].indexOf('Nome');
  if (iEmail < 0 || iNome < 0) return { ok: false, error: 'Planilha sem as colunas esperadas.' };

  var alvo = String(aluno.user.email || '').toLowerCase().trim();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][iEmail] || '').toLowerCase().trim() === alvo) {
      aba.getRange(i + 1, iNome + 1).setValue(limpo);
      try { logAction(alvo, 'NOME_ATUALIZADO', 'aluno', '', limpo); } catch (e) {}
      return { ok: true, nome: limpo };
    }
  }
  return { ok: false, error: 'Não encontrei sua linha.' };
}
