// ============================================================
// aluno_routes.gs — Área do Aluno: Desafio 21 Dias
// Rotas e helpers exclusivos para usuários com role 'aluno'
// ============================================================

const COL_PILARES_JSON = 'PilaresJson';

const PILARES_PADRAO = ['meditacao', 'leitura', 'exercicio', 'audio', 'checkin'];

// ── Helper: busca comprador pelo token do aluno ───────────────
// Retorna null se o usuário não for aluno OU não tiver registro na aba compradores.
// Admins NÃO passam por aqui — use getAlunoData diretamente que trata o role=admin.
function getAlunoByToken_(token) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'aluno') return null;

  const ss  = getSpreadsheet_();
  const aba = ss.getSheetByName(SHEET_COMPRADORES);
  if (!aba || aba.getLastRow() < 2) return null;

  const dados   = aba.getDataRange().getValues();
  const headers = dados[0].map(h => String(h || ''));
  const emailIdx = headers.indexOf('Email');

  for (let i = 1; i < dados.length; i++) {
    const rowEmail = String(dados[i][emailIdx] || '').toLowerCase().trim();
    if (rowEmail === user.email.toLowerCase().trim()) {
      return { user, row: dados[i], rowIndex: i + 1, headers, aba };
    }
  }
  return null;
}

// ── Helper: lê o JSON de pilares da linha do comprador ────────
function _getPilaresJson_(row, headers) {
  const idx = headers.indexOf(COL_PILARES_JSON);
  if (idx < 0) return {};
  try { return JSON.parse(String(row[idx] || '{}')) || {}; } catch(e) { return {}; }
}

// ── Helper: salva o JSON de pilares ──────────────────────────
function _savePilaresJson_(aba, rowIndex, headers, pilaresJson) {
  let idx = headers.indexOf(COL_PILARES_JSON);
  if (idx < 0) {
    const lastCol = aba.getLastColumn() + 1;
    aba.getRange(1, lastCol).setValue(COL_PILARES_JSON);
    idx = lastCol - 1;
  }
  aba.getRange(rowIndex, idx + 1).setValue(JSON.stringify(pilaresJson));
}

// ── Helper: dia atual calculado a partir da data de início ────
// Prioridade: (1) _inicioCiclo em pilaresJson → (2) PAID_AT → (3) DIA_ATUAL
// Sempre retorna dia ∈ [1, 21]
function _calcDiaAtualFromInicio_(pilaresJson, row) {
  const br      = 'America/Sao_Paulo';
  const now     = new Date();
  const todayBR = Utilities.formatDate(now, br, 'yyyy-MM-dd');

  let inicioCiclo = null;

  // 1. _inicioCiclo salvo no JSON dos pilares (após reiniciar ou primeiro ciclo)
  if (pilaresJson && pilaresJson['_inicioCiclo']) {
    inicioCiclo = String(pilaresJson['_inicioCiclo']);
  }

  // 2. Fallback: data de compra (PAID_AT)
  if (!inicioCiclo && row) {
    const paidAt = row[COL_COMP.PAID_AT];
    if (paidAt) {
      try {
        const d = paidAt instanceof Date ? paidAt : new Date(paidAt);
        if (!isNaN(d.getTime())) {
          inicioCiclo = Utilities.formatDate(d, br, 'yyyy-MM-dd');
        }
      } catch(e) {}
    }
  }

  if (inicioCiclo && /^\d{4}-\d{2}-\d{2}$/.test(inicioCiclo)) {
    const [sy, sm, sd] = inicioCiclo.split('-').map(Number);
    const [ty, tm, td] = todayBR.split('-').map(Number);
    // Diferença em dias (ambas as datas tratadas como meia-noite local no script)
    const startMs  = new Date(sy, sm - 1, sd).getTime();
    const todayMs  = new Date(ty, tm - 1, td).getTime();
    const diffDays = Math.floor((todayMs - startMs) / (24 * 60 * 60 * 1000));
    const dia      = Math.min(21, Math.max(1, diffDays + 1));
    return { dia, dataInicio: inicioCiclo };
  }

  // 3. Fallback final: coluna DIA_ATUAL (já cap 21)
  const diaStored = Math.min(21, parseInt(row[COL_COMP.DIA_ATUAL]) || 1);
  return { dia: diaStored, dataInicio: null };
}

// ── Helper: progresso total do aluno ─────────────────────────
function _calcProgresso_(row, pilaresJson) {
  const dia = parseInt(row[COL_COMP.DIA_ATUAL]) || 1;
  let diasConcluidos = 0;

  for (let d = 1; d <= 21; d++) {
    const pDia = pilaresJson[String(d)] || {};
    // Considera dia concluído se marcou ao menos 3 pilares
    const marcados = PILARES_PADRAO.filter(p => pDia[p] === true).length;
    if (marcados >= 3) diasConcluidos++;
    // Também aceita check-in via WhatsApp (colunas D1..D21)
    const wsStatus = String(row[COL_COMP.D1 + (d - 1)] || '').toUpperCase();
    if (wsStatus === 'SIM' && marcados < 3) diasConcluidos++;
  }

  return {
    diasConcluidos,
    progresso: Math.min(100, Math.round((diasConcluidos / 21) * 100)),
    diaAtual: dia
  };
}

