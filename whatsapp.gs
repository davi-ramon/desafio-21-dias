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
  // v172: quem usa o CRM (admin e usuário de CRM) dispara templates do lead
  if (!user || (user.role !== 'admin' && user.role !== 'user')) return { ok: false, error: 'Sem permissão.' };
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
      tplLembreteVars:    String(_waCfg_('wa_tpl_lembrete_vars', '[]')),
      tplRecuperacao:     String(_waCfg_('wa_tpl_recuperacao')),
      tplRecuperacaoLang: String(_waCfg_('wa_tpl_recuperacao_lang', 'pt_BR')),
      tplRecuperacaoVars: String(_waCfg_('wa_tpl_recuperacao_vars', '[]')),
      // v166: teste sem cartão + app
      autoWhatsBoasVindasSc: _waSemCartaoLigado_(),
      tplBoasVindasSc:      String(_waCfg_('wa_tpl_boasvindas_sc')),
      tplBoasVindasScLang:  String(_waCfg_('wa_tpl_boasvindas_sc_lang', 'pt_BR')),
      tplBoasVindasScVars:  String(_waCfg_('wa_tpl_boasvindas_sc_vars', '[]')),
      boasVindasScEfetivo:  (function () { var t = _waTplSemCartao_(); return t ? { nome: t.nome, proprio: t.proprio } : null; })(),
      trialDiasApp:         (typeof _trialDiasApp_ === 'function') ? _trialDiasApp_() : 7
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

  // v166: dias do teste grátis de quem se cadastra pelo app
  if (cfg.trialDiasApp !== undefined) {
    var dApp = parseInt(cfg.trialDiasApp, 10);
    if ([7, 14, 21].indexOf(dApp) >= 0) setConfig_('trial_dias_app', String(dApp));
  }

  ['autoEmailOtp:auto_email_otp',
   'autoEmailBoasVindas:auto_email_boasvindas',
   'autoWhatsBoasVindas:auto_whats_boasvindas',
   'autoWhatsBoasVindasSc:auto_whats_boasvindas_sc',
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
   ['tplLembreteLang','wa_tpl_lembrete_lang'], ['tplLembreteVars','wa_tpl_lembrete_vars'],
   ['tplRecuperacao','wa_tpl_recuperacao'], ['tplRecuperacaoLang','wa_tpl_recuperacao_lang'],
   ['tplRecuperacaoVars','wa_tpl_recuperacao_vars'],
   ['tplBoasVindasSc','wa_tpl_boasvindas_sc'], ['tplBoasVindasScLang','wa_tpl_boasvindas_sc_lang'],
   ['tplBoasVindasScVars','wa_tpl_boasvindas_sc_vars']
  ].forEach(function (p) {
    if (cfg[p[0]] !== undefined) setConfig_(p[1], String(cfg[p[0]]));
  });

  logAction(user.email, 'WA_CONFIG_SALVA', 'config', '', '');
  if (typeof _ritoLimparCache_ === 'function') _ritoLimparCache_();
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Fontes de variável — o que o admin pode plugar em cada {{n}}
// ─────────────────────────────────────────────────────────────
// v171: NUNCA devolve vazio. A Meta recusa parâmetro em branco com #131008
// "Required parameter is missing" — foi o que travou o WhatsApp do sem
// cartão: o template do cartão usa {{3}} = data da cobrança ("Até {{3}} é
// tudo por nossa conta"), e quem entrou sem cartão não tem cobrança. Para
// essa pessoa, a data que faz sentido é o último dia do teste.
function _waResolverVar_(fonte, ctx) {
  ctx = ctx || {};
  var nome = String(ctx.nome || '').trim();
  var dias = Number(ctx.dias) || 7;
  var fimDoTeste = function () {
    return String(ctx.fimTeste || ctx.dataCobranca ||
      Utilities.formatDate(new Date(Date.now() + dias * 86400000), 'America/Sao_Paulo', 'dd/MM/yyyy'));
  };
  // v172: "txt:..." = texto literal (digitado no CRM), nunca interpretado
  if (String(fonte).indexOf('txt:') === 0) return String(fonte).slice(4).trim() || '-';
  switch (String(fonte)) {
    case 'primeiro_nome': return nome.split(/\s+/)[0] || 'Olá';
    case 'nome_completo': return nome || 'Olá';
    case 'dias_trial':    return String(dias);
    case 'fim_teste':     return fimDoTeste();
    case 'data_cobranca': return String(ctx.dataCobranca || fimDoTeste());
    case 'valor':         return String(ctx.valor || '17,00');
    case 'email':         return String(ctx.email || '').trim() || '-';
    default:              return String(fonte || '').trim() || '-';   // texto fixo
  }
}

