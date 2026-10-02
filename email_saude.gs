// ============================================================
// email_saude.gs — registro e saúde dos e-mails (v166)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// Até a v165 o envio falhava em silêncio: _resendEnviar_ jogava
// fora a resposta do Resend, e a recuperação de senha respondia
// "código enviado" mesmo quando nenhum canal tinha conseguido.
// Não havia como saber o que aconteceu com um e-mail.
//
// Agora cada tentativa vira uma linha na aba emails_log: para
// quem, por qual canal, se deu certo e, quando não deu, o erro
// que o provedor devolveu. O painel lê daqui, e o próprio Resend
// informa se a mensagem foi entregue, rejeitada ou devolvida.
// ============================================================

var EMAIL_LOG_ABA = 'emails_log';
var EMAIL_LOG_CAB = ['quando', 'tipo', 'para', 'assunto', 'via', 'ok', 'resend_id', 'erro'];
var EMAIL_LOG_MAX = 3000;   // passou disso, apaga as linhas mais antigas

function _emailAbaLog_() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(EMAIL_LOG_ABA);
  if (!sh) {
    sh = ss.insertSheet(EMAIL_LOG_ABA);
    sh.appendRow(EMAIL_LOG_CAB);
    sh.getRange(1, 1, 1, EMAIL_LOG_CAB.length).setFontWeight('bold')
      .setBackground('#1b5e20').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Nunca derruba o envio: se o registro falhar, o e-mail já foi.
function _emailRegistrar_(d) {
  try {
    var sh = _emailAbaLog_();
    sh.appendRow([
      nowISO(),
      String(d.tipo || ''),
      String(d.para || '').toLowerCase().trim(),
      String(d.assunto || '').slice(0, 140),
      String(d.via || ''),
      d.ok ? 'sim' : 'nao',
      String(d.id || ''),
      String(d.erro || '').slice(0, 400)
    ]);
    var n = sh.getLastRow();
    if (n > EMAIL_LOG_MAX + 200) sh.deleteRows(2, n - 1 - EMAIL_LOG_MAX);
  } catch (e) {}
}

// Tipo pelo assunto, para quem chama _enviarEmailWpk_ sem dizer
function _emailTipo_(assunto) {
  var s = String(assunto || '').toLowerCase();
  if (s.indexOf('recupera') >= 0)                                   return 'senha';
  if (s.indexOf('código de acesso') >= 0 || s.indexOf('codigo de acesso') >= 0) return '2fa';
  if (s.indexOf('link de acesso') >= 0)                             return 'link-admin';
  if (s.indexOf('seu codigo') >= 0 || s.indexOf('seu código') >= 0) return 'codigo';
  if (s.indexOf('teste') >= 0 || s.indexOf('acesso ao desafio') >= 0) return 'trial';
  return 'geral';
}

// Tira endereços de e-mail de uma mensagem de erro (vai para rota pública)
function _emailSemEndereco_(s) {
  return String(s || '').replace(/[^\s@<>"'()]+@[^\s@<>"'()]+/g, '[e-mail]').slice(0, 300);
}

function _emailUltimos_(n) {
  try {
    var sh = _emailAbaLog_();
    var ult = sh.getLastRow();
    if (ult < 2) return [];
    var qtd = Math.min(n, ult - 1);
    var d = sh.getRange(ult - qtd + 1, 1, qtd, EMAIL_LOG_CAB.length).getValues();
    return d.reverse().map(function (r) {
      return {
        quando: r[0] instanceof Date ? r[0].toISOString() : String(r[0] || ''),
        tipo: String(r[1] || ''), para: String(r[2] || ''), assunto: String(r[3] || ''),
        via: String(r[4] || ''), ok: String(r[5]) === 'sim',
        id: String(r[6] || ''), erro: String(r[7] || '')
      };
    });
  } catch (e) { return []; }
}

function _emailResumo_(linhas, desdeMs) {
  var r = { total: 0, resend: 0, gmail: 0, mailapp: 0, falhas: 0, resendFalhou: 0 };
  var ultimaFalha = null, ultimoErroResend = null;
  linhas.forEach(function (l) {
    var t = new Date(l.quando).getTime();
    if (!(t >= desdeMs)) return;
    r.total++;
    if (!l.ok) {
      r.falhas++;
      if (!ultimaFalha) ultimaFalha = { quando: l.quando, tipo: l.tipo, erro: l.erro };
    } else if (l.via === 'resend') r.resend++;
    else if (l.via === 'gmail-owner') r.gmail++;
    else if (l.via === 'mailapp-html') r.mailapp++;
    // Resend que falhou e caiu no Gmail: o e-mail saiu, mas o canal
    // principal está com problema — é isso que mais importa enxergar.
    if (l.erro.indexOf('resend:') === 0) {
      r.resendFalhou++;
      if (!ultimoErroResend) ultimoErroResend = { quando: l.quando, erro: l.erro.split(' | ')[0] };
    }
  });
  return { contagem: r, ultimaFalha: ultimaFalha, ultimoErroResend: ultimoErroResend };
}

// ─────────────────────────────────────────────────────────────
// Resend: domínio e situação de entrega. A chave fica no servidor.
// ─────────────────────────────────────────────────────────────
function _resendChave_() {
  try { return PropertiesService.getScriptProperties().getProperty('RESEND_API_KEY') || ''; }
  catch (e) { return ''; }
}

function _resendDominio_() {
  var key = _resendChave_();
  if (!key) return { status: 'sem_chave' };
  var c = CacheService.getScriptCache();
  var guardado = c.get('resend_dom');
  if (guardado) { try { return JSON.parse(guardado); } catch (e) {} }

  var out;
  try {
    var r = UrlFetchApp.fetch('https://api.resend.com/domains', {
      headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true
    });
    var code = r.getResponseCode();
    var j = {};
    try { j = JSON.parse(r.getContentText()); } catch (e) {}
    if (code === 200) {
      var d = (j.data || []).filter(function (x) { return String(x.name) === 'wpktavares.com.br'; })[0];
      out = d ? { status: String(d.status || 'desconhecido'), regiao: String(d.region || '') }
              : { status: 'nao_cadastrado' };
    } else if (code === 401 || code === 403) {
      // Chave "só de envio" não lista domínios. Não é defeito: o
      // resultado de cada envio continua dizendo se o Resend aceitou.
      out = { status: String(j.name) === 'restricted_api_key' ? 'chave_so_envio' : 'chave_recusada',
              http: code, msg: String(j.message || '').slice(0, 160) };
    } else {
      out = { status: 'erro', http: code, msg: String(j.message || '').slice(0, 160) };
    }
  } catch (e) {
    out = { status: 'erro', msg: String(e.message || '').slice(0, 160) };
  }
  try { c.put('resend_dom', JSON.stringify(out), 300); } catch (e) {}
  return out;
}

// O que aconteceu com cada mensagem depois que o Resend aceitou
function _resendStatusEmails_(ids) {
  var key = _resendChave_();
  var out = {};
  if (!key || !ids.length) return out;
  var c = CacheService.getScriptCache(), faltam = [];
  ids.forEach(function (id) {
    var v = c.get('rs_' + id);
    if (v) out[id] = v; else faltam.push(id);
  });
  faltam = faltam.slice(0, 12);
  if (!faltam.length) return out;
  try {
    var resps = UrlFetchApp.fetchAll(faltam.map(function (id) {
      return { url: 'https://api.resend.com/emails/' + encodeURIComponent(id),
               headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true };
    }));
    resps.forEach(function (r, i) {
      var id = faltam[i], ev = '';
      var code = r.getResponseCode();
      if (code === 200) { try { ev = String(JSON.parse(r.getContentText()).last_event || ''); } catch (e) {} }
      else if (code === 401 || code === 403) ev = 'sem_permissao';
      if (!ev) return;
      out[id] = ev;
      // estados finais ficam em cache; "enviado"/"na fila" ainda mudam
      if (ev !== 'sent' && ev !== 'queued' && ev !== 'scheduled') {
        try { c.put('rs_' + id, ev, 900); } catch (e) {}
      }
    });
  } catch (e) {}
  return out;
}

// ─────────────────────────────────────────────────────────────
// ROTA ADMIN: getEmailSaude — o painel de e-mails
// ─────────────────────────────────────────────────────────────
function getEmailSaude(token) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };

  var linhas = _emailUltimos_(300);
  var recentes = linhas.slice(0, 60);
  var ids = recentes.filter(function (l) { return l.via === 'resend' && l.id; })
                    .slice(0, 12).map(function (l) { return l.id; });
  var st = _resendStatusEmails_(ids);
  recentes.forEach(function (l) { if (l.id && st[l.id]) l.entrega = st[l.id]; });

  var cota = -1, conta = '';
  try { cota = MailApp.getRemainingDailyQuota(); } catch (e) {}
  try { conta = Session.getEffectiveUser().getEmail(); } catch (e) {}

  return { ok: true, data: {
    resend: { configurado: !!_resendChave_(), chaveMascarada: _resendChaveMascarada_(),
              dominio: _resendDominio_(), remetente: EMAIL_REMETENTE_RESEND },
    gmail:  { conta: conta, cotaHoje: cota },
    ultimas24h: _emailResumo_(linhas, Date.now() - 86400000),
    ultimos: recentes
  } };
}

// ─────────────────────────────────────────────────────────────
// ROTA PÚBLICA: getEmailStatus — só números e estado do canal.
// Nenhum endereço sai daqui (erros passam por _emailSemEndereco_).
// Existe para conferir de fora, depois de um deploy, se o e-mail
// está saindo — sem precisar de sessão de admin.
// ─────────────────────────────────────────────────────────────
function getEmailStatus() {
  var c = CacheService.getScriptCache();
  var guardado = c.get('email_status_pub');
  if (guardado) { try { return JSON.parse(guardado); } catch (e) {} }

  var res = _emailResumo_(_emailUltimos_(300), Date.now() - 86400000);
  var limpa = function (x) {
    return x ? { quando: x.quando, tipo: x.tipo || '', erro: _emailSemEndereco_(x.erro) } : null;
  };
  var out = { ok: true, data: {
    resendConfigurado: !!_resendChave_(),
    dominio: _resendDominio_().status,
    ultimas24h: res.contagem,
    ultimaFalha: limpa(res.ultimaFalha),
    ultimoErroResend: limpa(res.ultimoErroResend)
  } };
  try { c.put('email_status_pub', JSON.stringify(out), 60); } catch (e) {}
  return out;
}

// ─────────────────────────────────────────────────────────────
// ROTA ADMIN: testarEnvioEmail — manda um e-mail de teste e diz
// por qual canal saiu. Substitui o antigo diagEmailSample, que era
// público e mandava para qualquer endereço informado.
// ─────────────────────────────────────────────────────────────
function testarEnvioEmail(token, data) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  if (typeof _rateLimit_ === 'function' && _rateLimit_('emailteste', String(user.id || user.email), 10, 3600)) {
    return { ok: false, error: 'Muitos testes seguidos. Aguarde um pouco.' };
  }
  var para = String((data && data.para) || user.email || '').toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(para)) return { ok: false, error: 'E-mail inválido.' };

  var quando = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM HH:mm');
  var html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px;background:#f4f6f4">' +
    '<div style="max-width:440px;margin:0 auto;background:#fff;border-radius:14px;padding:24px;color:#2c3a30">' +
    '<div style="font-size:18px;font-weight:800;margin-bottom:8px">Teste de envio</div>' +
    '<div style="font-size:14px;line-height:1.6">Se este e-mail chegou, o envio do Desafio 21 Dias está funcionando. ' +
    'Pedido pelo painel em ' + quando + '.</div></div></div>';
  var d = _enviarEmailWpk_(para, 'Teste de envio — Desafio 21 Dias',
    'Se este e-mail chegou, o envio esta funcionando. Pedido em ' + quando + '.', html, 'teste');
  logAction(user.email, 'EMAIL_TESTE', 'email', para, (d.via || 'falhou') + (d.erro ? ' | ' + d.erro : ''));
  return d.ok
    ? { ok: true, via: d.via, erro: d.erro, message: 'Enviado para ' + para + ' pelo ' + _emailViaNome_(d.via) + '.' }
    : { ok: false, error: 'Nenhum canal conseguiu enviar. ' + d.erro };
}

