// ============================================================
// avaliacoes.gs — Avaliações da "loja" (página estilo Play Store)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// A leitura é PÚBLICA (a página da loja é aberta), mas NENHUM dado
// pessoal sai daqui: só o primeiro nome + a inicial do sobrenome,
// como numa loja de apps de verdade.
//
// Escrever exige três coisas, checadas no servidor — nunca dá para
// confiar no cliente para isso:
//   1. estar logado (token de sessão válido)
//   2. ser aluno com acesso (linha em compradores)
//   3. ter pelo menos 7 dias de jornada (dia >= 7 pela data de início)
// É a regra que o Davi pediu: só quem instalou e usou 7 dias avalia.
// ============================================================

var AV_ABA = 'avaliacoes';
var AV_CAB = ['id', 'email', 'nome_curto', 'nota', 'texto', 'foto_url',
              'plataforma', 'dia_no_envio', 'criado_em', 'atualizado_em',
              'resposta', 'resposta_em', 'visivel', 'uteis'];
var AV_DIAS_MIN   = 7;          // jornada mínima para poder avaliar
var AV_TEXTO_MAX  = 1000;
var AV_FOTO_MAX   = 3 * 1024 * 1024;

function _avAba_() {
  var ss = getSpreadsheet_();
  var aba = ss.getSheetByName(AV_ABA);
  if (!aba) {
    aba = ss.insertSheet(AV_ABA);
    aba.appendRow(AV_CAB);
    aba.getRange(1, 1, 1, AV_CAB.length)
       .setFontWeight('bold').setBackground('#0f1412').setFontColor('#4caf50');
    aba.setFrozenRows(1);
  }
  return aba;
}

function _avNorm_(e) { return String(e || '').toLowerCase().trim(); }

// "Ricardo N." — nunca o nome inteiro nem o e-mail numa página pública.
function _avNomeCurto_(nome, email) {
  var n = String(nome || '').replace(/\s+/g, ' ').trim();
  if (!n) {
    var base = String(email || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
    n = base || 'Aluno';
  }
  var partes = n.split(' ');
  if (partes.length === 1) return partes[0];
  return partes[0] + ' ' + partes[partes.length - 1].charAt(0).toUpperCase() + '.';
}

function _avTexto_(v, max) {
  // Neutraliza fórmula (=, +, -, @ no início viram texto na planilha) e corta.
  var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || AV_TEXTO_MAX);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function _avNota_(v) {
  var n = parseInt(v, 10);
  return (n >= 1 && n <= 5) ? n : 0;
}

// Tempo relativo em português, sem depender de biblioteca.
function _avQuando_(iso) {
  try {
    var t = new Date(iso).getTime();
    if (!t) return '';
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'agora há pouco';
    var m = Math.floor(s / 60); if (m < 60) return 'há ' + m + ' min';
    var h = Math.floor(m / 60); if (h < 24) return 'há ' + h + (h === 1 ? ' hora' : ' horas');
    var d = Math.floor(h / 24); if (d < 7) return 'há ' + d + (d === 1 ? ' dia' : ' dias');
    var sem = Math.floor(d / 7); if (sem < 5) return 'há ' + sem + (sem === 1 ? ' semana' : ' semanas');
    var me = Math.floor(d / 30); if (me < 12) return 'há ' + me + (me === 1 ? ' mês' : ' meses');
    var a = Math.floor(d / 365); return 'há ' + a + (a === 1 ? ' ano' : ' anos');
  } catch (e) { return ''; }
}

function _avLinhaParaObj_(linha, cab) {
  var o = {};
  cab.forEach(function (h, i) { o[h] = linha[i]; });
  return o;
}

// Jornada da pessoa em dias, pela mesma conta da tela do aluno.
function _avDiaDoAluno_(aluno) {
  try {
    var json = _getPilaresJson_(aluno.row, aluno.headers);
    var info = _calcDiaAtualFromInicio_(json, aluno.row);
    return Math.max(1, Number(info.dia) || 1);
  } catch (e) { return 1; }
}

// ─────────────────────────────────────────────────────────────
// ROTA (auth): podeAvaliar — o cliente pergunta ANTES de mostrar o form
// ─────────────────────────────────────────────────────────────
function podeAvaliar(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: true, pode: false, motivo: 'login' };
  if (user.role === 'admin') return { ok: true, pode: false, motivo: 'admin', ehAdmin: true };

  var aluno = getAlunoByToken_(token);
  if (!aluno) return { ok: true, pode: false, motivo: 'sem_acesso' };

  var dia = _avDiaDoAluno_(aluno);
  if (dia < AV_DIAS_MIN) {
    return { ok: true, pode: false, motivo: 'jornada_curta', dia: dia, faltam: AV_DIAS_MIN - dia };
  }

  // Já avaliou? Devolve a própria avaliação para o form vir preenchido.
  var minha = null;
  var email = _avNorm_(user.email);
  var aba = _avAba_();
  if (aba.getLastRow() > 1) {
    var d = aba.getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      if (_avNorm_(d[i][1]) === email) {
        var o = _avLinhaParaObj_(d[i], AV_CAB);
        minha = { nota: Number(o.nota) || 0, texto: String(o.texto || ''), fotoUrl: String(o.foto_url || '') };
        break;
      }
    }
  }
  return { ok: true, pode: true, dia: dia, jaAvaliou: !!minha, minha: minha };
}

