// ============================================================
// trial_auto.gs — Automações pós-adesão do trial com cartão +
// Conversions API da Meta no funil (v144)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// Até a v143 o checkout coletava e validava tudo, mas NADA
// disparava depois: as funções de WhatsApp existiam sem ninguém
// chamá-las. Este arquivo é o maestro — e é chamado pelo webhook
// do Stripe, não pelo navegador, porque o redirect pode não
// acontecer (aba fechada, rede caindo) e mesmo assim a assinatura
// existe.
//
// CAPI: o evento que interessa para otimizar anúncio é o do fim
// do funil — pessoa que passou por e-mail verificado, WhatsApp
// válido, consentimento E cartão aceito. É esse público que a
// Meta deve procurar.
// ============================================================

function _taCfg_(chave, padrao) {
  try {
    var v = getConfig_(chave);
    return (v === '' || v == null) ? (padrao === undefined ? '' : padrao) : v;
  } catch (e) { return padrao === undefined ? '' : padrao; }
}
function _taBool_(chave, padrao) {
  var v = String(_taCfg_(chave, padrao ? 'true' : 'false')).toLowerCase();
  return v === 'true' || v === '1' || v === 'sim';
}

// Pixel: config manda, constante do meta_capi.gs é o fallback
function _capiPixelId_() {
  var p = String(_taCfg_('capi_pixel_id')).trim();
  return p || (typeof META_PIXEL_ID !== 'undefined' ? META_PIXEL_ID : '');
}
function _capiToken_() {
  return PropertiesService.getScriptProperties().getProperty('META_CAPI_TOKEN') || '';
}
function _capiAtivo_() { return _taBool_('capi_ativo', true) && !!_capiToken_(); }

// ─────────────────────────────────────────────────────────────
// Envia evento para a CAPI usando o pixel configurável.
// Reaproveita o hash e o formato do meta_capi.gs, mas com pixel
// e test code vindos do painel.
// ─────────────────────────────────────────────────────────────
function _capiEnviar_(eventName, opts) {
  if (!_capiAtivo_()) return { ok: false, error: 'CAPI desligada ou sem token' };
  opts = opts || {};
  try {
    var ud = {};
    if (opts.email) ud.em = [_capiHash_(opts.email)];
    if (opts.phone) {
      var ph = String(opts.phone).replace(/\D/g, '');
      if (ph && ph.indexOf('55') !== 0 && ph.length <= 11) ph = '55' + ph;
      ud.ph = [_capiHash_(ph)];
    }
    if (opts.first_name) ud.fn = [_capiHash_(opts.first_name)];
    if (opts.fbp)       ud.fbp = opts.fbp;
    if (opts.fbc)       ud.fbc = opts.fbc;
    if (opts.client_ip) ud.client_ip_address = opts.client_ip;
    if (opts.client_ua) ud.client_user_agent = opts.client_ua;

    var evt = {
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      event_source_url: opts.url || 'https://wpktavares.com.br/checkout-trial-cartao/',
      user_data: ud
    };
    if (opts.event_id) evt.event_id = opts.event_id;   // dedup com o Pixel
    if (opts.custom)   evt.custom_data = opts.custom;

    var body = { data: [evt] };
    var testCode = String(_taCfg_('capi_test_code')).trim() ||
                   PropertiesService.getScriptProperties().getProperty('META_TEST_EVENT_CODE');
    if (testCode) body.test_event_code = testCode;

    var url = 'https://graph.facebook.com/' + META_API_VER + '/' + _capiPixelId_() +
              '/events?access_token=' + encodeURIComponent(_capiToken_());

    var resp = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify(body), muteHttpExceptions: true
    });
    if (resp.getResponseCode() === 200) {
      logAction(opts.email || 'anon', 'CAPI_OK', 'meta', eventName, '');
      return { ok: true };
    }
    logAction(opts.email || 'anon', 'CAPI_HTTP_' + resp.getResponseCode(), 'meta',
              eventName, resp.getContentText().slice(0, 300));
    return { ok: false, error: 'HTTP ' + resp.getResponseCode() };
  } catch (e) {
    logAction('system', 'CAPI_ERRO', 'meta', eventName, e.message);
    return { ok: false, error: e.message };
  }
}