// ══════════════════════════════════════════════════════════════
// _getAdminAlunoData_ — dados simulados para admin no painel aluno
// Admin não tem registro em compradores; retorna dados de preview.
// ══════════════════════════════════════════════════════════════
function _getAdminAlunoData_(user) {
  const salaLink      = getConfig_('sala_link')   || '';
  const grupoLink     = getConfig_('grupo_link')  || '';
  const ebookUrl      = getConfig_('pdf_link')    || '';
  const salaJitsiRoom = getConfig_('jitsi_room')  || 'desafio21dias-wpktavares';

  // Busca áudio do dia 1 como preview
  let audioUrlHoje = '', audioCapaHoje = '', audioTituloHoje = 'Áudio do Dia 1';
  try {
    const audioSheet = getSpreadsheet_().getSheetByName('audio_21_dias');
    if (audioSheet && audioSheet.getLastRow() > 1) {
      const aData    = audioSheet.getDataRange().getValues();
      const aHeaders = aData[0].map(h => String(h || ''));
      const diaIdx   = aHeaders.indexOf('dia');
      for (let i = 1; i < aData.length; i++) {
        if (parseInt(aData[i][diaIdx]) === 1) {
          const obj = {}; aHeaders.forEach((h, j) => { obj[h] = aData[i][j]; });
          audioUrlHoje    = String(obj['audio_url'] || '');
          audioCapaHoje   = String(obj['capa_url']  || '');
          audioTituloHoje = String(obj['titulo']    || audioTituloHoje);
          break;
        }
      }
    }
  } catch(ex) {}

  return {
    ok: true,
    data: {
      nome:            user.name  || user.email,
      email:           user.email,
      role:            'admin',
      diaAtual:        1,
      ativo:           true,
      diasConcluidos:  0,
      progresso:       0,
      ultimoCheckin:   '',
      concluido:       false,
      pilaresHoje:     {},
      pilaresJson:     {},
      ebookUrl,
      audiosLink:      '',
      audioUrlHoje,
      audioCapaHoje,
      audioTituloHoje,
      grupoLink,
      salaLink,
      salaJitsiRoom
    }
  };
}

// ══════════════════════════════════════════════════════════════
// getAlunoData — dados principais do aluno
// ══════════════════════════════════════════════════════════════
function getAlunoData(token) {
  const user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  // Admin acessa o painel do aluno em modo preview — sem exigir comprador
  if (user.role === 'admin') return _getAdminAlunoData_(user);

  const aluno = getAlunoByToken_(token);
  if (!aluno) return { ok: false, error: 'Não autorizado ou comprador não encontrado.' };

  const { row, headers } = aluno;
  const pilaresJson  = _getPilaresJson_(row, headers);
  const diaInfo      = _calcDiaAtualFromInicio_(pilaresJson, row);
  const dia          = diaInfo.dia;   // sempre ∈ [1, 21]
  const dataInicio   = diaInfo.dataInicio || '';
  const pilaresHoje  = pilaresJson[String(dia)] || {};
  const stats        = _calcProgresso_(row, pilaresJson);
  const horaAtualBR  = parseInt(Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'H'));

  // Configuraçõess de links
  const salaLink      = getConfig_('sala_link')   || '';
  const audiosLink    = getConfig_('audios_link') || '';
  const grupoLink     = String(row[COL_COMP.GRUPO]  || getConfig_('grupo_link') || '');
  const ebookUrl      = String(row[COL_COMP.EBOOK]  || getConfig_('pdf_link')   || '');
  const salaJitsiRoom = getConfig_('jitsi_room')    || 'desafio21dias-wpktavares';

  // URL + metadados do áudio do dia atual (prioriza aba audio_21_dias)
  // Se não houver áudio para o dia exato, usa o último áudio cadastrado (≤ diaAtual).
  let audioUrlHoje    = '';
  let audioCapaHoje   = '';
  let audioTituloHoje = 'Áudio do Dia ' + dia;
  let audioDescHoje   = '';
  try {
    const audioSheet = getSpreadsheet_().getSheetByName('audio_21_dias');
    if (audioSheet && audioSheet.getLastRow() > 1) {
      const aData    = audioSheet.getDataRange().getValues();
      const aHeaders = aData[0].map(h => String(h || ''));
      const diaIdx   = aHeaders.indexOf('dia');

      // 1ª passagem: áudio exato do dia atual
      for (let i = 1; i < aData.length; i++) {
        if (parseInt(aData[i][diaIdx]) === dia) {
          const obj = {};
          aHeaders.forEach((h, j) => { obj[h] = aData[i][j]; });
          audioUrlHoje    = String(obj['audio_url'] || '');
          audioCapaHoje   = String(obj['capa_url']  || '');
          audioTituloHoje = String(obj['titulo']    || audioTituloHoje);
          audioDescHoje   = String(obj['descricao'] || '');
          break;
        }
      }

      // 2ª passagem: fallback para o áudio mais recente disponível (≤ dia)
      // Evita gerar URL falsa quando o áudio do dia ainda não foi cadastrado.
      if (!audioUrlHoje) {
        let maxDia = 0;
        let fallback = null;
        for (let i = 1; i < aData.length; i++) {
          const obj = {};
          aHeaders.forEach((h, j) => { obj[h] = aData[i][j]; });
          const d   = parseInt(obj['dia']) || 0;
          const url = String(obj['audio_url'] || '');
          if (url && d <= dia && d > maxDia) { maxDia = d; fallback = obj; }
        }
        if (fallback) {
          audioUrlHoje    = String(fallback['audio_url'] || '');
          audioCapaHoje   = String(fallback['capa_url']  || '');
          audioTituloHoje = String(fallback['titulo']    || ('Áudio do Dia ' + maxDia));
          audioDescHoje   = String(fallback['descricao'] || '');
        }
      }
    }
  } catch(ex) {}
  // Fallback final: configuração global (só se ainda não encontrou nada na planilha)
  if (!audioUrlHoje) {
    audioUrlHoje = String(getConfig_('audio_' + dia) || '');
  }

  // Injeta status da assinatura (null = legado sem controle de assinatura)
  var subscriptionInfo = null;
  try { subscriptionInfo = checkAcessoPremium_(aluno.user.email); } catch(ex) {}

  return {
    ok: true,
    data: {
      nome:          String(row[COL_COMP.NOME] || aluno.user.name || ''),
      email:         aluno.user.email,
      role:          aluno.user.role || 'aluno',
      diaAtual:      dia,
      dataInicio:    dataInicio,
      horaAtualBR:   horaAtualBR,
      ativo:         row[COL_COMP.ATIVO] === true,
      diasConcluidos: stats.diasConcluidos,
      progresso:     stats.progresso,
      ultimoCheckin: String(row[COL_COMP.ULT_CHECK] || ''),
      concluido:     row[COL_COMP.ATIVO] === false && String(row[COL_COMP.DIA_CONC] || '') !== '',
      pilaresHoje,
      pilaresJson,
      ebookUrl,
      audiosLink,
      audioUrlHoje:    audioUrlHoje,
      audioCapaHoje:   audioCapaHoje,
      audioTituloHoje: audioTituloHoje,
      audioDescHoje:   audioDescHoje,
      grupoLink,
      salaLink,
      salaJitsiRoom,
      subscription:    subscriptionInfo,   // status de assinatura para controle de acesso no frontend
    }
  };
}