// Fonte padrão para uma variável sem mapeamento salvo (inclusive as com
// NOME, como {{nome}} ou {{data_fim}}): adivinha pelo nome, nunca vazio.
function _waFontePadrao_(varNome, pos) {
  var n = String(varNome || '').toLowerCase();
  if (/nome/.test(n))                 return 'primeiro_nome';
  if (/dia/.test(n))                  return 'dias_trial';
  if (/data|fim|ate|prazo/.test(n))   return 'fim_teste';
  if (/valor|preco|mensal/.test(n))   return 'valor';
  if (/mail/.test(n))                 return 'email';
  return pos === 0 ? 'primeiro_nome' : '-';
}

var WA_IMAGEM_PADRAO = 'https://wpktavares.com.br/icons/icon-512.png';

// Monta TUDO o que o template exige, a partir da estrutura lida na Meta.
// mapa: array (variáveis numeradas, na ordem) ou objeto { nomeDaVar: fonte }
function _waComponentes_(est, mapaJson, ctx) {
  var mapa;
  try { mapa = JSON.parse(mapaJson || '[]'); } catch (e) { mapa = []; }
  var nomeado = est.formato === 'NAMED';
  var fonte = function (v, i) {
    var f = Array.isArray(mapa) ? mapa[i] : (mapa && mapa[v]);
    return f || _waFontePadrao_(v, i);
  };
  var param = function (v, i, fonteFixa) {
    var p = { type: 'text', text: _waResolverVar_(fonteFixa || fonte(v, i), ctx) };
    if (nomeado) p.parameter_name = v;
    return p;
  };
  var comps = [];

  if (est.header) {
    var f = est.header.formato;
    if (f === 'TEXT' && est.header.vars && est.header.vars.length) {
      comps.push({ type: 'header', parameters: est.header.vars.map(function (v, i) { return param(v, i, 'primeiro_nome'); }) });
    } else if (f === 'IMAGE' || f === 'VIDEO' || f === 'DOCUMENT') {
      var link = String(_waCfg_('wa_header_midia_url')).trim() || (f === 'IMAGE' ? WA_IMAGEM_PADRAO : '');
      if (link) {
        var tipo = f.toLowerCase(), pm = { type: tipo };
        pm[tipo] = { link: link };
        comps.push({ type: 'header', parameters: [pm] });
      }
    }
  }

  var vars = (est.corpo && est.corpo.vars) || [];
  if (vars.length) comps.push({ type: 'body', parameters: vars.map(function (v, i) { return param(v, i); }) });

  (est.botoes || []).forEach(function (b) {
    if (b.tipo === 'URL' && b.temVar) {
      comps.push({ type: 'button', sub_type: 'url', index: String(b.indice),
                   parameters: [{ type: 'text', text: String(_waCfg_('wa_botao_sufixo', '?entrar=1')) }] });
    } else if (b.tipo === 'COPY_CODE') {
      comps.push({ type: 'button', sub_type: 'copy_code', index: String(b.indice),
                   parameters: [{ type: 'coupon_code', coupon_code: String(_waCfg_('wa_cupom', 'DESAFIO21')) }] });
    }
  });
  return comps;
}

