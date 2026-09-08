// ============================================================
// crm_leads.gs — Trial leads no CRM + recuperação (v164)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// Quem preenche o checkout com cartão confirma o e-mail por
// código, informa o WhatsApp e aceita os termos — e mesmo assim
// alguns param na tela do cartão. Esses eram os melhores leads
// do funil e não apareciam em lugar nenhum além de uma aba de
// planilha.
//
// Aqui eles entram no CRM com o estágio certo e o histórico do
// que fizeram, e recebem UM template de WhatsApp para abrir a
// janela de conversa.
//
// SOBRE O MOMENTO DO DISPARO: não é na hora. Quem acabou de
// fechar a tela do cartão e recebe mensagem no mesmo segundo
// sente vigilância, não atendimento. Além disso boa parte volta
// sozinha em minutos — e mandar recado para quem já voltou é
// ruído. O padrão é 45 minutos, ajustável no painel.
// ============================================================

var CRM_ORIGEM_CARTAO = 'trial-cartao';
var CRM_ORIGEM_SEM    = 'trial-sem-cartao';

function _clNorm_(e) { return String(e || '').toLowerCase().trim(); }
function _clFone_(t)  { return String(t || '').replace(/\D/g, ''); }

// ─────────────────────────────────────────────────────────────
// UPSERT no CRM — por e-mail, caindo para o telefone.
// Idempotente: rodar a sincronização dez vezes não cria dez cards.
// ─────────────────────────────────────────────────────────────
function _crmUpsertLead_(d) {
  d = d || {};
  var email = _clNorm_(d.email);
  var fone  = _clFone_(d.phone);
  if (!email && fone.length < 10) return { ok: false, error: 'sem identificador' };

  var sheet   = getSheet(SHEET_CRM);
  var dados   = sheet.getDataRange().getValues();
  var headers = dados[0].map(function (h) { return String(h); });

  var iId   = headers.indexOf('id'),      iNome = headers.indexOf('name'),
      iMail = headers.indexOf('email'),   iFone = headers.indexOf('phone'),
      iSt   = headers.indexOf('status'),  iUpd  = headers.indexOf('updated_at'),
      iCF   = headers.indexOf('custom_fields'), iTL = headers.indexOf('timeline'),
      iCri  = headers.indexOf('created_at'), iResp = headers.indexOf('form_answers'),
      iUser = headers.indexOf('assigned_user');

  var agora = nowISO();

  for (var i = 1; i < dados.length; i++) {
    var mesmoEmail = email && _clNorm_(dados[i][iMail]) === email;
    var mesmoFone  = !mesmoEmail && fone.length >= 10 &&
                     _clFone_(dados[i][iFone]).slice(-10) === fone.slice(-10);
    if (!mesmoEmail && !mesmoFone) continue;

    // Já existe: completa o que faltava e registra o novo passo.
    if (d.name  && !String(dados[i][iNome] || '').trim()) sheet.getRange(i + 1, iNome + 1).setValue(d.name);
    if (fone    && !_clFone_(dados[i][iFone]))            sheet.getRange(i + 1, iFone + 1).setValue('+' + fone);
    if (email   && !_clNorm_(dados[i][iMail]))            sheet.getRange(i + 1, iMail + 1).setValue(email);

    // O estágio só ANDA para frente. Um lead que já virou cliente não
    // pode voltar para "Interessado" porque uma rotina rodou de novo.
    if (d.status && iSt >= 0) {
      var atual = String(dados[i][iSt] || '');
      if (STAGES.indexOf(d.status) > STAGES.indexOf(atual)) {
        sheet.getRange(i + 1, iSt + 1).setValue(d.status);
      }
    }

    if (iCF >= 0 && d.custom) {
      var cf = {};
      try { cf = JSON.parse(String(dados[i][iCF] || '{}')); } catch (e) {}
      Object.keys(d.custom).forEach(function (k) { if (d.custom[k] !== '' && d.custom[k] != null) cf[k] = d.custom[k]; });
      sheet.getRange(i + 1, iCF + 1).setValue(JSON.stringify(cf));
    }

    if (iTL >= 0 && d.evento) {
      var tl = [];
      try { tl = JSON.parse(String(dados[i][iTL] || '[]')); } catch (e) {}
      var repetido = tl.length && tl[tl.length - 1].action === d.evento;
      if (!repetido) {
        tl.push({ action: d.evento, user: 'sistema', timestamp: agora });
        sheet.getRange(i + 1, iTL + 1).setValue(JSON.stringify(tl.slice(-40)));
      }
    }

    if (iUpd >= 0) sheet.getRange(i + 1, iUpd + 1).setValue(agora);
    invalidateLeadsCache_();
    return { ok: true, id: String(dados[i][iId] || ''), criado: false };
  }

  // Não existe: cria respeitando a ordem das colunas da aba.
  var linha = new Array(headers.length).fill('');
  var id = generateId();
  if (iId   >= 0) linha[iId]   = id;
  if (iNome >= 0) linha[iNome] = d.name || '';
  if (iMail >= 0) linha[iMail] = email;
  if (iFone >= 0) linha[iFone] = fone ? ('+' + fone) : '';
  if (iResp >= 0) linha[iResp] = '';
  if (iSt   >= 0) linha[iSt]   = d.status || STAGES[0];
  if (iCri  >= 0) linha[iCri]  = d.created_at || agora;
  if (iUpd  >= 0) linha[iUpd]  = agora;
  if (iUser >= 0) linha[iUser] = '';
  if (iCF   >= 0) linha[iCF]   = JSON.stringify(d.custom || {});
  if (iTL   >= 0) linha[iTL]   = JSON.stringify([
    { action: d.evento || 'Lead do trial', user: 'sistema', timestamp: agora }
  ]);

  sheet.appendRow(linha);
  invalidateLeadsCache_();
  return { ok: true, id: id, criado: true };
}