// ══════════════════════════════════════════════════════════════
// marcarPilar — marcar/desmarcar um pilar do dia
// ══════════════════════════════════════════════════════════════
function marcarPilar(token, pilar, valor) {
  const _user = getUserByToken(token);
  if (!_user) return { ok: false, error: 'Não autorizado.' };
  // Admin: simula marcação sem persistir (modo preview)
  if (_user.role === 'admin') return { ok: true, progresso: 0, diasConcluidos: 0 };

  const aluno = getAlunoByToken_(token);
  if (!aluno) return { ok: false, error: 'Não autorizado.' };
  if (!PILARES_PADRAO.includes(String(pilar))) return { ok: false, error: 'Pilar inválido.' };

  const { row, rowIndex, headers, aba } = aluno;
  const pilaresJson = _getPilaresJson_(row, headers);
  // IMPORTANTE: usa dia CALCULADO (mesmo algoritmo de getAlunoData),
  // não o valor armazenado em DIA_ATUAL, que pode estar desatualizado.
  const diaInfo     = _calcDiaAtualFromInicio_(pilaresJson, row);
  const dia         = diaInfo.dia;

  if (!pilaresJson[String(dia)]) pilaresJson[String(dia)] = {};
  pilaresJson[String(dia)][pilar] = valor === true || valor === 'true';

  _savePilaresJson_(aba, rowIndex, headers, pilaresJson);
  logAction(aluno.user.email, 'PILAR_MARCADO', 'aluno', aluno.user.email,
    'D' + dia + '.' + pilar + '=' + String(valor));

  // Recalcula progresso
  const stats = _calcProgresso_(row, pilaresJson);
  return { ok: true, progresso: stats.progresso, diasConcluidos: stats.diasConcluidos };
}

