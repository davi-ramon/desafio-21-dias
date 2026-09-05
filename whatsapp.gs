// ============================================================
// whatsapp.gs — WhatsApp Cloud API (Meta oficial) + automações
// configuráveis do trial (v143)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// As credenciais vivem na aba `config`, nunca no frontend. O
// token só sai daqui MASCARADO — o painel mostra os 4 últimos
// dígitos para conferência e nada mais.
//
// Templates: a Meta exige mensagem aprovada para iniciar conversa
// fora da janela de 24h. Por isso o admin escolhe o template pelo
// nome e mapeia cada {{n}} para um dado nosso.
// ============================================================

var WA_API_VER = 'v21.0';

// ── Config ───────────────────────────────────────────────────
function _waCfg_(chave, padrao) {
  try {
    var v = getConfig_(chave);
    return (v === '' || v == null) ? (padrao === undefined ? '' : padrao) : v;
  } catch (e) { return padrao === undefined ? '' : padrao; }
}
function _waBool_(chave, padrao) {
  var v = String(_waCfg_(chave, padrao ? 'true' : 'false')).toLowerCase();
  return v === 'true' || v === '1' || v === 'sim';
}
function _waToken_()  { return String(_waCfg_('wa_token')).trim(); }
function _waWaba_()   { return String(_waCfg_('wa_waba_id')).trim(); }
function _waPhone_()  { return String(_waCfg_('wa_phone_id')).trim(); }
function _waPronto_() { return !!(_waToken_() && _waWaba_() && _waPhone_()); }

function _waMascarar_(s) {
  s = String(s || '');
  if (!s) return '';
  return s.length <= 8 ? '••••' : '••••••••' + s.slice(-4);
}

// ── Chamada à Graph API ──────────────────────────────────────
function _waCall_(metodo, caminho, corpo) {
  var url = 'https://graph.facebook.com/' + WA_API_VER + caminho;
  var opts = {
    method: metodo,
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + _waToken_() }
  };
  if (corpo) {
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(corpo);
  }
  try {
    var resp = UrlFetchApp.fetch(url, opts);
    var txt  = resp.getContentText();
    var json = {};
    try { json = JSON.parse(txt); } catch (e) { json = { _raw: txt }; }
    if (resp.getResponseCode() >= 400) {
      var m = (json.error && json.error.message) || ('HTTP ' + resp.getResponseCode());
      return { _error: true, message: m, code: resp.getResponseCode() };
    }
    return json;
  } catch (e) {
    return { _error: true, message: e.message };
  }
}

// ── Quantas variáveis {{n}} o template usa no corpo ──────────
function _waContarVars_(componentes) {
  var maior = 0;
  (componentes || []).forEach(function (c) {
    if (String(c.type).toUpperCase() !== 'BODY') return;
    var txt = String(c.text || '');
    var m = txt.match(/\{\{\s*(\d+)\s*\}\}/g) || [];
    m.forEach(function (x) {
      var n = parseInt(String(x).replace(/\D/g, ''), 10);
      if (n > maior) maior = n;
    });
  });
  return maior;
}

function _waTextoBody_(componentes) {
  var t = '';
  (componentes || []).forEach(function (c) {
    if (String(c.type).toUpperCase() === 'BODY') t = String(c.text || '');
  });
  return t;
}

// ─────────────────────────────────────────────────────────────
// ROTA ADMIN: waListarTemplates — alimenta o menu suspenso
// ─────────────────────────────────────────────────────────────
function waListarTemplates(token) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  if (!_waPronto_()) return { ok: false, error: 'Configure token, WABA ID e Phone ID antes de listar.' };

  var r = _waCall_('get', '/' + encodeURIComponent(_waWaba_()) +
                   '/message_templates?limit=100&fields=name,language,status,category,components');
  if (r._error) return { ok: false, error: r.message };

  var lista = (r.data || []).map(function (t) {
    return {
      nome: String(t.name || ''),
      idioma: String(t.language || ''),
      status: String(t.status || ''),
      categoria: String(t.category || ''),
      variaveis: _waContarVars_(t.components),
      corpo: _waTextoBody_(t.components).slice(0, 220)
    };
  }).filter(function (t) { return t.status === 'APPROVED'; });

  lista.sort(function (a, b) { return a.nome.localeCompare(b.nome); });
  return { ok: true, data: lista, total: lista.length };
}

