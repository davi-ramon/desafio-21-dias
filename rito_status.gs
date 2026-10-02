// ============================================================
// rito_status.gs — as boas-vindas estão prontas? (v168)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// Pergunta que não aceita "acho que sim": quem conclui o cadastro
// recebe o e-mail E o template de WhatsApp? A resposta depende de
// coisas que moram fora do código — liga/desliga na aba config,
// template escolhido, aprovação na Meta, rotina do Stripe rodando.
// Aqui o servidor confere cada uma e diz, por rota, o que falta.
//
// Rota pública de propósito (como getMigracaoStatus): só estados e
// nomes de template, nenhum dado pessoal, nenhum texto de erro cru.
// ============================================================

// Status e categoria do template na Meta (cache 5 min)
function _ritoTemplateMeta_(nome) {
  if (!nome || !_waPronto_()) return null;
  var c = CacheService.getScriptCache(), k = 'rito_tpl_' + nome;
  var g = c.get(k);
  if (g) { try { return JSON.parse(g); } catch (e) {} }
  var r = _waCall_('get', '/' + encodeURIComponent(_waWaba_()) + '/message_templates?name=' +
                   encodeURIComponent(nome) + '&fields=name,status,category,language&limit=20');
  var out;
  if (r._error) {
    out = { status: 'ERRO_META' };
  } else {
    var lista = (r.data || []).filter(function (x) { return String(x.name) === nome; });
    var t = lista.filter(function (x) { return x.status === 'APPROVED'; })[0] || lista[0];
    out = t ? { status: String(t.status || ''), categoria: String(t.category || ''), idioma: String(t.language || '') }
            : { status: 'NAO_EXISTE' };
  }
  try { c.put(k, JSON.stringify(out), 300); } catch (e) {}
  return out;
}

function _ritoWaConecta_() {
  if (!_waPronto_()) return false;
  var c = CacheService.getScriptCache(), g = c.get('rito_wa_con');
  if (g) return g === '1';
  var r = _waCall_('get', '/' + encodeURIComponent(_waPhone_()) + '?fields=display_phone_number');
  var ok = !r._error;
  try { c.put('rito_wa_con', ok ? '1' : '0', 300); } catch (e) {}
  return ok;
}

// A rotina que busca os eventos do Stripe (é ela que dispara as
// boas-vindas do teste COM cartão) precisa existir na conta que roda.
function _ritoRotinaStripe_() {
  try {
    return ScriptApp.getProjectTriggers().some(function (t) {
      return t.getHandlerFunction() === 'stripeBuscarEventos';
    });
  } catch (e) { return null; }
}

function _ritoFaltas_(credenciais, conectado, ligado, tpl, meta) {
  var f = [];
  if (!credenciais) f.push('whatsapp_sem_credenciais');
  else if (!conectado) f.push('whatsapp_nao_conecta');
  if (!ligado) f.push('automacao_desligada');
  if (!tpl) f.push('template_nao_escolhido');
  else if (meta && meta.status === 'ERRO_META') f.push('meta_nao_respondeu');
  else if (meta && meta.status === 'NAO_EXISTE') f.push('template_nao_existe');
  else if (!meta || meta.status !== 'APPROVED') f.push('template_nao_aprovado');
  return f;
}

// ROTA PÚBLICA: getRitoStatus
function getRitoStatus() {
  var c = CacheService.getScriptCache(), g = c.get('rito_status');
  if (g) { try { return JSON.parse(g); } catch (e) {} }

  var credenciais = _waPronto_();
  var conectado = credenciais ? _ritoWaConecta_() : false;

  var tplCartao    = String(_waCfg_('wa_tpl_boasvindas'));
  var cartaoLigado = _waBool_('auto_whats_boasvindas', false);
  var metaCartao   = tplCartao ? _ritoTemplateMeta_(tplCartao) : null;

  var sc       = _waTplSemCartao_();
  var scLigado = _waSemCartaoLigado_();
  var metaSc   = sc ? _ritoTemplateMeta_(sc.nome) : null;

  var fCartao = _ritoFaltas_(credenciais, conectado, cartaoLigado, tplCartao, metaCartao);
  var fSc     = _ritoFaltas_(credenciais, conectado, scLigado, sc && sc.nome, metaSc);

  // v171: SIMULA o envio de um cadastro real de cada rota. "Pronto" passa a
  // significar "a mensagem sairia", não só "o template existe e foi
  // aprovado" — foi essa diferença que deixou passar o #131008.
  if (credenciais) {
    var em7 = Utilities.formatDate(new Date(Date.now() + 7 * 86400000), 'America/Sao_Paulo', 'dd/MM/yyyy');
    if (sc && sc.nome) {
      fSc = fSc.concat(_ritoSimular_(sc.nome, sc.vars,
        { nome: 'Ana Teste', email: 'teste@exemplo.com', dias: _trialDiasApp_(), fimTeste: em7, valor: '17,00' }));
    }
    if (tplCartao) {
      fCartao = fCartao.concat(_ritoSimular_(tplCartao, _waCfg_('wa_tpl_boasvindas_vars', '[]'),
        { nome: 'Ana Teste', email: 'teste@exemplo.com', dias: 14, dataCobranca: em7, valor: '17,00' }));
    }
  }
  var rotina  = _ritoRotinaStripe_();
  if (rotina === false) fCartao.push('rotina_stripe_parada');

  var emailCartao = _taBool_('auto_email_boasvindas', true);
  var out = { ok: true, data: {
    email: {
      canal: _resendChave_() ? 'resend' : 'gmail',
      semCartao: true,          // sempre sai: leva a senha provisória
      cartao: emailCartao
    },
    whatsapp: {
      credenciais: credenciais,
      conectado: conectado,
      semCartao: { ligado: scLigado, template: sc ? sc.nome : '', proprio: !!(sc && sc.proprio),
                   meta: metaSc, faltas: fSc,
                   // v171: o que o template exige e o que está mapeado
                   estrutura: sc ? _ritoEstruturaResumo_(sc.nome) : null,
                   vars: sc ? _ritoVars_(sc.vars) : [] },
      cartao:    { ligado: cartaoLigado, template: tplCartao, meta: metaCartao, faltas: fCartao,
                   estrutura: tplCartao ? _ritoEstruturaResumo_(tplCartao) : null,
                   vars: _ritoVars_(_waCfg_('wa_tpl_boasvindas_vars', '[]')) }
    },
    rotinaStripe: rotina,
    pronto: { semCartao: !fSc.length, cartao: !fCartao.length && emailCartao }
  } };
  try { c.put('rito_status', JSON.stringify(out), 120); } catch (e) {}
  return out;
}