// ─────────────────────────────────────────────────────────────
// v171 — ESTRUTURA DO TEMPLATE (o que ele EXIGE no envio)
// A Meta recusa com #131008 "Required parameter is missing" quando falta
// qualquer parte variável: cabeçalho com imagem/vídeo/documento ou texto
// com {{1}}, botão de link com parte variável, código de cupom — ou
// variável com NOME ({{nome}}) em vez de número. Até a v170 o envio só
// preenchia o corpo com variáveis numeradas.
// ─────────────────────────────────────────────────────────────
function _waEstrutura_(nome, idioma) {
  if (!nome || !_waPronto_()) return null;
  var c = CacheService.getScriptCache(), k = 'wa_est_' + nome + '_' + (idioma || '');
  var g = c.get(k);
  if (g) { try { return JSON.parse(g); } catch (e) {} }
  var r = _waCall_('get', '/' + encodeURIComponent(_waWaba_()) + '/message_templates?name=' + encodeURIComponent(nome) +
                   '&fields=name,status,category,language,components,parameter_format&limit=20');
  if (r._error) return { erro: String(r.message || '').slice(0, 200) };
  var lista = (r.data || []).filter(function (x) { return String(x.name) === nome; });
  var t = lista.filter(function (x) { return x.status === 'APPROVED' && (!idioma || x.language === idioma); })[0] ||
          lista.filter(function (x) { return x.status === 'APPROVED'; })[0] || lista[0];
  if (!t) return { status: 'NAO_EXISTE' };

  var nomeados = String(t.parameter_format || '').toUpperCase() === 'NAMED';
  var est = { status: String(t.status || ''), categoria: String(t.category || ''), idioma: String(t.language || ''),
              formato: nomeados ? 'NAMED' : 'POSITIONAL', header: null, corpo: { vars: [] }, botoes: [] };
  (t.components || []).forEach(function (comp) {
    var tipo = String(comp.type || '').toUpperCase();
    if (tipo === 'HEADER') {
      var fmt = String(comp.format || 'TEXT').toUpperCase();
      est.header = { formato: fmt, vars: fmt === 'TEXT' ? _waVarsDoTexto_(comp.text) : [] };
    } else if (tipo === 'BODY') {
      est.corpo = { vars: _waVarsDoTexto_(comp.text), texto: String(comp.text || '').slice(0, 1100) };
    } else if (tipo === 'BUTTONS') {
      (comp.buttons || []).forEach(function (b, i) {
        var bt = String(b.type || '').toUpperCase();
        est.botoes.push({ tipo: bt, indice: i, url: String(b.url || ''),
                          temVar: bt === 'URL' && /\{\{[^}]+\}\}/.test(String(b.url || '')) });
      });
    }
  });
  try { c.put(k, JSON.stringify(est), 600); } catch (e) {}
  return est;
}