// ─────────────────────────────────────────────────────────────
// ROTA ADMIN: waStatus — estado atual, com token mascarado
// ─────────────────────────────────────────────────────────────
function waStatus(token) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };

  var conectado = false, numero = '', erroConexao = '';
  if (_waPronto_()) {
    var r = _waCall_('get', '/' + encodeURIComponent(_waPhone_()) + '?fields=display_phone_number,verified_name');
    if (r._error) erroConexao = r.message;
    else { conectado = true; numero = (r.display_phone_number || '') + ' · ' + (r.verified_name || ''); }
  }

  return {
    ok: true,
    data: {
      tokenMascarado: _waMascarar_(_waToken_()),
      temToken: !!_waToken_(),
      wabaId:  _waWaba_(),
      phoneId: _waPhone_(),
      conectado: conectado,
      numero: numero,
      erroConexao: erroConexao,
      // Automações
      autoEmailOtp:        _waBool_('auto_email_otp', true),
      autoEmailBoasVindas: _waBool_('auto_email_boasvindas', true),
      autoWhatsBoasVindas: _waBool_('auto_whats_boasvindas', false),
      autoTelegram:        _waBool_('auto_telegram', true),
      autoLembretes:       _waBool_('auto_lembretes', true),
      lembreteDias:        String(_waCfg_('lembrete_dias', '2')),
      // Templates escolhidos
      tplBoasVindas:      String(_waCfg_('wa_tpl_boasvindas')),
      tplBoasVindasLang:  String(_waCfg_('wa_tpl_boasvindas_lang', 'pt_BR')),
      tplBoasVindasVars:  String(_waCfg_('wa_tpl_boasvindas_vars', '[]')),
      tplLembrete:        String(_waCfg_('wa_tpl_lembrete')),
      tplLembreteLang:    String(_waCfg_('wa_tpl_lembrete_lang', 'pt_BR')),
      tplLembreteVars:    String(_waCfg_('wa_tpl_lembrete_vars', '[]'))
    }
  };
}

// ─────────────────────────────────────────────────────────────
// ROTA ADMIN: waSalvarConfig
// Campo de token vazio NÃO apaga o token guardado — o painel
// mostra mascarado, então salvar sem digitar não pode limpar.
// ─────────────────────────────────────────────────────────────
function waSalvarConfig(token, cfg) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  cfg = cfg || {};

  if (String(cfg.token || '').trim()) setConfig_('wa_token', String(cfg.token).trim());
  if (cfg.wabaId  !== undefined) setConfig_('wa_waba_id',  String(cfg.wabaId).trim());
  if (cfg.phoneId !== undefined) setConfig_('wa_phone_id', String(cfg.phoneId).trim());

  ['autoEmailOtp:auto_email_otp',
   'autoEmailBoasVindas:auto_email_boasvindas',
   'autoWhatsBoasVindas:auto_whats_boasvindas',
   'autoTelegram:auto_telegram',
   'autoLembretes:auto_lembretes'].forEach(function (par) {
    var p = par.split(':');
    if (cfg[p[0]] !== undefined) setConfig_(p[1], cfg[p[0]] ? 'true' : 'false');
  });

  if (cfg.lembreteDias !== undefined) {
    var dias = String(cfg.lembreteDias).split(',')
      .map(function (x) { return parseInt(x, 10); })
      .filter(function (x) { return !isNaN(x) && x >= 1 && x <= 15; })
      .filter(function (x, i, a) { return a.indexOf(x) === i; })
      .sort(function (a, b) { return b - a; });
    // v145: UM lembrete so — guarda apenas o primeiro valor
    setConfig_('lembrete_dias', String(dias[0] || 2));
  }

  [['tplBoasVindas','wa_tpl_boasvindas'], ['tplBoasVindasLang','wa_tpl_boasvindas_lang'],
   ['tplBoasVindasVars','wa_tpl_boasvindas_vars'], ['tplLembrete','wa_tpl_lembrete'],
   ['tplLembreteLang','wa_tpl_lembrete_lang'], ['tplLembreteVars','wa_tpl_lembrete_vars']
  ].forEach(function (p) {
    if (cfg[p[0]] !== undefined) setConfig_(p[1], String(cfg[p[0]]));
  });

  logAction(user.email, 'WA_CONFIG_SALVA', 'config', '', '');
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Fontes de variável — o que o admin pode plugar em cada {{n}}
// ─────────────────────────────────────────────────────────────
function _waResolverVar_(fonte, ctx) {
  ctx = ctx || {};
  var nome = String(ctx.nome || '').trim();
  switch (String(fonte)) {
    case 'primeiro_nome': return nome.split(/\s+/)[0] || 'Olá';
    case 'nome_completo': return nome || 'Olá';
    case 'dias_trial':    return String(ctx.dias || '');
    case 'data_cobranca': return String(ctx.dataCobranca || '');
    case 'valor':         return String(ctx.valor || '17,00');
    case 'email':         return String(ctx.email || '');
    default:              return String(fonte || '');   // texto fixo
  }
}