// ── Eventos do funil do trial ────────────────────────────────
// InitiateCheckout: e-mail verificado + WhatsApp + consentimento,
// indo para a tela do cartão. Já é um público qualificado.
function capiTrialIniciado_(ctx) {
  return _capiEnviar_('InitiateCheckout', {
    email: ctx.email, phone: ctx.whatsapp, first_name: (ctx.nome || '').split(' ')[0],
    event_id: 'ic_' + _capiHash_(ctx.email + '|' + (ctx.dias || '')).slice(0, 24),
    fbp: ctx.fbp, fbc: ctx.fbc, client_ua: ctx.client_ua, url: ctx.url,
    custom: { content_name: 'trial_' + (ctx.dias || '') + 'd', currency: 'BRL', value: 0 }
  });
}

// CompleteRegistration: cartão ACEITO pelo Stripe e trial rodando.
// É o evento que a campanha deve otimizar — só chega aqui quem tem
// cartão válido.
function capiTrialConcluido_(ctx) {
  return _capiEnviar_('CompleteRegistration', {
    email: ctx.email, phone: ctx.whatsapp, first_name: (ctx.nome || '').split(' ')[0],
    event_id: 'cr_' + _capiHash_(ctx.email + '|' + (ctx.subId || '')).slice(0, 24),
    url: 'https://wpktavares.com.br/checkout-trial-cartao/',
    custom: {
      content_name: 'trial_cartao_' + (ctx.dias || '') + 'd',
      currency: 'BRL',
      value: Number(ctx.valor || 17),          // valor esperado da 1ª cobrança
      predicted_ltv: Number(ctx.valor || 17) * 6
    }
  });
}

// Purchase: primeira cobrança de fato paga (invoice.paid pós-trial)
function capiTrialCobrado_(ctx) {
  return _capiEnviar_('Purchase', {
    email: ctx.email, phone: ctx.whatsapp,
    event_id: 'pu_' + _capiHash_(ctx.email + '|' + (ctx.invoiceId || '')).slice(0, 24),
    custom: { currency: 'BRL', value: Number(ctx.valor || 17) }
  });
}

// ─────────────────────────────────────────────────────────────
// Contexto do aluno: junta o que o checkout gravou no
// consentimento com o que o Stripe sabe da assinatura.
// ─────────────────────────────────────────────────────────────
function _taContexto_(email, sub) {
  var ctx = { email: String(email || '').toLowerCase().trim(), nome: '', whatsapp: '',
              dias: 0, valor: 17, dataCobranca: '', subId: (sub && sub.id) || '' };
  try {
    var aba = _tcAbaConsent_();
    var d = aba.getDataRange().getValues();
    var cab = d[0];
    var iE = cab.indexOf('email'), iW = cab.indexOf('whatsapp'), iN = cab.indexOf('nome'),
        iD = cab.indexOf('trial_dias'), iV = cab.indexOf('valor_pos_trial');
    // último consentimento do e-mail (varre de baixo pra cima)
    for (var i = d.length - 1; i >= 1; i--) {
      if (String(d[i][iE] || '').toLowerCase().trim() === ctx.email) {
        ctx.nome = String(d[i][iN] || '');
        ctx.whatsapp = String(d[i][iW] || '');
        ctx.dias = Number(d[i][iD]) || 0;
        ctx.valor = Number(d[i][iV]) || 17;
        break;
      }
    }
  } catch (e) {}

  // Data real da 1ª cobrança vem do Stripe, não do nosso cálculo
  try {
    var fim = sub && (sub.trial_end || sub.current_period_end);
    if (fim) ctx.dataCobranca = Utilities.formatDate(new Date(fim * 1000),
                                  'America/Sao_Paulo', 'dd/MM/yyyy');
  } catch (e) {}
  return ctx;
}

// ─────────────────────────────────────────────────────────────
// MAESTRO — chamado pelo webhook quando o trial com cartão nasce
// Cada canal é isolado: um falhando não derruba os outros.
// ─────────────────────────────────────────────────────────────
function dispararAutomacoesTrial_(email, sub) {
  var ctx = _taContexto_(email, sub);
  if (!ctx.email) return { ok: false, error: 'sem e-mail' };

  // Só dispara uma vez por assinatura, mesmo se o Stripe reenviar
  var chave = 'autotrial_' + _capiHash_(ctx.email + '|' + ctx.subId).slice(0, 30);
  try {
    var c = CacheService.getScriptCache();
    if (c.get(chave)) return { ok: true, jaDisparado: true };
    c.put(chave, '1', 6 * 3600);
  } catch (e) {}

  var r = { email: null, whatsapp: null, telegram: null, capi: null };

  if (_taBool_('auto_email_boasvindas', true)) {
    try {
      r.email = _taEmailBoasVindas_(ctx);
    } catch (e) { r.email = { ok: false, error: e.message }; }
  }

  try { r.whatsapp = waBoasVindasTrial_(ctx); }
  catch (e) { r.whatsapp = { ok: false, error: e.message }; }

  if (_taBool_('auto_telegram', true)) {
    try {
      if (typeof tgNotificarTrial_ === 'function') {
        tgNotificarTrial_(ctx.nome, ctx.email, ctx.whatsapp, ctx.dias);
        r.telegram = { ok: true };
      }
    } catch (e) { r.telegram = { ok: false, error: e.message }; }
  }

  try { r.capi = capiTrialConcluido_(ctx); }
  catch (e) { r.capi = { ok: false, error: e.message }; }

  logAction(ctx.email, 'TRIAL_AUTOMACOES', 'trial', ctx.subId,
            'mail=' + _taSt_(r.email) + ' wa=' + _taSt_(r.whatsapp) +
            ' tg=' + _taSt_(r.telegram) + ' capi=' + _taSt_(r.capi));
  return { ok: true, resultado: r };
}
function _taSt_(x) { return !x ? 'off' : (x.ok ? 'ok' : 'erro'); }