// Variáveis de um texto, na ordem: ['1','2'] (numeradas) ou ['nome','data'] (com nome)
function _waVarsDoTexto_(texto) {
  var vistas = [], m, re = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
  while ((m = re.exec(String(texto || '')))) { if (vistas.indexOf(m[1]) < 0) vistas.push(m[1]); }
  if (vistas.length && vistas.every(function (v) { return /^\d+$/.test(v); })) {
    vistas.sort(function (a, b) { return Number(a) - Number(b); });
  }
  return vistas;
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
// v171: `extras` = { mapaJson, ctx } → monta o envio pela ESTRUTURA do
// template (cabeçalho, corpo, botões, variáveis com nome). Sem `extras`, ou
// se a Meta não responder a estrutura, cai no envio antigo (só o corpo).
function _waEnviarTemplate_(paraE164, nomeTpl, idioma, params, extras) {
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
  var comps = null;
  if (extras && extras.mapaJson !== undefined) {
    var est = _waEstrutura_(nomeTpl, idioma);
    if (est && !est.erro && est.status !== 'NAO_EXISTE') comps = _waComponentes_(est, extras.mapaJson, extras.ctx || {});
  }
  if (comps) {
    if (comps.length) corpo.template.components = comps;
  } else if (params && params.length) {
    corpo.template.components = [{ type: 'body', parameters: params }];
  }

  var caminho = '/' + encodeURIComponent(_waPhone_()) + '/messages';
  var r = _waCall_('post', caminho, corpo);
  // v168: falha passageira (rede, instabilidade da Meta, limite de taxa)
  // ganha uma segunda tentativa. Erro de configuração (4xx) não: repetir
  // não muda nada, e o motivo precisa chegar a quem pode corrigir.
  if (r._error && (!r.code || r.code >= 500 || r.code === 429)) {
    try { Utilities.sleep(1500); } catch (e) {}
    r = _waCall_('post', caminho, corpo);
  }
  if (r._error) {
    logAction(destino, 'WA_ENVIO_FALHOU', 'whatsapp', nomeTpl, r.message);
    return { ok: false, error: r.message };
  }
  var id = (r.messages && r.messages[0] && r.messages[0].id) || '';
  // v173: "aceito" não é "entregue". Guarda o número como o WhatsApp o
  // reconhece (wa_id — no Brasil pode vir sem o 9) e o estado que a Meta
  // devolveu (ex.: held_for_quality_assessment), para a investigação.
  var waId   = (r.contacts && r.contacts[0] && r.contacts[0].wa_id) || '';
  var stMeta = (r.messages && r.messages[0] && r.messages[0].message_status) || '';
  logAction(destino, 'WA_ENVIADO', 'whatsapp', nomeTpl,
            id + (waId && waId !== destino ? ' | wa_id=' + waId : '') + (stMeta ? ' | ' + stMeta : ''));
  // Cada envio aceito vira uma linha em wa_envios: é ela que o webhook
  // atualiza (entregue / lido / não chegou) — ver wa_webhook.gs
  var cx = (extras && extras.ctx) || {};
  if (typeof _waEnvioRegistrar_ === 'function') {
    _waEnvioRegistrar_({ wamid: id, para: destino, waId: waId, template: nomeTpl, tipo: (extras && extras.tipo) || '',
                         email: cx.email || '', nome: cx.nome || '', leadId: (extras && extras.leadId) || '' });
  }
  return { ok: true, id: id, waId: waId, statusMeta: stMeta };
}

// Boas-vindas do trial — chamado pela automação pós-adesão
function waBoasVindasTrial_(ctx) {
  if (!_waBool_('auto_whats_boasvindas', false)) return { ok: false, error: 'desligado' };
  var varsBv = _waCfg_('wa_tpl_boasvindas_vars', '[]');
  return _waEnviarTemplate_(
    ctx.whatsapp,
    _waCfg_('wa_tpl_boasvindas'),
    _waCfg_('wa_tpl_boasvindas_lang', 'pt_BR'),
    _waParams_(varsBv, ctx), { mapaJson: varsBv, ctx: ctx, tipo: 'boas-vindas (cartão)' }
  );
}

// v166: boas-vindas de quem entrou no teste SEM cartão — checkout sem
// cartão e cadastro pelo app. Template próprio: a mensagem do teste com
// cartão fala de cobrança, e aqui não existe cobrança nenhuma.
// Sem template próprio escolhido, reaproveita o do cartão SÓ se ele não
// usar variável de cobrança (data_cobranca / valor).
function _waTplSemCartao_() {
  var proprio = String(_waCfg_('wa_tpl_boasvindas_sc'));
  if (proprio) {
    return { nome: proprio, lang: _waCfg_('wa_tpl_boasvindas_sc_lang', 'pt_BR'),
             vars: _waCfg_('wa_tpl_boasvindas_sc_vars', '[]'), proprio: true };
  }
  var base = String(_waCfg_('wa_tpl_boasvindas'));
  var vars = String(_waCfg_('wa_tpl_boasvindas_vars', '[]'));
  if (base && !/data_cobranca|"valor"/.test(vars)) {
    return { nome: base, lang: _waCfg_('wa_tpl_boasvindas_lang', 'pt_BR'), vars: vars, proprio: false };
  }
  return null;
}

// Ligado por padrão quando o do cartão estiver ligado; tem chave própria.
function _waSemCartaoLigado_() {
  return _waBool_('auto_whats_boasvindas_sc', _waBool_('auto_whats_boasvindas', false));
}

function waBoasVindasSemCartao_(ctx) {
  if (!_waSemCartaoLigado_()) return { ok: false, error: 'desligado no painel' };
  var t = _waTplSemCartao_();
  if (!t) return { ok: false, error: 'template de boas-vindas (sem cartao) nao escolhido' };
  // v168: template ainda em análise (ou recusado) na Meta não é enviado:
  // o aviso diz o estado real, em vez de um erro genérico da API.
  try {
    var st = (typeof _ritoTemplateMeta_ === 'function') ? _ritoTemplateMeta_(t.nome) : null;
    if (st && /^(PENDING|REJECTED|DISABLED|PAUSED|NAO_EXISTE)$/.test(st.status)) {
      return { ok: false, error: 'template ' + t.nome + ' ' + _waStatusNome_(st.status) };
    }
  } catch (e) {}
  return _waEnviarTemplate_(ctx.whatsapp, t.nome, t.lang, _waParams_(t.vars, ctx), { mapaJson: t.vars, ctx: ctx, tipo: 'boas-vindas (sem cartão)' });
}

// ─────────────────────────────────────────────────────────────
// v171 — ROTA ADMIN: waReenviarBoasVindas
// Para quem se cadastrou e NÃO recebeu o WhatsApp de boas-vindas (o aviso
// do Telegram mostra ❌). Monta os dados igual ao cadastro da pessoa —
// nome e WhatsApp do CRM, dias e fim do teste da assinatura — e usa o
// template da rota dela. Só envia para quem autorizou contato.
// Manual = vale mesmo com a automação desligada no painel.
// ─────────────────────────────────────────────────────────────
function waReenviarBoasVindas(token, data) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  if (typeof _rateLimit_ === 'function' && _rateLimit_('wa_reenvio', String(user.id || user.email), 30, 3600)) {
    return { ok: false, error: 'Muitos reenvios seguidos. Aguarde um pouco.' };
  }
  var email = String((data && data.email) || '').toLowerCase().trim();
  if (!email) return { ok: false, error: 'Lead sem e-mail.' };

  // Pessoa no CRM: nome, WhatsApp, origem, autorização
  var lead = null;
  try {
    var d = getSheet(SHEET_CRM).getDataRange().getValues(), cab = d[0].map(String);
    var iM = cab.indexOf('email'), iN = cab.indexOf('name'), iF = cab.indexOf('phone'), iC = cab.indexOf('custom_fields');
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][iM] || '').toLowerCase().trim() !== email) continue;
      var cf = {};
      try { cf = JSON.parse(String(d[i][iC] || '{}')) || {}; } catch (e) {}
      lead = { nome: String(d[i][iN] || ''), fone: String(d[i][iF] || '').replace(/\D/g, ''), cf: cf };
      break;
    }
  } catch (e) {}
  if (!lead) return { ok: false, error: 'Não achei essa pessoa no CRM.' };
  if (lead.fone.length < 12) return { ok: false, error: 'O WhatsApp dessa pessoa está incompleto no CRM.' };

  var cartao = lead.cf.origem === 'trial-cartao';
  if (!cartao && !lead.cf.consentimento_em) {
    return { ok: false, error: 'Essa pessoa não marcou a autorização de contato — o WhatsApp não pode ir.' };
  }

  var dias = Number(lead.cf.oferta_dias) || 7, fim = '';
  try {
    var row = _getAssinaturaRow_(email);
    if (row) {
      dias = Number(row[_ASS_.TRIAL_DAYS]) || dias;
      var te = row[_ASS_.TRIAL_END];
      if (te) fim = Utilities.formatDate(new Date(te), 'America/Sao_Paulo', 'dd/MM/yyyy');
    }
  } catch (e) {}

  var ctx = { nome: lead.nome, email: email, whatsapp: lead.fone, dias: dias, valor: '17,00' };
  if (cartao) { if (fim) ctx.dataCobranca = fim; } else if (fim) ctx.fimTeste = fim;

  var t;
  if (cartao) {
    var vb = _waCfg_('wa_tpl_boasvindas_vars', '[]');
    t = { nome: String(_waCfg_('wa_tpl_boasvindas')), lang: _waCfg_('wa_tpl_boasvindas_lang', 'pt_BR'), vars: vb };
  } else {
    t = _waTplSemCartao_();
  }
  if (!t || !t.nome) return { ok: false, error: 'Nenhum template de boas-vindas escolhido para essa rota.' };

  var r = _waEnviarTemplate_(lead.fone, t.nome, t.lang, _waParams_(t.vars, ctx), { mapaJson: t.vars, ctx: ctx, tipo: 'reenvio de boas-vindas' });
  try {
    _crmUpsertLead_({ email: email, evento: 'WhatsApp de boas-vindas reenviado pelo painel: ' +
                      (r.ok ? 'aceito pela Meta' : 'falhou (' + (typeof ritoMotivo_ === 'function' ? ritoMotivo_(r.error) : r.error) + ')') });
  } catch (e) {}
  logAction(user.email, 'WA_REENVIO_BOASVINDAS', 'whatsapp', email, r.ok ? (r.id || 'ok') : r.error);
  return r.ok
    ? { ok: true, id: r.id, message: 'Aceito pela Meta para +' + lead.fone + ' (template ' + t.nome + '). A entrega aparece no histórico do lead.' }
    : { ok: false, error: (typeof ritoMotivo_ === 'function') ? ritoMotivo_(r.error) : r.error };
}