// ══════════════════════════════════════════════════════════════
// registrarCheckinWeb — check-in do dia via web app
// Valida janela horária (04:00–07:59 BR) e mínimo 3/4 pilares
// ══════════════════════════════════════════════════════════════
function registrarCheckinWeb(token) {
  const _user = getUserByToken(token);
  if (!_user) return { ok: false, error: 'Não autorizado.' };
  // Admin: simula check-in sem persistir (modo preview)
  if (_user.role === 'admin') return { ok: true, diaAtual: 1, concluiu: false };

  const aluno = getAlunoByToken_(token);
  if (!aluno) return { ok: false, error: 'Não autorizado.' };

  const { row, rowIndex, headers, aba } = aluno;
  const pilaresJson = _getPilaresJson_(row, headers);

  // Calcula dia atual a partir da data de início (nunca > 21)
  const diaInfo = _calcDiaAtualFromInicio_(pilaresJson, row);
  const dia     = diaInfo.dia;

  // Verifica se o desafio já foi concluído
  if (row[COL_COMP.ATIVO] === false && String(row[COL_COMP.DIA_CONC] || '') !== '') {
    return { ok: false, error: 'Desafio já concluído.' };
  }

  // ── Valida mínimo de 3 pilares concluídos ───────────────────
  // Nota: janela horária removida — check-in disponível 24h por dia
  const pilaresHoje  = pilaresJson[String(dia)] || {};
  const pilaresBase  = ['meditacao', 'leitura', 'exercicio', 'audio'];
  const marcados     = pilaresBase.filter(p => pilaresHoje[p] === true).length;
  if (marcados < 3) {
    return { ok: false, error: 'Você precisa concluir pelo menos 3 dos 4 pilares para fazer o check-in de hoje.' };
  }

  // ── Registra check-in ───────────────────────────────────────
  // Marca checkin no JSON dos pilares
  if (!pilaresJson[String(dia)]) pilaresJson[String(dia)] = {};
  pilaresJson[String(dia)]['checkin'] = true;

  // Marca coluna D{dia} = 'SIM' (compatibilidade com automação WhatsApp)
  const colDia = COL_COMP.D1 + (dia - 1);
  aba.getRange(rowIndex, colDia + 1).setValue('SIM');
  aba.getRange(rowIndex, COL_COMP.ULT_CHECK + 1).setValue(nowISO());

  // Sincroniza DIA_ATUAL (para automação WA e relatórios admin)
  aba.getRange(rowIndex, COL_COMP.DIA_ATUAL + 1).setValue(dia);

  // Salva JSON atualizado
  _savePilaresJson_(aba, rowIndex, headers, pilaresJson);

  // Encerra desafio se for o último dia
  if (dia === 21) {
    aba.getRange(rowIndex, COL_COMP.ATIVO    + 1).setValue(false);
    aba.getRange(rowIndex, COL_COMP.DIA_CONC + 1).setValue(nowISO());
  }

  logAction(aluno.user.email, 'CHECKIN_WEB', 'aluno', aluno.user.email, 'D' + dia + '=SIM pilares=' + marcados);
  return { ok: true, diaAtual: dia, concluiu: dia === 21 };
}

// ══════════════════════════════════════════════════════════════
// getConteudoAluno — conteúdos, áudios, comunidade e eventos
// ══════════════════════════════════════════════════════════════
function getConteudoAluno(token) {
  const user = getUserByToken(token);
  if (!user || (user.role !== 'aluno' && user.role !== 'admin')) return { ok: false, error: 'Não autorizado.' };

  // Lê todas as configs
  const sheet = getSheet(SHEET_CONFIG);
  const data  = sheet.getDataRange().getValues();
  const cfg   = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) cfg[String(data[i][0])] = data[i][1];
  }

  // Monta lista de 21 áudios — prioriza aba audio_21_dias
  let audios = [];
  try {
    const audioSheet = getSpreadsheet_().getSheetByName('audio_21_dias');
    if (audioSheet && audioSheet.getLastRow() > 1) {
      const aData    = audioSheet.getDataRange().getValues();
      const aHeaders = aData[0].map(h => String(h || ''));
      for (let i = 1; i < aData.length; i++) {
        const aRow = aData[i];
        const obj  = {};
        aHeaders.forEach((h, j) => { obj[h] = aRow[j]; });
        const ativo = obj['ativo'] !== false && obj['ativo'] !== 'FALSE';
        if (ativo) {
          audios.push({
            dia:         Number(obj['dia']       || i),
            titulo:      String(obj['titulo']    || 'Áudio do Dia ' + i),
            descricao:   String(obj['descricao'] || ''),
            url:         String(obj['audio_url'] || ''),
            capa_url:    String(obj['capa_url']  || ''),
            legenda_url: String(obj['legenda_url'] || ''),
            duracao:     String(obj['duracao']   || '')
          });
        }
      }
      audios.sort((a, b) => a.dia - b.dia);
    }
  } catch(ex) {}
  // Fallback: usa campos audio_N do config — só adiciona se houver URL real
  if (!audios.length) {
    const baseAudio = String(cfg['audios_link'] || '');
    for (let d = 1; d <= 21; d++) {
      const customUrl = String(cfg['audio_' + d] || '');
      const finalUrl  = customUrl || (baseAudio ? baseAudio + '/dia-' + d : '');
      if (finalUrl) {
        audios.push({ dia: d, titulo: 'Áudio do Dia ' + d, descricao: '', url: finalUrl, capa_url: '', legenda_url: '', duracao: '' });
      }
    }
    // Se nenhum áudio foi encontrado, retorna lista vazia (estado vazio no app)
  }

  // Eventos
  let eventos = [];
  try { eventos = JSON.parse(String(cfg['eventos'] || '[]')) || []; } catch(e) {}

  // Conteúdos extras
  let conteudos = [];
  try { conteudos = JSON.parse(String(cfg['conteudos'] || '[]')) || []; } catch(e) {}

  return {
    ok: true,
    data: {
      ebookUrl:  String(cfg['pdf_link']   || ''),
      grupoLink: String(cfg['grupo_link'] || ''),
      salaLink:  String(cfg['sala_link']  || ''),
      videoUrl:  String(cfg['video_url']  || ''),
      audios,
      eventos,
      conteudos
    }
  };
}