// ─────────────────────────────────────────────────────────────
// ROTA (auth): salvarAvaliacao — cria ou atualiza (1 por pessoa)
// ─────────────────────────────────────────────────────────────
function salvarAvaliacao(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Faça login para avaliar.' };
  var aluno = getAlunoByToken_(token);
  if (!aluno) return { ok: false, error: 'Só quem tem acesso ao app pode avaliar.' };

  var dia = _avDiaDoAluno_(aluno);
  if (dia < AV_DIAS_MIN) {
    return { ok: false, error: 'A avaliação abre no 7º dia de jornada. Faltam ' +
             (AV_DIAS_MIN - dia) + ' dia(s).' };
  }

  var d = data || {};
  var nota = _avNota_(d.nota);
  if (!nota) return { ok: false, error: 'Escolha de 1 a 5 estrelas.' };
  var texto = _avTexto_(d.texto, AV_TEXTO_MAX);

  if (typeof _rateLimit_ === 'function' && _rateLimit_('avaliar', user.id, 12, 3600)) {
    return { ok: false, error: 'Muitas alterações seguidas. Aguarde alguns minutos.' };
  }

  var email = _avNorm_(user.email);
  var nomeCurto = _avNomeCurto_(user.name, email);

  // Foto opcional. Só sobe se veio uma nova; senão preserva a existente.
  var fotoUrl = '';
  var temFotoNova = false;
  if (d.fotoBase64) {
    var b64 = String(d.fotoBase64);
    if ((b64.length * 3) / 4 > AV_FOTO_MAX) return { ok: false, error: 'A foto passa de 3 MB.' };
    var mime = String(d.fotoMime || 'image/jpeg').toLowerCase();
    if (['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].indexOf(mime) < 0) {
      return { ok: false, error: 'Use uma foto JPG, PNG ou WEBP.' };
    }
    var up;
    try { up = _dreamUploadImagem_(b64, mime, 'aval_' + email.replace(/[^a-z0-9]/g, '_') + '_' + Date.now()); }
    catch (e) { return { ok: false, error: 'Falha ao enviar a foto: ' + (e && e.message ? e.message : e) }; }
    if (!up || !up.url) return { ok: false, error: (up && up.erro) || 'Não consegui salvar a foto.' };
    fotoUrl = up.url;
    temFotoNova = true;
  }

  var aba = _avAba_();
  var plataforma = _avTexto_(d.plataforma, 20);
  var agora = nowISO();
  var linhas = aba.getDataRange().getValues();

  for (var i = 1; i < linhas.length; i++) {
    if (_avNorm_(linhas[i][1]) !== email) continue;
    // Atualiza a própria avaliação. Editar NÃO reabre a resposta do admin,
    // mas registra que o texto mudou depois — o admin pode reavaliar.
    aba.getRange(i + 1, 4).setValue(nota);
    aba.getRange(i + 1, 5).setValue(texto);
    if (temFotoNova) aba.getRange(i + 1, 6).setValue(fotoUrl);
    if (d.removerFoto === true) aba.getRange(i + 1, 6).setValue('');
    if (plataforma) aba.getRange(i + 1, 7).setValue(plataforma);
    aba.getRange(i + 1, 10).setValue(agora);
    logAction(email, 'AVALIACAO_EDITADA', 'avaliacao', String(linhas[i][0]), 'nota=' + nota);
    return { ok: true, atualizada: true };
  }

  var id = generateId();
  aba.appendRow([id, email, nomeCurto, nota, texto, fotoUrl, plataforma, dia,
                 agora, agora, '', '', true, 0]);
  logAction(email, 'AVALIACAO_CRIADA', 'avaliacao', id, 'nota=' + nota);
  return { ok: true, criada: true };
}

// ─────────────────────────────────────────────────────────────
// ROTA PÚBLICA: getAvaliacoesPublicas — a loja lê daqui
// ------------------------------------------------------------
// 5 min de cache: a página da loja pode ser aberta por muita gente e
// isto não muda a cada segundo. Nunca devolve e-mail.
// ─────────────────────────────────────────────────────────────
function getAvaliacoesPublicas(data) {
  var d = data || {};
  var limite = Math.max(1, Math.min(50, parseInt(d.limite, 10) || 20));
  var offset = Math.max(0, parseInt(d.offset, 10) || 0);
  var ordenar = (d.ordenar === 'uteis' || d.ordenar === 'nota') ? d.ordenar : 'recentes';

  var cacheKey = 'av_pub_' + ordenar;
  var resumo = null, todas = null;
  try {
    var c = CacheService.getScriptCache().get(cacheKey);
    if (c) { var parsed = JSON.parse(c); resumo = parsed.resumo; todas = parsed.lista; }
  } catch (e) {}

  if (!todas) {
    var aba = _avAba_();
    todas = [];
    var dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, soma = 0, n = 0;
    if (aba.getLastRow() > 1) {
      var linhas = aba.getDataRange().getValues();
      for (var i = 1; i < linhas.length; i++) {
        var o = _avLinhaParaObj_(linhas[i], AV_CAB);
        if (o.visivel === false || o.visivel === 'FALSE') continue;
        var nota = Number(o.nota) || 0;
        if (!nota) continue;
        dist[nota] = (dist[nota] || 0) + 1; soma += nota; n++;
        todas.push({
          nota: nota,
          texto: String(o.texto || ''),
          nome: String(o.nome_curto || 'Aluno'),
          fotoUrl: String(o.foto_url || ''),
          plataforma: String(o.plataforma || ''),
          dia: Number(o.dia_no_envio) || 0,
          quando: _avQuando_(o.criado_em),
          _ts: (function () { try { return new Date(o.criado_em).getTime() || 0; } catch (e) { return 0; } })(),
          uteis: Number(o.uteis) || 0,
          resposta: String(o.resposta || ''),
          respostaQuando: o.resposta ? _avQuando_(o.resposta_em) : ''
        });
      }
    }
    if (ordenar === 'uteis')      todas.sort(function (a, b) { return b.uteis - a.uteis || b._ts - a._ts; });
    else if (ordenar === 'nota')  todas.sort(function (a, b) { return b.nota - a.nota || b._ts - a._ts; });
    else                          todas.sort(function (a, b) { return b._ts - a._ts; });
    todas.forEach(function (x) { delete x._ts; });

    resumo = {
      media: n ? Math.round((soma / n) * 10) / 10 : 0,
      total: n,
      distribuicao: dist
    };
    try { CacheService.getScriptCache().put(cacheKey, JSON.stringify({ resumo: resumo, lista: todas }), 300); } catch (e) {}
  }

  return { ok: true, data: {
    resumo: resumo,
    avaliacoes: todas.slice(offset, offset + limite),
    temMais: offset + limite < todas.length
  } };
}

// ═════════════════════════════════════════════════════════════
// ADMIN — responder e moderar
// ═════════════════════════════════════════════════════════════
function _avLimparCache_() {
  try {
    var c = CacheService.getScriptCache();
    c.remove('av_pub_recentes'); c.remove('av_pub_uteis'); c.remove('av_pub_nota');
  } catch (e) {}
}

function getAvaliacoesAdmin(token) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };

  var aba = _avAba_();
  var out = [], soma = 0, n = 0, semResposta = 0, ocultas = 0;
  if (aba.getLastRow() > 1) {
    var linhas = aba.getDataRange().getValues();
    for (var i = 1; i < linhas.length; i++) {
      var o = _avLinhaParaObj_(linhas[i], AV_CAB);
      var nota = Number(o.nota) || 0;
      var visivel = !(o.visivel === false || o.visivel === 'FALSE');
      if (visivel && nota) { soma += nota; n++; }
      if (!visivel) ocultas++;
      if (visivel && !o.resposta) semResposta++;
      out.push({
        id: String(o.id || ''),
        nome: String(o.nome_curto || ''),
        emailParcial: _avEmailParcial_(o.email),
        nota: nota,
        texto: String(o.texto || ''),
        fotoUrl: String(o.foto_url || ''),
        plataforma: String(o.plataforma || ''),
        dia: Number(o.dia_no_envio) || 0,
        quando: _avQuando_(o.criado_em),
        resposta: String(o.resposta || ''),
        visivel: visivel
      });
    }
  }
  out.reverse();   // mais recentes primeiro
  return { ok: true, data: {
    avaliacoes: out,
    media: n ? Math.round((soma / n) * 10) / 10 : 0,
    total: n, semResposta: semResposta, ocultas: ocultas
  } };
}