function _waStatusNome_(s) {
  return ({ PENDING: 'ainda em análise na Meta', REJECTED: 'foi recusado pela Meta', DISABLED: 'foi desativado pela Meta',
            PAUSED: 'está pausado pela Meta', NAO_EXISTE: 'não existe na Meta' })[s] || s;
}

// ─────────────────────────────────────────────────────────────
// v168 — ROTA ADMIN: waCriarTemplateSemCartao
// Manda para a Meta aprovar o template de boas-vindas de quem entra
// SEM cartão (checkout sem cartão e app). Texto de confirmação de
// conta, categoria UTILITY: a Meta entrega esse tipo com mais
// confiança do que MARKETING, que tem limite por pessoa.
// Já deixa escolhido no painel, com as variáveis na ordem do texto.
// ─────────────────────────────────────────────────────────────
var WA_TPL_SC_NOME  = 'desafio21_boasvindas_teste_gratis';
var WA_TPL_SC_TEXTO =
  'Olá, {{1}}! Sua conta no Desafio 21 Dias foi criada e o seu acesso de {{2}} dias grátis ' +
  'já está liberado, até {{3}}.\n\n' +
  'Para entrar, abra o app com o e-mail que você cadastrou. A senha provisória foi enviada para o seu e-mail.\n\n' +
  'Ficou com alguma dúvida? É só responder esta mensagem.';