// ══════════════════════════════════════════════════════════════
// getAudioBase64 — proxy server-side para áudio no Google Drive
// ──────────────────────────────────────────────────────────────
// Por que isso é necessário?
// O endpoint uc?export=download redireciona para
// drive.usercontent.google.com com authuser=0, que exige cookies
// de sessão Google. Um <audio> dentro de um iframe GAS não envia
// esses cookies (política SameSite). Resultado: 404 / format error.
// Solução: o GAS busca o arquivo server-side com DriveApp (já
// autenticado como o dono do script) e devolve uma data URL
// base64 que o <audio> pode usar diretamente, sem qualquer auth.
// ══════════════════════════════════════════════════════════════
function getAudioBase64(token, fileId) {
  const user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  // Valida formato do fileId (segurança básica)
  if (!fileId || !/^[a-zA-Z0-9_\-]{10,60}$/.test(fileId)) {
    return { ok: false, error: 'ID de arquivo inválido.' };
  }

  try {
    console.log('[getAudioBase64] Buscando fileId=' + fileId + ' user=' + user.email);
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();

    // Detecta MIME type — DriveApp às vezes retorna octet-stream
    let mimeType = blob.getContentType() || '';
    if (!mimeType || mimeType === 'application/octet-stream') {
      const name = file.getName().toLowerCase();
      if      (name.endsWith('.mp3'))             mimeType = 'audio/mpeg';
      else if (name.endsWith('.ogg'))             mimeType = 'audio/ogg';
      else if (name.endsWith('.wav'))             mimeType = 'audio/wav';
      else if (name.endsWith('.m4a'))             mimeType = 'audio/mp4';
      else if (name.endsWith('.mp4'))             mimeType = 'audio/mp4';
      else if (name.endsWith('.opus'))            mimeType = 'audio/ogg; codecs=opus';
      else if (name.endsWith('.aac'))             mimeType = 'audio/aac';
      else                                        mimeType = 'audio/mpeg';
    }

    const bytes = blob.getBytes();
    const size  = bytes.length;
    const sizeMB = Math.round(size / 1024 / 1024 * 10) / 10;

    // Limite de 50 MB (≈ 50 min de MP3 a 128kbps)
    if (size > 50 * 1024 * 1024) {
      return {
        ok: false,
        error: 'Arquivo muito grande (' + sizeMB + ' MB). Limite: 50 MB. Compacte o áudio para < 128 kbps.'
      };
    }

    const base64  = Utilities.base64Encode(bytes);
    const dataUrl = 'data:' + mimeType + ';base64,' + base64;

    console.log('[getAudioBase64] OK — "' + file.getName() + '" ' + sizeMB + ' MB ' + mimeType);
    return { ok: true, data: dataUrl, mimeType: mimeType, size: size, name: file.getName() };

  } catch(e) {
    console.error('[getAudioBase64] Erro: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ══════════════════════════════════════════════════════════════
// getTextFileContent — lê arquivo de texto (SRT/TXT) do Drive
// Usado pelo player de áudio para carregar transcrição
// ══════════════════════════════════════════════════════════════
function getTextFileContent(token, fileUrl) {
  const user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  try {
    if (!fileUrl) return { ok: false, error: 'URL não informada.' };

    // Extrai fileId de qualquer formato de URL do Drive
    let fileId = null;
    let m = String(fileUrl).match(/[?&]id=([a-zA-Z0-9_\-]+)/);
    if (m) { fileId = m[1]; }
    if (!fileId) {
      m = String(fileUrl).match(/\/(?:file\/)?d\/([a-zA-Z0-9_\-]+)/);
      if (m) { fileId = m[1]; }
    }
    if (!fileId) return { ok: false, error: 'ID do arquivo não encontrado na URL.' };

    const file = DriveApp.getFileById(fileId);

    // Verifica se é arquivo de texto (segurança básica)
    const mime = file.getMimeType();
    const textMimes = [
      'text/plain', 'text/vtt', 'application/x-subrip',
      'application/octet-stream'  // Drive às vezes retorna isso para .srt
    ];
    const isText = textMimes.some(function(t) { return mime.indexOf(t) !== -1; });
    const isSrtTxt = /\.(srt|vtt|txt)$/i.test(file.getName());
    if (!isText && !isSrtTxt) {
      return { ok: false, error: 'Tipo de arquivo não suportado: ' + mime };
    }

    const text = file.getBlob().getDataAsString('UTF-8');
    return { ok: true, data: text };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// ══════════════════════════════════════════════════════════════
// getCompradoresAdmin — painel admin de alunos
// ══════════════════════════════════════════════════════════════
function getCompradoresAdmin(token) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };

  const ss  = getSpreadsheet_();
  const aba = ss.getSheetByName(SHEET_COMPRADORES);
  if (!aba || aba.getLastRow() < 2) return { ok: true, data: [] };

  const dados   = aba.getDataRange().getValues();
  const headers = dados[0].map(h => String(h || ''));
  const pilaresColIdx = headers.indexOf(COL_PILARES_JSON);

  const lista = [];
  for (let i = 1; i < dados.length; i++) {
    const row = dados[i];
    if (!row[COL_COMP.ORDER_ID] && !row[COL_COMP.EMAIL]) continue;

    // Pilar JSON
    let pilaresJson = {};
    if (pilaresColIdx >= 0) {
      try { pilaresJson = JSON.parse(String(row[pilaresColIdx] || '{}')) || {}; } catch(e) {}
    }

    const stats = _calcProgresso_(row, pilaresJson);

    // Último envio de automação
    const ultStatusIdx = headers.indexOf('UltimoEnvioStatus');
    const ultStatus    = ultStatusIdx >= 0 ? String(row[ultStatusIdx] || '') : '';

    lista.push({
      orderId:        String(row[COL_COMP.ORDER_ID]  || ''),
      email:          String(row[COL_COMP.EMAIL]     || ''),
      nome:           String(row[COL_COMP.NOME]      || ''),
      telefone:       String(row[COL_COMP.TELEFONE]  || ''),
      paidAt:         String(row[COL_COMP.PAID_AT]   || ''),
      produto:        String(row[COL_COMP.PRODUTO]   || ''),
      diaAtual:       stats.diaAtual,
      diasConcluidos: stats.diasConcluidos,
      progresso:      stats.progresso,
      ativo:          row[COL_COMP.ATIVO] === true,
      concluido:      String(row[COL_COMP.DIA_CONC]  || '') !== '',
      ultimoCheckin:  String(row[COL_COMP.ULT_CHECK] || ''),
      onboarded:      row[COL_COMP.ONBOARDED] === true,
      autoStatus:     ultStatus
    });
  }

  return { ok: true, data: lista };
}

// ══════════════════════════════════════════════════════════════
// getCompradoresDetalhes — detalhe individual de um aluno (admin)
// ══════════════════════════════════════════════════════════════
function getCompradoresDetalhes(token, email) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };

  const ss  = getSpreadsheet_();
  const aba = ss.getSheetByName(SHEET_COMPRADORES);
  if (!aba || aba.getLastRow() < 2) return { ok: false, error: 'Sem dados.' };

  const dados   = aba.getDataRange().getValues();
  const headers = dados[0].map(h => String(h || ''));
  const emailIdx  = headers.indexOf('Email');
  const pilaresIdx = headers.indexOf(COL_PILARES_JSON);

  for (let i = 1; i < dados.length; i++) {
    const rowEmail = String(dados[i][emailIdx] || '').toLowerCase().trim();
    if (rowEmail !== String(email || '').toLowerCase().trim()) continue;

    const row = dados[i];
    let pilaresJson = {};
    if (pilaresIdx >= 0) {
      try { pilaresJson = JSON.parse(String(row[pilaresIdx] || '{}')) || {}; } catch(e) {}
    }

    const stats = _calcProgresso_(row, pilaresJson);

    // Monta histórico dia a dia
    const historico = [];
    for (let d = 1; d <= 21; d++) {
      const wsStatus  = String(row[COL_COMP.D1 + (d - 1)] || '');
      const pilaresDia = pilaresJson[String(d)] || {};
      const marcados   = PILARES_PADRAO.filter(p => pilaresDia[p] === true).length;
      historico.push({
        dia:      d,
        status:   wsStatus || (marcados >= 3 ? 'SIM' : marcados > 0 ? 'PARCIAL' : ''),
        pilares:  pilaresDia,
        marcados
      });
    }

    return {
      ok: true,
      data: {
        orderId:        String(row[COL_COMP.ORDER_ID]  || ''),
        email:          rowEmail,
        nome:           String(row[COL_COMP.NOME]      || ''),
        telefone:       String(row[COL_COMP.TELEFONE]  || ''),
        paidAt:         String(row[COL_COMP.PAID_AT]   || ''),
        produto:        String(row[COL_COMP.PRODUTO]   || ''),
        diaAtual:       stats.diaAtual,
        diasConcluidos: stats.diasConcluidos,
        progresso:      stats.progresso,
        ativo:          row[COL_COMP.ATIVO] === true,
        concluido:      String(row[COL_COMP.DIA_CONC]  || '') !== '',
        ultimoCheckin:  String(row[COL_COMP.ULT_CHECK] || ''),
        historico
      }
    };
  }

  return { ok: false, error: 'Comprador não encontrado.' };
}

// ══════════════════════════════════════════════════════════════
// getMeditacaoConfig — retorna configuração da experiência de
// meditação guiada para o aluno (duração, mensagens, áudios)
// ══════════════════════════════════════════════════════════════
function getMeditacaoConfig(token) {
  const user = getUserByToken(token);
  if (!user || (user.role !== 'aluno' && user.role !== 'admin')) return { ok: false, error: 'Não autorizado.' };

  // Garante que os defaults existem na aba config (não sobrescreve)
  initMeditacaoConfig_();

  const sheet = getSheet(SHEET_CONFIG);
  const data  = sheet.getDataRange().getValues();
  const cfg   = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) cfg[String(data[i][0])] = data[i][1];
  }

  // Duração em segundos
  const total = Number(cfg['med_duracao_min'] || 15) * 60;

  // Mensagens rotativas
  let msgs = [];
  try { msgs = JSON.parse(String(cfg['med_mensagens'] || '[]')); } catch(e) {}
  if (!msgs || !msgs.length) msgs = [
    'Respire lentamente...', 'Esvazie sua mente.', 'Deixe os pensamentos passarem.',
    'Foque na sua respiração.', 'Sinta seu corpo relaxar.', 'Você está no lugar certo.',
    'Este momento é seu.', 'Inspire... expire...', 'Liberte as tensões.',
    'Esteja presente.', 'Não há nada a fazer agora.', 'Apenas seja.',
    'Cada respiração é um recomeço.', 'Sua mente se aquieta.', 'Sinta a paz interior.',
    'O presente é tudo o que existe.', 'Você está bem.', 'Solte o que não serve.',
    'Confie no processo.', 'Gratidão por estar aqui.'
  ];

  // Áudios disponíveis: array de { name, fileId }
  let audios = [];
  try { audios = JSON.parse(String(cfg['med_audios'] || '[]')); } catch(e) {}
  if (!audios || !audios.length) audios = [
    { name: 'O som da paz interior',                     fileId: '16Ihmd6HGADzOWxHVVX3YfpXy2wXgTrbD' },
    { name: 'Frequência de Cura 1111 Hz',                fileId: '1p4oJE4BKeLlZcvi_A7iGK0GOyZlsb4A-' },
    { name: 'Conecte-se com sua Melhor Versão 852 Hz',   fileId: '1oP7bvkpSGJxJvki4gCPUV2SRQNNOikWo' },
    { name: 'Afirmações Positivas EU SOU',               fileId: '1lYEGT8pdERqTDn-HCCKgBkWUXh6NAjbF' }
  ];

  // ── Migração automática: atualiza fileIds antigos (arquivos 1h) para os novos (15 min) ──
  const _OLD_TO_NEW_IDS = {
    '1vCFM4fz02uWb_BeZXIKpqhzntJ4iKLfv': '16Ihmd6HGADzOWxHVVX3YfpXy2wXgTrbD',
    '1mIo1yfXFshfTVnext3_uERNzkOlsLfrj': '1p4oJE4BKeLlZcvi_A7iGK0GOyZlsb4A-',
    '1ODkUPnYHYwqVdkBPNZBpgTnoh97vFpRE':  '1oP7bvkpSGJxJvki4gCPUV2SRQNNOikWo',
    '1NYawAZqXC74EHqcq6rnM5NQz0QPqQ9uj':  '1lYEGT8pdERqTDn-HCCKgBkWUXh6NAjbF'
  };
  let _migrated = false;
  audios = audios.map(function(a) {
    if (a.fileId && _OLD_TO_NEW_IDS[a.fileId]) {
      _migrated = true;
      return Object.assign({}, a, { fileId: _OLD_TO_NEW_IDS[a.fileId] });
    }
    return a;
  });
  if (_migrated) {
    try {
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === 'med_audios') {
          sheet.getRange(i + 1, 2).setValue(JSON.stringify(audios));
          break;
        }
      }
      console.log('[getMeditacaoConfig] Migração automática: fileIds atualizados para versão 15 min');
    } catch(ex) {
      console.error('[getMeditacaoConfig] Erro na migração:', ex.message);
    }
  }

  // Índice do áudio padrão
  const defaultAudioIdx = Number(cfg['med_audio_padrao'] || 0);

  // Textos das telas de onboarding
  const texto_s1 = String(cfg['med_texto_s1'] || '');
  const texto_s2 = String(cfg['med_texto_s2'] || '');
  const texto_s3 = String(cfg['med_texto_s3'] || '');

  return {
    ok:            true,
    total:         total,
    msgs:          msgs,
    audios:        audios,
    defaultAudio:  defaultAudioIdx,
    texto_s1:      texto_s1,
    texto_s2:      texto_s2,
    texto_s3:      texto_s3
  };
}