// Traduz o que a pessoa fez no funil para o estágio do CRM.
function _clEstagio_(estagioTrial, convertido) {
  if (String(convertido).toLowerCase() === 'sim') return 'Fechado';
  // Quem foi até o cartão confirmou e-mail por código, informou o WhatsApp
  // e aceitou os termos. É outro patamar de intenção que quem só deixou
  // o nome numa página.
  if (String(estagioTrial) === 'cartao_iniciado')   return 'Qualificado';
  if (String(estagioTrial) === 'cartao_confirmado') return 'Fechado';
  return 'Interessado';
}

// ─────────────────────────────────────────────────────────────
// Chamado pelos fluxos, para o lead cair no CRM na hora
// ─────────────────────────────────────────────────────────────
function crmRegistrarLeadTrial_(d) {
  try {
    d = d || {};
    var comCartao = String(d.origem || '').indexOf('cartao') >= 0;
    return _crmUpsertLead_({
      name:  d.nome,
      email: d.email,
      phone: d.whatsapp,
      status: _clEstagio_(d.estagio, d.convertido),
      created_at: d.criadoEm || '',
      custom: {
        origem:      comCartao ? CRM_ORIGEM_CARTAO : CRM_ORIGEM_SEM,
        oferta_dias: d.dias || '',
        campanha:    d.campanha || '',
        indicado_por: d.ref || '',
        etapa_trial: d.estagio || '',
        convertido:  d.convertido || 'nao'
      },
      evento: d.evento || (comCartao
        ? ('Checkout com cartão — ' + (d.estagio || 'iniciado'))
        : 'Cadastro no teste grátis')
    });
  } catch (e) {
    logAction('system', 'CRM_LEAD_ERRO', 'crm', String((d || {}).email || ''), e.message);
    return { ok: false, error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
// ROTA ADMIN: sincronizarLeadsCRM — traz o histórico inteiro
// ─────────────────────────────────────────────────────────────
function sincronizarLeadsCRM(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  var res = { lidos: 0, criados: 0, atualizados: 0, ignorados: 0 };
  try {
    var sh = getSpreadsheet_().getSheetByName(SHEET_TRIAL_LEADS);
    if (!sh || sh.getLastRow() < 2) return { ok: true, data: res };

    var d = sh.getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      var email = _clNorm_(d[i][2]);
      var fone  = _clFone_(d[i][3]);
      if (!email && fone.length < 10) { res.ignorados++; continue; }
      res.lidos++;

      var r = crmRegistrarLeadTrial_({
        nome: String(d[i][1] || ''), email: email, whatsapp: fone,
        dias: d[i][4] || '', estagio: String(d[i][5] || ''),
        origem: String(d[i][6] || ''), convertido: String(d[i][8] || 'nao'),
        criadoEm: String(d[i][0] || '')
      });
      if (r && r.ok) { r.criado ? res.criados++ : res.atualizados++; }
      else res.ignorados++;
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }

  logAction(user.email, 'CRM_SYNC_LEADS', 'crm', '', JSON.stringify(res));
  return { ok: true, data: res };
}

// ─────────────────────────────────────────────────────────────
// RECUPERAÇÃO — abre a conversa com quem parou no cartão
// ------------------------------------------------------------
// Roda em gatilho de tempo. Não dispara na hora de propósito:
// ver a janela do cartão fechar e o celular apitar no mesmo
// segundo assusta. E boa parte volta sozinha em minutos.
// ─────────────────────────────────────────────────────────────
function _clCfg_() {
  var n = function (k, p) {
    var v = 0; try { v = parseInt(getConfig_(k), 10); } catch (e) {}
    return v > 0 ? v : p;
  };
  return {
    esperaMin: n('crm_recup_espera_min', 45),   // tempo de silêncio antes de falar
    limiteHoras: n('crm_recup_limite_h', 48),   // depois disso, esfriou demais
    ativo: String(getConfig_('crm_recup_ativo') || '') === '1'
  };
}

// Marca na aba trial_leads quando o contato saiu (coluna criada sob demanda).
function _clColunaContato_(sh) {
  var cab = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0]
              .map(function (h) { return String(h || ''); });
  var i = cab.indexOf('ContatadoEm');
  if (i >= 0) return i + 1;
  var col = cab.length + 1;
  sh.getRange(1, col).setValue('ContatadoEm').setFontWeight('bold');
  return col;
}

function recuperarCheckoutsAbandonados() {
  var cfg = _clCfg_();
  if (!cfg.ativo) return { ok: false, error: 'desligado' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { ok: false, error: 'ja rodando' }; }

  var res = { candidatos: 0, enviados: 0, falhas: 0, pulados: 0 };
  try {
    var sh = getSpreadsheet_().getSheetByName(SHEET_TRIAL_LEADS);
    if (!sh || sh.getLastRow() < 2) return { ok: true, data: res };

    var colContato = _clColunaContato_(sh);
    var d = sh.getDataRange().getValues();
    var agora = Date.now();

    for (var i = 1; i < d.length; i++) {
      if (String(d[i][5] || '') !== 'cartao_iniciado') continue;      // só quem parou no cartão
      if (String(d[i][8] || '').toLowerCase() === 'sim') continue;    // já converteu
      if (String(d[i][colContato - 1] || '')) continue;               // já falamos com ele

      var quando = new Date(d[i][0]);
      if (isNaN(quando.getTime())) continue;
      var minutos = (agora - quando.getTime()) / 60000;
      if (minutos < cfg.esperaMin) continue;                          // ainda pode voltar sozinho
      if (minutos > cfg.limiteHoras * 60) continue;                   // esfriou

      res.candidatos++;
      var email = _clNorm_(d[i][2]);
      var fone  = _clFone_(d[i][3]);
      if (fone.length < 10) { res.pulados++; continue; }

      // Respeita quem pediu para não receber comunicação comercial.
      try {
        if (typeof emAceitaMarketing_ === 'function' && !emAceitaMarketing_(email)) {
          sh.getRange(i + 1, colContato).setValue('optout');
          res.pulados++; continue;
        }
      } catch (e) {}

      var ctx = {
        nome: String(d[i][1] || '').split(' ')[0],
        email: email, whatsapp: fone,
        dias: Number(d[i][4]) || 7, valor: 17, dataCobranca: ''
      };

      var envio = { ok: false, error: 'sem funcao' };
      try { envio = waRecuperarCheckout_(ctx); } catch (e) { envio = { ok: false, error: e.message }; }

      if (envio && envio.ok) {
        sh.getRange(i + 1, colContato).setValue(nowISO());
        res.enviados++;
        try {
          crmRegistrarLeadTrial_({
            nome: String(d[i][1] || ''), email: email, whatsapp: fone,
            dias: d[i][4] || '', estagio: 'cartao_iniciado',
            origem: 'trial-cartao', convertido: 'nao',
            evento: 'WhatsApp de recuperação enviado'
          });
        } catch (e) {}
      } else {
        res.falhas++;
        logAction(email, 'CRM_RECUP_FALHA', 'crm', '', (envio && envio.error) || '');
      }
    }

    if (res.enviados || res.falhas) {
      logAction('system', 'CRM_RECUPERACAO', 'crm', '', JSON.stringify(res));
    }
    return { ok: true, data: res };

  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ─────────────────────────────────────────────────────────────
// Rotas de admin
// ─────────────────────────────────────────────────────────────
function getRecuperacaoStatus(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  var trigger = false;
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'recuperarCheckoutsAbandonados') trigger = true;
    });
  } catch (e) {}

  var cfg = _clCfg_();
  return { ok: true, data: {
    ativo: cfg.ativo, trigger: trigger,
    esperaMin: cfg.esperaMin, limiteHoras: cfg.limiteHoras,
    template: String(_waCfg_('wa_tpl_recuperacao') || ''),
    templateVars: String(_waCfg_('wa_tpl_recuperacao_vars', '[]'))
  } };
}