// ── E-mail de boas-vindas do trial com cartão ────────────────
function _taEmailBoasVindas_(ctx) {
  var primeiro = String(ctx.nome || '').split(/\s+/)[0] || '';
  var html =
  '<div style="margin:0;padding:28px 16px;background:#f4f6f4;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">' +
    '<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 14px rgba(0,0,0,.07)">' +
      '<div style="background:linear-gradient(135deg,#4caf50,#2e7d32);padding:24px 26px">' +
        '<div style="color:rgba(255,255,255,.72);font-size:11px;letter-spacing:2px;text-transform:uppercase">WPK Tavares</div>' +
        '<div style="color:#fff;font-size:19px;font-weight:800;margin-top:4px">Seu teste comecou</div>' +
      '</div>' +
      '<div style="padding:26px;color:#2c3a30;font-size:14.5px;line-height:1.7">' +
        (primeiro ? '<p style="margin:0 0 14px">Oi, ' + primeiro + '!</p>' : '') +
        '<p style="margin:0 0 18px">Seu periodo de teste no <b>Desafio 21 Dias</b> esta ativo. ' +
        'Nada foi cobrado agora.</p>' +
        '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
          '<tr><td style="padding:7px 0;color:#7a8a7e">Duracao</td>' +
              '<td style="padding:7px 0;text-align:right;font-weight:700">' + ctx.dias + ' dias</td></tr>' +
          '<tr><td style="padding:7px 0;color:#7a8a7e">Primeira cobranca</td>' +
              '<td style="padding:7px 0;text-align:right;font-weight:700">' + (ctx.dataCobranca || '-') + '</td></tr>' +
          '<tr><td style="padding:7px 0;color:#7a8a7e">Valor a partir de entao</td>' +
              '<td style="padding:7px 0;text-align:right;font-weight:700">R$ ' + ctx.valor + ',00/mes</td></tr>' +
        '</table>' +
        '<div style="text-align:center;margin:26px 0 18px">' +
          '<a href="https://app.wpktavares.com.br" style="display:inline-block;' +
            'background:linear-gradient(135deg,#4caf50,#2e7d32);color:#fff;text-decoration:none;' +
            'padding:14px 32px;border-radius:11px;font-weight:800;font-size:15px">Acessar o app</a>' +
        '</div>' +
        '<p style="margin:0;color:#7a8a7e;font-size:13px">Pode cancelar pelo app a qualquer momento antes ' +
        'da data acima — nesse caso, nenhum valor e cobrado. Avisaremos por e-mail antes da primeira cobranca.</p>' +
      '</div>' +
      '<div style="padding:16px 26px;border-top:1px solid #eef1ee;color:#8a9a8e;font-size:11.5px">' +
        'WPK Tavares - Equipe Lapidados' +
      '</div>' +
    '</div>' +
  '</div>';

  _enviarEmailWpk_(ctx.email, 'Seu teste do Desafio 21 Dias comecou',
    'Seu periodo de teste esta ativo. Primeira cobranca em ' + (ctx.dataCobranca || '-') +
    ', R$ ' + ctx.valor + ',00/mes. Cancele pelo app antes disso se nao quiser continuar.', html);
  return { ok: true };
}