// ══════════════════════════════════════════════════════════════
// saveMeditacaoConfig — salva configuração da meditação
// Aceita: { duracao_min, audios, default_audio, texto_s1/2/3, mensagens }
// ══════════════════════════════════════════════════════════════
function saveMeditacaoConfig(token, config) {
  const user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  // Aceita admin ou aluno (o admin do desafio tem acesso via perfil)
  if (user.role !== 'admin' && user.role !== 'aluno') {
    return { ok: false, error: 'Sem permissão.' };
  }

  if (!config) return { ok: false, error: 'Dados inválidos.' };

  const sheet = getSheet(SHEET_CONFIG);
  const data  = sheet.getDataRange().getValues();

  // Monta mapa de posições existentes para update in-place
  const rowMap = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) rowMap[String(data[i][0])] = i + 1; // row 1-indexed
  }

  // Helper para upsert: update se existe, append se não existe
  function upsert(key, val) {
    const strVal = (typeof val === 'string') ? val : JSON.stringify(val);
    if (rowMap[key]) {
      sheet.getRange(rowMap[key], 2).setValue(strVal);
    } else {
      sheet.appendRow([key, strVal, '']);
      rowMap[key] = sheet.getLastRow();
    }
  }

  try {
    // Duração
    const dur = Math.max(1, Math.min(120, parseInt(config.duracao_min, 10) || 15));
    upsert('med_duracao_min', dur);

    // Áudios (valida array)
    let audios = config.audios || [];
    if (!Array.isArray(audios)) audios = [];
    audios = audios.filter(a => a && (a.name || a.fileId))
                   .map(a => ({ name: String(a.name || ''), fileId: String(a.fileId || '') }));
    upsert('med_audios', audios);

    // Áudio padrão
    const defAudio = Math.max(0, parseInt(config.default_audio, 10) || 0);
    upsert('med_audio_padrao', defAudio);

    // Textos das telas
    if (config.texto_s1 !== undefined) upsert('med_texto_s1', String(config.texto_s1 || ''));
    if (config.texto_s2 !== undefined) upsert('med_texto_s2', String(config.texto_s2 || ''));
    if (config.texto_s3 !== undefined) upsert('med_texto_s3', String(config.texto_s3 || ''));

    // Mensagens
    let msgs = config.mensagens || [];
    if (!Array.isArray(msgs)) msgs = [];
    msgs = msgs.map(m => String(m || '').trim()).filter(m => m.length > 0);
    if (msgs.length > 0) upsert('med_mensagens', msgs);

    logAction(user.email, 'SAVE_MED_CONFIG', 'config', '', 'dur=' + dur + ' audios=' + audios.length);
    return { ok: true };

  } catch(e) {
    console.error('[saveMeditacaoConfig] ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ── Inicializa defaults de meditação na aba config ──────────────
// NÃO sobrescreve chaves que já existam
function initMeditacaoConfig_() {
  const sheet = getSheet(SHEET_CONFIG);
  const data  = sheet.getDataRange().getValues();
  const existing = new Set();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) existing.add(String(data[i][0]));
  }

  const defaultAudiosJson = JSON.stringify([
    { name: 'O som da paz interior',                     fileId: '16Ihmd6HGADzOWxHVVX3YfpXy2wXgTrbD' },
    { name: 'Frequência de Cura 1111 Hz',                fileId: '1p4oJE4BKeLlZcvi_A7iGK0GOyZlsb4A-' },
    { name: 'Conecte-se com sua Melhor Versão 852 Hz',   fileId: '1oP7bvkpSGJxJvki4gCPUV2SRQNNOikWo' },
    { name: 'Afirmações Positivas EU SOU',               fileId: '1lYEGT8pdERqTDn-HCCKgBkWUXh6NAjbF' }
  ]);
  const defaults = [
    ['med_duracao_min',  15,               'Duração da meditação em minutos'],
    ['med_mensagens',    '[]',             'Mensagens rotativas em JSON (array de strings)'],
    ['med_audios',       defaultAudiosJson,'Áudios disponíveis em JSON (array de {name, fileId})'],
    ['med_audio_padrao', 0,               'Índice do áudio padrão (0 = primeiro)'],
    ['med_texto_s1',     '',              'Texto da tela 1 — Lugar tranquilo'],
    ['med_texto_s2',     '',              'Texto da tela 2 — Prepare o ambiente'],
    ['med_texto_s3',     '',              'Texto da tela 3 — Respiração']
  ];

  defaults.forEach(function([key, val, desc]) {
    if (!existing.has(key)) {
      sheet.appendRow([key, val, desc]);
    }
  });
}

