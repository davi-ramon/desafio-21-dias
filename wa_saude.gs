// ============================================================
// wa_saude.gs — o WhatsApp está ENTREGANDO de verdade? (v173)
// ------------------------------------------------------------
// "Enviado" na API da Meta só quer dizer que o pedido foi ACEITO.
// A entrega (ou a falha) chega depois, pelo webhook. Esta rotina
// pergunta à Meta o que ela sabe da conta: o número pode enviar? Se
// não, por quê? Quem recebe o webhook? Quantas mensagens saíram e
// quantas chegaram nos últimos dias?
// A versão pública não tem dado pessoal: só estados e contagens.
// ============================================================

var WA_SAUDE_CACHE = 'wa_saude_v5';

function _waSaude_(forcar) {
  var cache = CacheService.getScriptCache();
  if (!forcar) {
    var c = cache.get(WA_SAUDE_CACHE);
    if (c) { try { return JSON.parse(c); } catch (e) {} }
  }
  var s = { ok: true, em: nowISO(), podeEnviar: '', bloqueios: [], numero: {}, conta: {},
            webhook: { apps: [], assinado: false }, entregas: { dias: [], enviadas: 0, entregues: 0 }, falhas: [] };
  if (!_waPronto_()) {
    s.ok = false;
    s.bloqueios.push({ onde: 'Configuração', codigo: '', motivo: 'Token, WABA ID ou Phone ID do WhatsApp não configurados.' });
    return s;
  }
  var ph = '/' + encodeURIComponent(_waPhone_()), wb = '/' + encodeURIComponent(_waWaba_());
  // sem URL no erro: ela carrega o ID da conta, e esta saída também é pública
  var falhou = function (onde, r) {
    s.falhas.push({ onde: onde, erro: String(r.message || 'falhou').replace(/https?:\/\/\S+/g, '(url)').slice(0, 200) });
  };

  // 1) O número que envia
  var n = _waCall_('get', ph + '?fields=verified_name,display_phone_number,name_status,quality_rating,messaging_limit_tier,platform_type,status,code_verification_status,account_mode');
  if (n._error) falhou('número', n);
  else {
    s.numero = { nome: n.verified_name || '', telefone: n.display_phone_number || '', nomeStatus: n.name_status || '',
                 qualidade: n.quality_rating || '', limite: n.messaging_limit_tier || '', plataforma: n.platform_type || '',
                 status: n.status || '', verificacao: n.code_verification_status || '', modo: n.account_mode || '' };
  }
  // Coexistência: o mesmo número também no app WhatsApp Business (campo novo — se não existir, fica null)
  var cx = _waCall_('get', ph + '?fields=is_on_biz_app');
  s.numero.noAppBusiness = cx._error ? null : (cx.is_on_biz_app === true);

  // 2) Pode enviar? (health_status junta número, conta, empresa e app)
  var hp = _waCall_('get', ph + '?fields=health_status');
  if (hp._error) falhou('saúde do número', hp);
  else if (hp.health_status) {
    s.podeEnviar = hp.health_status.can_send_message || '';
    (hp.health_status.entities || []).forEach(function (en) {
      (en.errors || []).forEach(function (er) { s.bloqueios.push(_waSaudeErro_(en.entity_type, er, 'bloqueio')); });
      if (en.additional_info) {
        [].concat(en.additional_info).forEach(function (info) {
          s.bloqueios.push({ onde: _waSaudeOnde_(en.entity_type), codigo: '', motivo: _waSaudeTraduz_(String(info)), detalhe: String(info).slice(0, 300), tipo: 'aviso' });
        });
      }
    });
  }

  // 3) A conta do WhatsApp (WABA)
  var w = _waCall_('get', wb + '?fields=account_review_status,business_verification_status');
  if (w._error) falhou('conta WhatsApp', w);
  else s.conta = { revisao: w.account_review_status || '', verificacaoEmpresa: w.business_verification_status || '' };
  // Forma de pagamento: sem ela, só sai o que é de graça (quem falou com a
  // empresa nas últimas 24 h); o resto é ACEITO e morre depois (erro 131042)
  var pg = _waCall_('get', wb + '?fields=primary_funding_id,currency,timezone_id');
  if (pg._error) falhou('forma de pagamento', pg);
  else { s.conta.temPagamento = !!pg.primary_funding_id; s.conta.moeda = pg.currency || ''; s.conta.fuso = pg.timezone_id ? 'ok' : ''; }

  // 4) Quem recebe o webhook (status de entrega e respostas das pessoas)
  var ap = _waCall_('get', wb + '/subscribed_apps');
  if (ap._error) falhou('webhook', ap);
  else {
    (ap.data || []).forEach(function (a) {
      var d = a.whatsapp_business_api_data || {};
      var url = String(a.override_callback_uri || '');
      s.webhook.apps.push({ nome: d.name || '(app sem nome)', desvio: !!url, paraNos: url.indexOf(_waSaudeUrlExec_()) === 0 && !!_waSaudeUrlExec_() });
    });
    s.webhook.assinado = s.webhook.apps.length > 0;
  }

  // 5) Saíram x chegaram, por dia (últimos 14 dias)
  var agora = Math.floor(Date.now() / 1000), ini = agora - 14 * 86400;
  var an = _waCall_('get', wb + '?fields=analytics.start(' + ini + ').end(' + agora + ').granularity(DAY)');
  if (an._error) falhou('entregas', an);
  else {
    ((an.analytics && an.analytics.data_points) || []).forEach(function (p) {
      var env = Number(p.sent || 0), ent = Number(p.delivered || 0);
      if (!env && !ent) return;
      s.entregas.dias.push({ dia: Utilities.formatDate(new Date(Number(p.start) * 1000), 'America/Sao_Paulo', 'dd/MM'), enviadas: env, entregues: ent });
      s.entregas.enviadas += env; s.entregas.entregues += ent;
    });
  }

  // 5b) Do nosso lado: quantos pedidos a Meta ACEITOU (e recusou) por dia.
  //     Aceitou mais do que enviou num dia já fechado = mensagem que
  //     morreu depois do "aceito", sem ninguém saber.
  try {
    var porDia = {}, porTpl = {};
    s.entregas.dias.forEach(function (d) { porDia[d.dia] = d; });
    var lg = getSheet(SHEET_LOG), ult = lg.getLastRow();
    if (ult >= 2) {
      var de = Math.max(2, ult - 6000), vals = lg.getRange(de, 1, ult - de + 1, 7).getValues();
      var limite = Date.now() - 14 * 86400000;
      vals.forEach(function (v) {
        var acao = String(v[2]);
        if (acao !== 'WA_ENVIADO' && acao !== 'WA_ENVIO_FALHOU') return;
        var t = new Date(v[6]).getTime();
        if (!(t >= limite)) return;
        var dia = Utilities.formatDate(new Date(t), 'America/Sao_Paulo', 'dd/MM');
        var d = porDia[dia] || (porDia[dia] = { dia: dia, enviadas: 0, entregues: 0 });
        if (acao === 'WA_ENVIADO') d.aceitas = (d.aceitas || 0) + 1; else d.recusadas = (d.recusadas || 0) + 1;
        if (acao !== 'WA_ENVIADO') return;
        // Por template e por faixa de DDD (sem número): acha o padrão das que morrem
        var tpl = String(v[4] || '?'), fone = String(v[1] || '').replace(/\D/g, ''), faixa = 'fora do BR';
        if (fone.indexOf('55') === 0 && (fone.length === 12 || fone.length === 13)) {
          var ddd = Number(fone.substr(2, 2));
          faixa = (ddd <= 28 ? 'DDD 11-28' : 'DDD 31-99') + (fone.length === 13 ? ' com 9' : ' sem 9');
        }
        var chave = dia + '|' + tpl + '|' + faixa;
        porTpl[chave] = (porTpl[chave] || 0) + 1;
      });
    }
    s.aceitasDetalhe = Object.keys(porTpl).sort().map(function (k) {
      var p = k.split('|'); return { dia: p[0], template: p[1], faixa: p[2], aceitas: porTpl[k] };
    });
    s.entregas.dias = Object.keys(porDia).map(function (k) { return porDia[k]; }).sort(function (a, b) {
      var pa = a.dia.split('/'), pb = b.dia.split('/');
      return (pa[1] + pa[0]).localeCompare(pb[1] + pb[0]);
    });
  } catch (e) { s.falhas.push({ onde: 'log de envios', erro: String(e.message || e).slice(0, 200) }); }

  // 6) As últimas 36 h em blocos de meia hora — o envio de hoje aparece aqui
  //    antes de entrar na contagem do dia
  s.entregas.recentes = [];
  var hh = _waCall_('get', wb + '?fields=analytics.start(' + (agora - 36 * 3600) + ').end(' + agora + ').granularity(HALF_HOUR)');
  if (hh._error) falhou('entregas recentes', hh);
  else {
    ((hh.analytics && hh.analytics.data_points) || []).forEach(function (p) {
      var env = Number(p.sent || 0), ent = Number(p.delivered || 0);
      if (!env && !ent) return;
      s.entregas.recentes.push({ quando: Utilities.formatDate(new Date(Number(p.start) * 1000), 'America/Sao_Paulo', 'dd/MM HH:mm'), enviadas: env, entregues: ent });
    });
  }

  // 6a) O que foi cobrado x o que saiu de graça (preço por mensagem, desde jul/2025)
  s.cobranca = [];
  // aspas e colchetes codificados: o UrlFetchApp recusa a URL crua ("Argumento inválido")
  var pa = _waCall_('get', wb + '?fields=' + encodeURIComponent('pricing_analytics.start(' + ini + ').end(' + agora + ').granularity(DAILY)' +
                    '.dimensions(["PRICING_CATEGORY","PRICING_TYPE"])'));
  if (pa._error) falhou('cobrança', pa);
  else {
    (((pa.pricing_analytics && pa.pricing_analytics.data) || [])[0] || { data_points: [] }).data_points.forEach(function (p) {
      s.cobranca.push({ dia: Utilities.formatDate(new Date(Number(p.start) * 1000), 'America/Sao_Paulo', 'dd/MM'),
                        categoria: p.pricing_category || '', tipo: p.pricing_type || '', volume: Number(p.volume || 0), custo: Number(p.cost || 0) });
    });
  }

  // 6b) Os templates em uso: a Meta pode mudar a categoria (UTILITY → MARKETING)
  //     ou baixar a qualidade depois de aprovar
  s.templates = [];
  var emUso = {};
  ['wa_tpl_boasvindas', 'wa_tpl_boasvindas_sc', 'wa_tpl_lembrete', 'wa_tpl_recuperacao'].forEach(function (k) {
    var nome = String(_waCfg_(k) || '');
    if (nome) emUso[nome] = (emUso[nome] ? emUso[nome] + ', ' : '') + k.replace('wa_tpl_', '');
  });
  Object.keys(emUso).forEach(function (nome) {
    var t = _waCall_('get', wb + '/message_templates?name=' + encodeURIComponent(nome) +
                     '&fields=name,status,category,previous_category,quality_score,language,rejected_reason');
    if (t._error) { falhou('template ' + nome, t); return; }
    (t.data || []).filter(function (x) { return x.name === nome; }).forEach(function (x) {
      s.templates.push({ nome: nome, uso: emUso[nome], status: x.status || '', categoria: x.category || '',
                         categoriaAnterior: x.previous_category || '', qualidade: (x.quality_score && x.quality_score.score) || '',
                         idioma: x.language || '' });
    });
  });

  // 7) Qual app da Meta é dono do NOSSO token — e se ele recebe o webhook
  var app = _waCall_('get', '/app');
  if (app._error) falhou('app do token', app);
  else {
    s.webhook.nossoApp = app.name || '';
    s.webhook.nossoAppAssinado = (ap.data || []).some(function (a) { return a.whatsapp_business_api_data && String(a.whatsapp_business_api_data.id) === String(app.id); });
  }

  try { cache.put(WA_SAUDE_CACHE, JSON.stringify(s), 300); } catch (e) {}
  return s;
}