// ═════════════════════════════════════════════════════════════
// ROTAS ADMIN — configuração do Pixel + CAPI
// ═════════════════════════════════════════════════════════════
function capiStatus(token) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  var t = _capiToken_();
  return {
    ok: true,
    data: {
      ativo: _taBool_('capi_ativo', true),
      pixelId: _capiPixelId_(),
      temToken: !!t,
      tokenMascarado: t ? ('••••••••' + t.slice(-4)) : '',
      testCode: String(_taCfg_('capi_test_code')),
      eventos: {
        InitiateCheckout: 'e-mail verificado + WhatsApp + consentimento (indo pro cartão)',
        CompleteRegistration: 'cartão aceito e teste rodando — otimize por este',
        Purchase: 'primeira cobrança paga após o teste'
      }
    }
  };
}

function capiSalvarConfig(token, cfg) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  cfg = cfg || {};
  if (cfg.ativo    !== undefined) setConfig_('capi_ativo', cfg.ativo ? 'true' : 'false');
  if (cfg.pixelId  !== undefined) setConfig_('capi_pixel_id', String(cfg.pixelId).trim());
  if (cfg.testCode !== undefined) setConfig_('capi_test_code', String(cfg.testCode).trim());
  // Token vazio NÃO apaga o que já existe (o painel mostra mascarado)
  if (String(cfg.token || '').trim()) {
    PropertiesService.getScriptProperties().setProperty('META_CAPI_TOKEN', String(cfg.token).trim());
  }
  logAction(user.email, 'CAPI_CONFIG_SALVA', 'config', '', '');
  return { ok: true };
}

function capiTestar(token) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  if (!_capiToken_()) return { ok: false, error: 'Token da CAPI não configurado.' };

  var r = _capiEnviar_('CompleteRegistration', {
    email: user.email, first_name: String(user.name || '').split(' ')[0],
    event_id: 'teste_' + Date.now(),
    custom: { content_name: 'teste_painel', currency: 'BRL', value: 17 }
  });
  return r.ok
    ? { ok: true, message: 'Evento enviado ao pixel ' + _capiPixelId_() +
        (String(_taCfg_('capi_test_code')).trim() ? ' (em Eventos de teste)' : ' (produção)') }
    : { ok: false, error: r.error };
}

// ═════════════════════════════════════════════════════════════
// RÉGUA DE LEMBRETE — v145
// UM aviso só, por padrão 2 dias antes do fim do teste. Se o
// aluno não cancelar, a cobrança segue automaticamente: o
// lembrete é cortesia e obrigação legal, não pedido de permissão.
//
// O "já enviei" fica na METADATA da assinatura no Stripe, não em
// cache nem planilha: dura o que a assinatura durar e sobrevive a
// qualquer limpeza nossa. CacheService morre em 6h e não serviria.
// ═════════════════════════════════════════════════════════════
function _taDiasLembrete_() {
  var bruto = String(_taCfg_('lembrete_dias', '2'));
  var n = parseInt(bruto.split(',')[0], 10);   // só o primeiro: é um lembrete só
  return (!isNaN(n) && n >= 1 && n <= 15) ? n : 2;
}

// Roda todo dia por trigger. Varre quem está em trial no Stripe.
function enviarLembretesTrial() {
  if (!_taBool_('auto_lembretes', true)) return { ok: true, desligado: true };
  if (typeof stripeConfigurado_ !== 'function' || !stripeConfigurado_()) {
    return { ok: false, error: 'Stripe não configurado.' };
  }

  var alvo = _taDiasLembrete_();
  var agora = Math.floor(Date.now() / 1000);
  // Janela do dia-alvo: entre alvo e alvo+1 dias a partir de agora
  var de  = agora + (alvo - 1) * 86400;
  var ate = agora + alvo * 86400;

  var resumo = { verificadas: 0, enviados: 0, pulados: 0, erros: 0, alvo: alvo };
  var starting = '';

  for (var pagina = 0; pagina < 10; pagina++) {   // teto de segurança
    var q = '/v1/subscriptions?status=trialing&limit=100' +
            (starting ? '&starting_after=' + encodeURIComponent(starting) : '');
    var lote = _stripeCall_('get', q);
    if (!lote || lote._error || !lote.data) break;

    for (var i = 0; i < lote.data.length; i++) {
      var sub = lote.data[i];
      resumo.verificadas++;
      var fim = Number(sub.trial_end || 0);
      if (!fim || fim < de || fim > ate) { resumo.pulados++; continue; }
      if (sub.metadata && String(sub.metadata.lembrete_enviado) === '1') { resumo.pulados++; continue; }

      try {
        var email = _stripeEmailDaSub_(sub);
        if (!email) { resumo.pulados++; continue; }
        var ctx = _taContexto_(email, sub);
        ctx.diasRestantes = alvo;

        if (_taBool_('auto_email_boasvindas', true)) _taEmailLembrete_(ctx);
        try { waLembreteTrial_(ctx); } catch (e) {}

        // Marca NA ASSINATURA — fonte durável de "já avisei"
        _stripeCall_('post', '/v1/subscriptions/' + encodeURIComponent(sub.id),
                     { 'metadata[lembrete_enviado]': '1' });

        logAction(email, 'TRIAL_LEMBRETE', 'trial', sub.id, alvo + ' dias antes');
        resumo.enviados++;
      } catch (e) {
        resumo.erros++;
        logAction('system', 'TRIAL_LEMBRETE_ERRO', 'trial', sub.id, e.message);
      }
    }

    if (!lote.has_more) break;
    starting = lote.data[lote.data.length - 1].id;
  }

  logAction('system', 'TRIAL_LEMBRETES_RODOU', 'trial', '', JSON.stringify(resumo));
  return { ok: true, data: resumo };
}