// ══════════════════════════════════════════════════════════════
// reiniciarDesafio — zera progresso do aluno e começa novo ciclo
// Define _inicioCiclo = hoje (BR) como nova data de início do Dia 1
// ══════════════════════════════════════════════════════════════
function reiniciarDesafio(token) {
  const _user = getUserByToken(token);
  if (!_user) return { ok: false, error: 'Não autorizado.' };
  if (_user.role === 'admin') return { ok: true, msg: 'Admin: simulação de reinício (sem persistência).' };

  const aluno = getAlunoByToken_(token);
  if (!aluno) return { ok: false, error: 'Não autorizado.' };

  const { row, rowIndex, headers, aba } = aluno;

  // Data de início do novo ciclo = hoje em Brasília
  const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');

  // Novo pilaresJson com apenas a meta do ciclo
  const novoJson = { _inicioCiclo: hoje };

  // Reseta colunas principais
  aba.getRange(rowIndex, COL_COMP.DIA_ATUAL + 1).setValue(1);
  aba.getRange(rowIndex, COL_COMP.ATIVO     + 1).setValue(true);
  aba.getRange(rowIndex, COL_COMP.ULT_CHECK + 1).setValue('');
  aba.getRange(rowIndex, COL_COMP.DIA_CONC  + 1).setValue('');

  // Zera colunas D1..D21
  for (let d = 0; d < 21; d++) {
    aba.getRange(rowIndex, COL_COMP.D1 + d + 1).setValue('');
  }

  // Salva novo pilaresJson
  _savePilaresJson_(aba, rowIndex, headers, novoJson);

  logAction(_user.email, 'REINICIAR_DESAFIO', 'aluno', _user.email, 'inicioCiclo=' + hoje);
  return { ok: true, dataInicio: hoje };
}

// ══════════════════════════════════════════════════════════════
// criarUsuarioAluno_ — cria conta no users para o comprador
// Chamada pelo webhook da Cakto após salvar o comprador
// ══════════════════════════════════════════════════════════════
function criarUsuarioAluno_(email, nome, senhaTemp) {
  if (!email) return;
  try {
    const sheet = getSheet(SHEET_USERS);
    const users = sheetToObjects(sheet);
    if (users.find(u => u.email === email)) return; // Já existe
    const id = generateId();
    sheet.appendRow([id, nome || email, email, hashPassword(senhaTemp), 'aluno', '', true, nowISO()]);
    logAction('system', 'CREATE_ALUNO_USER', 'user', id, email);
  } catch(e) {
    logAction('system', 'CREATE_ALUNO_USER_FAIL', 'user', '', email + ' | ' + e.message);
  }
}
