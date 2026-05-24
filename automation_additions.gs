// ============================================================
// automation_additions.gs
// ADICIONAR como novo arquivo OU colar no final de automation.gs
// ============================================================

// ══════════════════════════════════════════════════════════════
// LISTAR COMPRADORES (dropdown de teste)
// ══════════════════════════════════════════════════════════════

function getCompradoresList(token) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };

  const ss  = getSpreadsheet_();
  const aba = ss.getSheetByName(SHEET_COMPRADORES);
  if (!aba || aba.getLastRow() < 2) return { ok: true, data: [] };

  const dados = aba.getDataRange().getValues();
  const lista = [];
  for (let i = 1; i < dados.length; i++) {
    const row = dados[i];
    if (!row[COL_COMP.ORDER_ID]) continue;
    lista.push({
      rowIndex: i + 1,
      orderId:  String(row[COL_COMP.ORDER_ID]),
      nome:     String(row[COL_COMP.NOME]     || ''),
      email:    String(row[COL_COMP.EMAIL]    || ''),
      telefone: String(row[COL_COMP.TELEFONE] || ''),
      diaAtual: parseInt(row[COL_COMP.DIA_ATUAL]) || 1,
      ativo:    row[COL_COMP.ATIVO] === true,
      paidAt:   String(row[COL_COMP.PAID_AT]  || '')
    });
  }
  return { ok: true, data: lista };
}

// ══════════════════════════════════════════════════════════════
// INICIAR TESTE DE ACOMPANHAMENTO
// ══════════════════════════════════════════════════════════════

function iniciarTesteAcompanhamento(token, busca) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };

  const ss  = getSpreadsheet_();
  const aba = ss.getSheetByName(SHEET_COMPRADORES);
  if (!aba) return { ok: false, error: 'Aba compradores não encontrada. Execute Inicializar Planilha.' };

  const dados = aba.getDataRange().getValues();
  let linhaEnc = -1, nomeComp = '';

  for (let i = 1; i < dados.length; i++) {
    const row   = dados[i];
    const match =
      (busca.orderId  && String(row[COL_COMP.ORDER_ID]).trim() === String(busca.orderId).trim()) ||
      (busca.email    && String(row[COL_COMP.EMAIL]).toLowerCase().trim() === String(busca.email).toLowerCase().trim()) ||
      (busca.telefone && String(row[COL_COMP.TELEFONE]).replace(/\D/g,'') === String(busca.telefone).replace(/\D/g,''));
    if (match) {
      linhaEnc = i + 1;
      nomeComp = String(row[COL_COMP.NOME] || '').split(' ')[0] || 'você';
      break;
    }
  }

  if (linhaEnc === -1) return { ok: false, error: 'Comprador não encontrado. Verifique e-mail, telefone ou Order ID.' };

  aba.getRange(linhaEnc, COL_COMP.DIA_ATUAL  + 1).setValue(1);
  aba.getRange(linhaEnc, COL_COMP.ATIVO       + 1).setValue(true);
  aba.getRange(linhaEnc, COL_COMP.ULT_CHECK   + 1).setValue('');
  aba.getRange(linhaEnc, COL_COMP.DIA_CONC    + 1).setValue('');
  aba.getRange(linhaEnc, COL_COMP.ONBOARDED   + 1).setValue(false);
  for (let d = 0; d < 21; d++) aba.getRange(linhaEnc, COL_COMP.D1 + d + 1).setValue('');

  const fone       = String(dados[linhaEnc - 1][COL_COMP.TELEFONE]);
  const salaLink   = getConfig_('sala_link')   || '';
  const audiosLink = getConfig_('audios_link') || '';

  const msg =
    'TESTE - Dia 1 de 21 — bom dia, ' + nomeComp + '!\n\n' +
    'Esta é uma mensagem de teste do acompanhamento automatizado.\n\n' +
    (salaLink ? 'Sala de leitura:\n' + salaLink + '\n\n' : '') +
    'Audio do Dia 1:\n' + audiosLink + '/dia-1\n\n' +
    '3 pilares: Meditacao - Leitura - Exercicio\n\n' +
    'Se recebeu esta mensagem, o sistema esta funcionando corretamente.';

  const sucesso = enviarMensagemGPT_(fone, msg);

  logAction(user.email, 'TESTE_21DIAS_INICIADO', 'comprador',
    String(dados[linhaEnc - 1][COL_COMP.ORDER_ID]),
    nomeComp + ' | ' + fone + ' | enviou=' + sucesso);

  return {
    ok: true,
    message: 'Teste iniciado para ' + nomeComp + '. Mensagem Dia 1 ' + (sucesso ? 'enviada com sucesso!' : 'FALHOU — verifique o token GPT Maker.')
  };
}