// E-mail do lembrete — tom neutro, informativo, sem pressão
function _taEmailLembrete_(ctx) {
  var primeiro = String(ctx.nome || '').split(/\s+/)[0] || '';
  var dias = ctx.diasRestantes || 2;
  var html =
  '<div style="margin:0;padding:28px 16px;background:#f4f6f4;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">' +
    '<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 14px rgba(0,0,0,.07)">' +
      '<div style="background:linear-gradient(135deg,#4caf50,#2e7d32);padding:24px 26px">' +
        '<div style="color:rgba(255,255,255,.72);font-size:11px;letter-spacing:2px;text-transform:uppercase">WPK Tavares</div>' +
        '<div style="color:#fff;font-size:19px;font-weight:800;margin-top:4px">Seu teste termina em ' + dias + ' dias</div>' +
      '</div>' +
      '<div style="padding:26px;color:#2c3a30;font-size:14.5px;line-height:1.7">' +
        (primeiro ? '<p style="margin:0 0 14px">Oi, ' + primeiro + '.</p>' : '') +
        '<p style="margin:0 0 18px">Passando para avisar antes que aconteca, e nao depois.</p>' +
        '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
          '<tr><td style="padding:7px 0;color:#7a8a7e">Data da cobranca</td>' +
              '<td style="padding:7px 0;text-align:right;font-weight:700">' + (ctx.dataCobranca || '-') + '</td></tr>' +
          '<tr><td style="padding:7px 0;color:#7a8a7e">Valor</td>' +
              '<td style="padding:7px 0;text-align:right;font-weight:700">R$ ' + (ctx.valor || 17) + ',00/mes</td></tr>' +
        '</table>' +
        '<p style="margin:18px 0 0">Se quiser continuar, <b>nao precisa fazer nada</b>. A cobranca acontece ' +
        'sozinha no cartao cadastrado e seu acesso segue sem interrupcao.</p>' +
        '<p style="margin:14px 0 0">Se preferir parar, cancele pelo app antes dessa data e <b>nada sera cobrado</b>.</p>' +
        '<div style="text-align:center;margin:24px 0 6px">' +
          '<a href="https://app.wpktavares.com.br" style="display:inline-block;' +
            'background:linear-gradient(135deg,#4caf50,#2e7d32);color:#fff;text-decoration:none;' +
            'padding:13px 30px;border-radius:11px;font-weight:800;font-size:14.5px">Abrir o app</a>' +
        '</div>' +
      '</div>' +
      '<div style="padding:16px 26px;border-top:1px solid #eef1ee;color:#8a9a8e;font-size:11.5px">' +
        'WPK Tavares - Equipe Lapidados' +
      '</div>' +
    '</div>' +
  '</div>';

  _enviarEmailWpk_(ctx.email, 'Seu teste termina em ' + dias + ' dias',
    'Seu periodo de teste termina em ' + dias + ' dias. Cobranca em ' + (ctx.dataCobranca || '-') +
    ', R$ ' + (ctx.valor || 17) + ',00/mes. Para continuar nao precisa fazer nada; para parar, cancele pelo app antes.',
    html);
  return { ok: true };
}

// Cria o trigger diário (rodar 1x no editor, ou pelo painel)
function setupLembretesTrial() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'enviarLembretesTrial') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('enviarLembretesTrial').timeBased().everyDays(1).atHour(9).create();
  return 'Trigger diário criado (9h).';
}

// ROTA ADMIN: liga o trigger e/ou roda agora
function lembretesAcao(token, data) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  var acao = String((data || {}).acao || '');
  if (acao === 'ativar') return { ok: true, message: setupLembretesTrial() };
  if (acao === 'rodar')  return enviarLembretesTrial();
  return { ok: false, error: 'Ação inválida.' };
}