// O que impediria o envio de um cadastro real (vazio = sairia)
function _ritoSimular_(nome, varsJson, ctx) {
  var est = (typeof _waEstrutura_ === 'function') ? _waEstrutura_(nome) : null;
  if (!est || est.erro || est.status === 'NAO_EXISTE') return [];
  var f = [];
  if (est.header && /VIDEO|DOCUMENT/.test(est.header.formato) && !String(_waCfg_('wa_header_midia_url')).trim()) {
    f.push('cabecalho_sem_midia');
  }
  // variável numerada sem mapeamento salvo sairia com valor genérico
  var mapa = [];
  try { mapa = JSON.parse(varsJson || '[]'); } catch (e) {}
  var vars = (est.corpo && est.corpo.vars) || [];
  if (est.formato !== 'NAMED' && Array.isArray(mapa) && mapa.filter(function (x) { return !!x; }).length < vars.length) {
    f.push('variavel_sem_mapeamento');
  }
  _waComponentes_(est, varsJson, ctx).forEach(function (c) {
    (c.parameters || []).forEach(function (p) {
      if (p.type === 'text' && !String(p.text || '').trim()) f.push('parametro_vazio');
    });
  });
  return f.filter(function (x, i, a) { return a.indexOf(x) === i; });
}

// Estrutura do template sem nada sensível: só formato e onde há variável
function _ritoEstruturaResumo_(nome) {
  var e = (typeof _waEstrutura_ === 'function') ? _waEstrutura_(nome) : null;
  if (!e || e.erro) return e ? { erro: 'a Meta não respondeu' } : null;
  return { formato: e.formato, header: e.header, corpoVars: (e.corpo && e.corpo.vars) || [],
           corpo: (e.corpo && e.corpo.texto) || '',
           botoes: (e.botoes || []).map(function (b) { return { tipo: b.tipo, temVar: b.temVar }; }) };
}
function _ritoVars_(json) {
  try { var v = JSON.parse(json || '[]'); return Array.isArray(v) ? v : (v && typeof v === 'object' ? v : []); }
  catch (e) { return []; }
}

// Mudou a config do WhatsApp: a resposta guardada deixa de valer
function _ritoLimparCache_() {
  try { CacheService.getScriptCache().removeAll(['rito_status', 'rito_wa_con']); } catch (e) {}
}

// Motivo em português, para o aviso do Telegram e para o painel
function ritoMotivo_(erro) {
  var e = String(erro || '');
  if (!e) return 'motivo desconhecido';
  if (/desligado/i.test(e))                 return 'automação desligada no painel';
  if (/template.*nao escolhido|Template não escolhido/i.test(e)) return 'nenhum template escolhido no painel';
  if (/sem autorizacao/i.test(e))           return 'a pessoa não marcou a autorização';
  if (/WhatsApp não configurado/i.test(e))  return 'WhatsApp sem credenciais no painel';
  if (/Número inválido/i.test(e))           return 'número inválido';
  if (/^template .*(em análise|recusado|desativado|pausado|não existe)/i.test(e)) return e.slice(0, 140);
  // v171: os códigos de erro da Meta, em português
  var codigos = [
    [/131008/, 'faltou um dado que o template exige (variável vazia, imagem do cabeçalho ou botão)'],
    [/132000/, 'a quantidade de variáveis não bate com o template'],
    [/132001/, 'o template não existe nesse idioma'],
    [/132012/, 'uma variável foi no formato errado'],
    [/131026/, 'esse número não recebe mensagens no WhatsApp'],
    [/131049/, 'a Meta segurou a entrega (limite de mensagens de marketing por pessoa)'],
    [/130472/, 'a Meta não entregou marketing para esse número (experimento da Meta)'],
    [/131047/, 'fora da janela de 24h — só vai template'],
    [/131056/, 'muitas mensagens para o mesmo número em pouco tempo'],
    [/(^|\D)190(\D|$)|OAuth|access token/i, 'o token do WhatsApp venceu ou foi revogado']
  ];
  for (var i = 0; i < codigos.length; i++) if (codigos[i][0].test(e)) return codigos[i][1];
  return 'a Meta recusou: ' + e.slice(0, 140);
}