// ══════════════════════════════════════════════════════════════
// DASHBOARD COMPLETO — CRM + Automacoes + Trafego
// ══════════════════════════════════════════════════════════════

function iniciarTesteAcompanhamentoV2(token, busca) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissÃ£o.' };

  const ss  = getSpreadsheet_();
  const aba = ss.getSheetByName(SHEET_COMPRADORES);
  if (!aba) return { ok: false, error: 'Aba compradores nÃ£o encontrada. Execute Inicializar Planilha.' };
  ensureCompradoresMetaColumns_(aba);

  const dados = aba.getDataRange().getValues();
  let linhaEnc = -1;
  let nomeComp = '';

  for (let i = 1; i < dados.length; i++) {
    const row = dados[i];
    const match =
      (busca.orderId  && String(row[COL_COMP.ORDER_ID]).trim() === String(busca.orderId).trim()) ||
      (busca.email    && String(row[COL_COMP.EMAIL]).toLowerCase().trim() === String(busca.email).toLowerCase().trim()) ||
      (busca.telefone && String(row[COL_COMP.TELEFONE]).replace(/\D/g, '') === String(busca.telefone).replace(/\D/g, ''));
    if (match) {
      linhaEnc = i + 1;
      nomeComp = String(row[COL_COMP.NOME] || '').split(' ')[0] || 'vocÃª';
      break;
    }
  }

  if (linhaEnc === -1) {
    return { ok: false, error: 'Comprador nÃ£o encontrado. Verifique e-mail, telefone ou Order ID.' };
  }

  aba.getRange(linhaEnc, COL_COMP.DIA_ATUAL + 1).setValue(1);
  aba.getRange(linhaEnc, COL_COMP.ATIVO + 1).setValue(true);
  aba.getRange(linhaEnc, COL_COMP.ULT_CHECK + 1).setValue('');
  aba.getRange(linhaEnc, COL_COMP.DIA_CONC + 1).setValue('');
  aba.getRange(linhaEnc, COL_COMP.ONBOARDED + 1).setValue(false);
  for (let d = 0; d < 21; d++) aba.getRange(linhaEnc, COL_COMP.D1 + d + 1).setValue('');

  registrarResultadoEnvioComprador_(aba, linhaEnc, 'teste', { ok: false, error: '' }, {
    pending: true,
    detail: 'Teste iniciado. Preparando envio da mensagem do Dia 1.'
  });

  const fone       = String(dados[linhaEnc - 1][COL_COMP.TELEFONE] || '');
  const salaLink   = getConfig_('sala_link')   || '';
  const audiosLink = getConfig_('audios_link') || '';

  const msg =
    'TESTE - Dia 1 de 21 â€” bom dia, ' + nomeComp + '!\n\n' +
    'Esta Ã© uma mensagem de teste do acompanhamento automatizado.\n\n' +
    (salaLink ? 'Sala de leitura:\n' + salaLink + '\n\n' : '') +
    'Audio do Dia 1:\n' + audiosLink + '/dia-1\n\n' +
    '3 pilares: Meditacao - Leitura - Exercicio\n\n' +
    'Se recebeu esta mensagem, o sistema esta funcionando corretamente.';

  const envio = enviarMensagemGptV2_(fone, msg);
  registrarResultadoEnvioComprador_(aba, linhaEnc, 'teste', envio);

  logAction(user.email, envio.ok ? 'TESTE_21DIAS_OK' : 'TESTE_21DIAS_FAIL', 'comprador',
    String(dados[linhaEnc - 1][COL_COMP.ORDER_ID]),
    JSON.stringify({
      nome: nomeComp,
      phone: fone,
      ok: envio.ok,
      mode: envio.mode || '',
      chatId: envio.chatId || '',
      channelId: envio.channelId || '',
      workspaceId: envio.workspaceId || '',
      endpoint: envio.endpoint || '',
      httpCode: envio.httpCode || 0,
      error: envio.error || ''
    }));

  if (!envio.ok) {
    return {
      ok: false,
      error: 'Teste iniciado para ' + nomeComp + ', mas a mensagem do Dia 1 falhou: ' + (envio.error || 'erro desconhecido'),
      technical: envio
    };
  }

  return {
    ok: true,
    message: 'Teste iniciado para ' + nomeComp + '. Mensagem do Dia 1 enviada com sucesso via ' + (envio.mode || 'GPT Maker') + '.',
    technical: envio
  };
}