// ─────────────────────────────────────────────────────────────
// ROTA ADMIN: salvarResendChave — a chave vai do painel direto para
// as Script Properties. Nunca passa por código, planilha ou chat.
// É testada ANTES de guardar: chave recusada, ou de uma conta do
// Resend sem o domínio wpktavares.com.br, não entra.
// ─────────────────────────────────────────────────────────────
function salvarResendChave(token, data) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissão.' };
  data = data || {};
  var props = PropertiesService.getScriptProperties();
  var limpar = function () {
    try { CacheService.getScriptCache().removeAll(['resend_dom', 'email_status_pub']); } catch (e) {}
  };

  if (data.remover === true) {
    props.deleteProperty('RESEND_API_KEY');
    limpar();
    logAction(user.email, 'RESEND_CHAVE_REMOVIDA', 'email', '', '');
    return { ok: true, message: 'Chave removida. Os e-mails voltam a sair só pelo Gmail.' };
  }

  var chave = String(data.chave || '').trim();
  if (!/^re_[A-Za-z0-9_]{10,}$/.test(chave)) {
    return { ok: false, error: 'Isso não parece uma chave do Resend — ela começa com re_.' };
  }

  var r, code, j = {};
  try {
    r = UrlFetchApp.fetch('https://api.resend.com/domains', {
      headers: { Authorization: 'Bearer ' + chave }, muteHttpExceptions: true
    });
    code = r.getResponseCode();
    try { j = JSON.parse(r.getContentText()); } catch (e) {}
  } catch (e) {
    return { ok: false, error: 'Não consegui falar com o Resend agora: ' + e.message };
  }

  // Chave "só de envio" não pode listar domínios — é a mais segura, e vale.
  var soEnvio = (code === 401 || code === 403) && String(j.name) === 'restricted_api_key';
  if (code !== 200 && !soEnvio) {
    return { ok: false, error: 'O Resend recusou esta chave (HTTP ' + code + (j.message ? ': ' + String(j.message).slice(0, 160) : '') + ').' };
  }
  if (code === 200) {
    var dom = (j.data || []).filter(function (x) { return String(x.name) === 'wpktavares.com.br'; })[0];
    if (!dom) {
      return { ok: false, error: 'Esta conta do Resend não tem o domínio wpktavares.com.br. ' +
                                 'Use a chave da conta onde ele foi cadastrado.' };
    }
    if (String(dom.status) !== 'verified') {
      return { ok: false, error: 'O domínio wpktavares.com.br está "' + dom.status + '" nesta conta do Resend — ' +
                                 'termine a verificação lá antes de usar a chave.' };
    }
  }

  props.setProperty('RESEND_API_KEY', chave);
  limpar();
  logAction(user.email, 'RESEND_CHAVE_SALVA', 'email', '', soEnvio ? 'so envio' : 'acesso completo');
  return { ok: true, soEnvio: soEnvio,
           message: 'Chave salva' + (soEnvio ? ' (só de envio)' : ' e domínio conferido') +
                    '. Os próximos e-mails já saem pelo Resend.' };
}

function _resendChaveMascarada_() {
  var k = _resendChave_();
  return k ? 're_••••••' + k.slice(-4) : '';
}

function _emailViaNome_(via) {
  return via === 'resend' ? 'Resend (suporte@wpktavares.com.br)'
       : via === 'gmail-owner' ? 'Gmail da conta do sistema'
       : via === 'mailapp-html' ? 'MailApp' : via;
}