var WA_TPL_SC_VARS  = ['primeiro_nome', 'dias_trial', 'fim_teste'];

function waCriarTemplateSemCartao(token, data) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  if (!_waPronto_()) return { ok: false, error: 'Configure a conexão com a Meta antes.' };
  data = data || {};

  var nome = String(data.nome || WA_TPL_SC_NOME).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 60);
  var texto = String(data.texto || WA_TPL_SC_TEXTO).trim();
  var categoria = String(data.categoria) === 'MARKETING' ? 'MARKETING' : 'UTILITY';
  if (!nome || texto.length < 20) return { ok: false, error: 'Preencha o nome e o texto do template.' };
  if (texto.length > 1024) return { ok: false, error: 'O texto passou de 1024 caracteres.' };

  var n = _waContarVars_([{ type: 'BODY', text: texto }]);
  var exemplos = ['Ana', '7', '05/10/2026', 'ana@email.com', '17,00'];
  if (n > exemplos.length) return { ok: false, error: 'Use no máximo ' + exemplos.length + ' variáveis.' };

  var corpo = {
    name: nome, language: 'pt_BR', category: categoria,
    components: [{ type: 'BODY', text: texto }]
  };
  if (n) corpo.components[0].example = { body_text: [exemplos.slice(0, n)] };
  corpo.components.push({ type: 'BUTTONS', buttons: [
    { type: 'URL', text: 'Abrir o app', url: 'https://app.wpktavares.com.br/?entrar=1' }
  ] });

  var r = _waCall_('post', '/' + encodeURIComponent(_waWaba_()) + '/message_templates', corpo);
  if (r._error) {
    logAction(user.email, 'WA_TPL_CRIAR_FALHOU', 'whatsapp', nome, r.message);
    return { ok: false, error: 'A Meta recusou: ' + r.message };
  }

  // Já escolhido no painel: as variáveis seguem a ordem do texto padrão
  // ({{1}} nome, {{2}} dias, {{3}} fim do teste). Texto editado com outra
  // ordem: o admin ajusta o mapeamento na lista de templates.
  setConfig_('wa_tpl_boasvindas_sc', nome);
  setConfig_('wa_tpl_boasvindas_sc_lang', 'pt_BR');
  setConfig_('wa_tpl_boasvindas_sc_vars', JSON.stringify(WA_TPL_SC_VARS.slice(0, n)));
  try { CacheService.getScriptCache().remove('rito_tpl_' + nome); } catch (e) {}
  if (typeof _ritoLimparCache_ === 'function') _ritoLimparCache_();

  logAction(user.email, 'WA_TPL_CRIADO', 'whatsapp', nome, (r.status || '') + ' ' + (r.category || categoria));
  return { ok: true, nome: nome, status: String(r.status || 'PENDING'), categoria: String(r.category || categoria),
           message: 'Enviado para a Meta aprovar. Costuma levar de minutos a algumas horas — o quadro no topo fica verde quando aprovar.' };
}