function _avEmailParcial_(email) {
  var e = String(email || '');
  var p = e.split('@');
  if (p.length !== 2) return e;
  var u = p[0];
  var vis = u.length <= 2 ? u : u.slice(0, 2) + '***';
  return vis + '@' + p[1];
}

function responderAvaliacao(token, data) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };
  var d = data || {};
  var id = String(d.id || '').trim();
  if (!id) return { ok: false, error: 'Avaliacao nao informada.' };
  var resposta = _avTexto_(d.resposta, AV_TEXTO_MAX);

  var aba = _avAba_();
  if (aba.getLastRow() < 2) return { ok: false, error: 'Avaliacao nao encontrada.' };
  var linhas = aba.getDataRange().getValues();
  for (var i = 1; i < linhas.length; i++) {
    if (String(linhas[i][0]) !== id) continue;
    aba.getRange(i + 1, 11).setValue(resposta);
    aba.getRange(i + 1, 12).setValue(resposta ? nowISO() : '');
    _avLimparCache_();
    logAction(user.email, resposta ? 'AVALIACAO_RESPONDIDA' : 'AVALIACAO_RESP_LIMPA', 'avaliacao', id, '');
    return { ok: true, message: resposta ? 'Resposta publicada.' : 'Resposta removida.' };
  }
  return { ok: false, error: 'Avaliacao nao encontrada.' };
}

function moderarAvaliacao(token, data) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };
  var d = data || {};
  var id = String(d.id || '').trim();
  if (!id) return { ok: false, error: 'Avaliacao nao informada.' };
  var visivel = d.visivel === true || d.visivel === 'true';

  var aba = _avAba_();
  if (aba.getLastRow() < 2) return { ok: false, error: 'Avaliacao nao encontrada.' };
  var linhas = aba.getDataRange().getValues();
  for (var i = 1; i < linhas.length; i++) {
    if (String(linhas[i][0]) !== id) continue;
    aba.getRange(i + 1, 13).setValue(visivel);
    _avLimparCache_();
    logAction(user.email, visivel ? 'AVALIACAO_MOSTRADA' : 'AVALIACAO_OCULTADA', 'avaliacao', id, '');
    return { ok: true, message: visivel ? 'Avaliacao visivel de novo.' : 'Avaliacao ocultada.' };
  }
  return { ok: false, error: 'Avaliacao nao encontrada.' };
}