function salvarRecuperacaoConfig(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  var d = data || {};

  setConfig_('crm_recup_ativo', d.ativo ? '1' : '');
  var e = parseInt(d.esperaMin, 10);   if (e > 0 && e <= 1440) setConfig_('crm_recup_espera_min', String(e));
  var l = parseInt(d.limiteHoras, 10); if (l > 0 && l <= 720)  setConfig_('crm_recup_limite_h', String(l));

  if (d.ativo) {
    try {
      var existe = false;
      ScriptApp.getProjectTriggers().forEach(function (t) {
        if (t.getHandlerFunction() === 'recuperarCheckoutsAbandonados') existe = true;
      });
      if (!existe) ScriptApp.newTrigger('recuperarCheckoutsAbandonados').timeBased().everyMinutes(15).create();
    } catch (er) {}
  }

  logAction(user.email, 'CRM_RECUP_CONFIG', 'crm', '', d.ativo ? 'ativo' : 'desligado');
  return { ok: true, message: d.ativo
    ? 'Recuperação ativa. O disparo roda a cada 15 minutos.'
    : 'Recuperação desligada.', data: _clCfg_() };
}

function rodarRecuperacaoAgora(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  var antes = _clCfg_().ativo;
  if (!antes) setConfig_('crm_recup_ativo', '1');
  var r = recuperarCheckoutsAbandonados();
  if (!antes) setConfig_('crm_recup_ativo', '');
  return r;
}
