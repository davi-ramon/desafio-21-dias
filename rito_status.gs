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
                   meta: metaSc, faltas: fSc },
      cartao:    { ligado: cartaoLigado, template: tplCartao, meta: metaCartao, faltas: fCartao }
    },
    rotinaStripe: rotina,
    pronto: { semCartao: !fSc.length, cartao: !fCartao.length && emailCartao }
  } };
  try { c.put('rito_status', JSON.stringify(out), 120); } catch (e) {}
  return out;
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
  return 'a Meta recusou: ' + e.slice(0, 140);
}