// Recuperação de quem parou na tela do cartão. Template separado de
// propósito: a mensagem de quem JÁ começou o teste não serve para quem
// não começou — e a Meta avalia cada template pelo texto dele.
function waRecuperarCheckout_(ctx) {
  var tpl = _waCfg_('wa_tpl_recuperacao');
  if (!tpl) return { ok: false, error: 'template de recuperacao nao escolhido' };
  var varsRc = _waCfg_('wa_tpl_recuperacao_vars', '[]');
  return _waEnviarTemplate_(
    ctx.whatsapp,
    tpl,
    _waCfg_('wa_tpl_recuperacao_lang', 'pt_BR'),
    _waParams_(varsRc, ctx), { mapaJson: varsRc, ctx: ctx, tipo: 'recuperação de checkout' }
  );
}

// Lembrete antes da cobrança
function waLembreteTrial_(ctx) {
  if (!_waBool_('auto_lembretes', true)) return { ok: false, error: 'desligado' };
  var varsLb = _waCfg_('wa_tpl_lembrete_vars', '[]');
  return _waEnviarTemplate_(
    ctx.whatsapp,
    _waCfg_('wa_tpl_lembrete'),
    _waCfg_('wa_tpl_lembrete_lang', 'pt_BR'),
    _waParams_(varsLb, ctx), { mapaJson: varsLb, ctx: ctx, tipo: 'lembrete' }
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

  // v171: o teste monta os dados IGUAL ao cadastro real da rota. Antes ele
  // sempre tinha "data da cobrança" — que quem entra SEM cartão não tem —,
  // então passava no teste e falhava no cadastro de verdade (#131008).
  var dias = Number(data.dias) || 14;
  var fim = Utilities.formatDate(new Date(Date.now() + dias * 86400000), 'America/Sao_Paulo', 'dd/MM/yyyy');
  var ctx = {
    nome: data.nome || user.name || 'Teste',
    email: user.email,
    dias: dias,
    valor: '17,00',
    whatsapp: tel.e164
  };
  if (String(data.rota || '') === 'sc') ctx.fimTeste = fim; else ctx.dataCobranca = fim;

  var r = _waEnviarTemplate_(tel.e164, data.template, data.idioma || 'pt_BR',
            _waParams_(data.vars || '[]', ctx), { mapaJson: data.vars || '[]', ctx: ctx, tipo: 'teste do painel' });
  if (!r.ok) return r;
  return { ok: true, message: 'Aceito pela Meta para ' + tel.e164 + ' — confira se chegou no celular.', id: r.id };
}