function getDashboardFull(token, opts) {
  const user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  // Período: 7|14|30|60|90|0(total). Default 30.
  const dias   = parseInt((opts && opts.dias) || 30) || 30;
  const agora  = new Date();
  const limPer = dias > 0 ? new Date(agora - dias * 24 * 3600000) : null;
  const lim30  = new Date(agora - 30 * 24 * 3600000); // sempre 30d para byDay

  // Carrega etapas dinamicamente do pipeline configurado (ou fallback fixo)
  let STAGES_LIST = ['Interessado', 'Qualificado', 'Em Atendimento', 'Proposta Enviada', 'Fechado'];
  let stagesConfig = null;
  try {
    const rawPip = getConfig_('pipelines_config');
    if (rawPip) {
      const pipCfg = JSON.parse(String(rawPip));
      if (pipCfg && Array.isArray(pipCfg.etapas)) {
        const ativas = pipCfg.etapas.filter(e => e.ativa !== false).sort((a, b) => (a.ordem||0)-(b.ordem||0));
        STAGES_LIST = ativas.map(e => e.nome);
        stagesConfig = ativas;
      }
    }
  } catch(e) {}

  const byStage = {};
  STAGES_LIST.forEach(s => { byStage[s] = 0; });
  const byDay  = {};
  let   total  = 0, totalNoPeriod = 0;

  const crmData = getSheet(SHEET_CRM).getDataRange().getValues();
  if (crmData.length > 1) {
    const headers = crmData[0].map(h => String(h));
    const iStatus = headers.indexOf('status');
    const iDate   = headers.indexOf('created_at');
    for (let i = 1; i < crmData.length; i++) {
      if (!crmData[i][0]) continue;
      totalNoPeriod++;
      const raw = crmData[i][iDate];
      const d   = raw instanceof Date ? raw : new Date(raw);
      const inPeriod = !limPer || (!isNaN(d) && d >= limPer);
      if (inPeriod) {
        total++;
        const st = String(crmData[i][iStatus] || '');
        if (byStage[st] !== undefined) byStage[st]++;
      }
      if (!isNaN(d) && d >= lim30) {
        const k = d.toISOString().slice(0, 10);
        byDay[k] = (byDay[k] || 0) + 1;
      }
    }
  }

  const fechadosKey = STAGES_LIST[STAGES_LIST.length - 1];
  const convRate = total > 0 ? ((byStage[fechadosKey] / total) * 100).toFixed(1) : 0;

  // Alunos / compradores (não filtrados por período — mostrar total)
  let compradores = 0, ativos = 0, concluidos = 0, pausados = 0,
      proxConcluir = 0, progMedioTotal = 0, followupPendente = 0;
  try {
    const aba = getSpreadsheet_().getSheetByName(SHEET_COMPRADORES);
    if (aba && aba.getLastRow() > 1) {
      const comp    = aba.getDataRange().getValues();
      const compHdr = comp[0].map(h => String(h || ''));
      const pilaresIdx = compHdr.indexOf('PilaresJson');
      compradores = comp.length - 1;
      let somaProgresso = 0;
      for (let i = 1; i < comp.length; i++) {
        const row = comp[i];
        let pj = {};
        if (pilaresIdx >= 0) { try { pj = JSON.parse(String(row[pilaresIdx] || '{}')) || {}; } catch(e) {} }
        const stats = _calcProgresso_(row, pj);
        somaProgresso += stats.progresso;
        if (row[COL_COMP.ATIVO] === true) ativos++;
        if (String(row[COL_COMP.DIA_CONC] || '') !== '') concluidos++;
        else if (row[COL_COMP.ATIVO] !== true && String(row[COL_COMP.DIA_CONC] || '') === '') pausados++;
        if (stats.diaAtual >= 18 && stats.diaAtual <= 21 && row[COL_COMP.ATIVO] === true) proxConcluir++;
      }
      progMedioTotal = compradores > 0 ? Math.round(somaProgresso / compradores) : 0;
    }
    const maxTent = parseInt(getConfig_('followup_max_tentativas')) || 2;
    if (crmData.length > 1) {
      const hdrs = crmData[0].map(h => String(h));
      const iSt2 = hdrs.indexOf('status');
      const iCF  = hdrs.indexOf('custom_fields');
      for (let i = 1; i < crmData.length; i++) {
        if (String(crmData[i][iSt2]) !== 'Interessado') continue;
        let cf = {};
        try { cf = JSON.parse(String(crmData[i][iCF] || '{}')); } catch(e) {}
        if ((parseInt(cf.followup_count) || 0) < maxTent) followupPendente++;
      }
    }
  } catch(e) {}

  const trafego = getTrafegoResumoDashboard_(dias);

  return {
    ok: true,
    data: {
      total, totalGeral: totalNoPeriod, byStage, byDay,
      conversionRate: convRate, stages: STAGES_LIST, stagesConfig,
      compradores, ativos, concluidos, pausados, proxConcluir, progMedioTotal, followupPendente,
      trafego, periodo: dias
    }
  };
}