// Monta os parâmetros do BODY na ordem que a Meta espera
function _waParams_(mapaJson, ctx) {
  var mapa = [];
  try { mapa = JSON.parse(mapaJson || '[]'); } catch (e) { mapa = []; }
  return mapa.map(function (fonte) {
    return { type: 'text', text: _waResolverVar_(fonte, ctx) };
  });
}

// ─────────────────────────────────────────────────────────────
// Envio de template
// ─────────────────────────────────────────────────────────────
function _waEnviarTemplate_(paraE164, nomeTpl, idioma, params) {
  if (!_waPronto_()) return { ok: false, error: 'WhatsApp não configurado.' };
  if (!nomeTpl)      return { ok: false, error: 'Template não escolhido.' };

  var destino = String(paraE164 || '').replace(/\D/g, '');
  if (!destino) return { ok: false, error: 'Número inválido.' };

  var corpo = {
    messaging_product: 'whatsapp',
    to: destino,
    type: 'template',
    template: {
      name: nomeTpl,
      language: { code: idioma || 'pt_BR' }
    }
  };
  if (params && params.length) {
    corpo.template.components = [{ type: 'body', parameters: params }];
  }

  var r = _waCall_('post', '/' + encodeURIComponent(_waPhone_()) + '/messages', corpo);
  if (r._error) {
    logAction(destino, 'WA_ENVIO_FALHOU', 'whatsapp', nomeTpl, r.message);
    return { ok: false, error: r.message };
  }
  var id = (r.messages && r.messages[0] && r.messages[0].id) || '';
  logAction(destino, 'WA_ENVIADO', 'whatsapp', nomeTpl, id);
  return { ok: true, id: id };
}

// Boas-vindas do trial — chamado pela automação pós-adesão
function waBoasVindasTrial_(ctx) {
  if (!_waBool_('auto_whats_boasvindas', false)) return { ok: false, error: 'desligado' };
  return _waEnviarTemplate_(
    ctx.whatsapp,
    _waCfg_('wa_tpl_boasvindas'),
    _waCfg_('wa_tpl_boasvindas_lang', 'pt_BR'),
    _waParams_(_waCfg_('wa_tpl_boasvindas_vars', '[]'), ctx)
  );
}

// Lembrete antes da cobrança
function waLembreteTrial_(ctx) {
  if (!_waBool_('auto_lembretes', true)) return { ok: false, error: 'desligado' };
  return _waEnviarTemplate_(
    ctx.whatsapp,
    _waCfg_('wa_tpl_lembrete'),
    _waCfg_('wa_tpl_lembrete_lang', 'pt_BR'),
    _waParams_(_waCfg_('wa_tpl_lembrete_vars', '[]'), ctx)
  );
}

// ─────────────────────────────────────────────────────────────
// ROTA ADMIN: waTestar — dispara no número do próprio admin
// ─────────────────────────────────────────────────────────────
function waTestar(token, data) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  data = data || {};

  var tel = _tcE164_(data.numero);
  if (!tel.ok) return { ok: false, error: tel.erro };

  var ctx = {
    nome: data.nome || user.name || 'Teste',
    email: user.email,
    dias: data.dias || 14,
    dataCobranca: Utilities.formatDate(
      new Date(Date.now() + (Number(data.dias) || 14) * 86400000),
      'America/Sao_Paulo', 'dd/MM/yyyy'),
    valor: '17,00',
    whatsapp: tel.e164
  };

  var r = _waEnviarTemplate_(tel.e164, data.template,
            data.idioma || 'pt_BR', _waParams_(data.vars || '[]', ctx));
  if (!r.ok) return r;
  return { ok: true, message: 'Enviado para ' + tel.e164, id: r.id };
}