// A URL que a Meta chama: a implantação de produção (ID fixo). O
// getService().getUrl() pode devolver a de teste quando roda pelo editor.
var WA_EXEC_URL = 'https://script.google.com/macros/s/AKfycbx9ypaZFGLIFkCVbV2LmvSv-dZIUZvMGvhJDnG2unhCwlaVTnBMU1anbbLa15h0aKxi/exec';
function _waSaudeUrlExec_() { return WA_EXEC_URL; }

function _waSaudeOnde_(tipo) {
  return { PHONE_NUMBER: 'Número', WABA: 'Conta WhatsApp', BUSINESS: 'Empresa (Meta)', APP: 'App da Meta' }[String(tipo)] || String(tipo || '');
}

function _waSaudeErro_(tipo, er, natureza) {
  var desc = String(er.error_description || er.message || '');
  return { onde: _waSaudeOnde_(tipo), codigo: er.error_code || '', motivo: _waSaudeTraduz_(desc),
           detalhe: desc.slice(0, 300), solucao: String(er.possible_solution || '').slice(0, 300), tipo: natureza };
}

// Os motivos que a Meta devolve vêm em inglês; os comuns ganham tradução
function _waSaudeTraduz_(t) {
  var s = String(t || '').toLowerCase();
  if (/payment|funding|credit line|billing/.test(s)) return 'Forma de pagamento: a conta do WhatsApp está sem cartão válido (WhatsApp Manager → Configurações de pagamento).';
  if (/business verification|verify your business|not verified/.test(s)) return 'Verificação da empresa pendente no Gerenciador de Negócios da Meta.';
  if (/display name/.test(s)) return 'Nome de exibição do número ainda não aprovado pela Meta.';
  if (/quality/.test(s)) return 'Qualidade do número baixa: a Meta está limitando os envios.';
  if (/messaging limit|tier/.test(s)) return 'Limite diário de conversas atingido.';
  if (/restrict|violation|policy/.test(s)) return 'Conta com restrição por política da Meta.';
  if (/disabled|deleted|banned/.test(s)) return 'Conta ou número desativado pela Meta.';
  if (/not registered|register/.test(s)) return 'Número não registrado na API (falta concluir o registro).';
  return String(t || '').slice(0, 200);
}

// Pública: só estados e contagens — sem telefone, sem nome, sem IDs
function getWaSaude() {
  var s = JSON.parse(JSON.stringify(_waSaude_(false)));
  if (s.numero) { delete s.numero.telefone; delete s.numero.nome; }
  return { ok: true, data: s };
}

// Admin: completo, e pode forçar a consulta (pula o cache de 5 min)
function waSaude(token, data) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  return { ok: true, data: _waSaude_(!!(data && data.forcar)) };
}
