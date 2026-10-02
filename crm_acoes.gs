// ============================================================
// crm_acoes.gs — ações no lead, de dentro do CRM (v172)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// Do detalhe da oportunidade: disparar um template de WhatsApp (com
// as variáveis já preenchidas e editáveis) e mandar e-mail de
// boas-vindas ou de recuperação de senha. Tudo entra no histórico do
// lead, com quem disparou e o resultado — inclusive quando falha.
// ============================================================

// Quem usa o CRM: admin e usuário de CRM. Aluno, nunca.
function _crmUsuarioAcao_(token) {
  var u = getUserByToken(token);
  return (u && (u.role === 'admin' || u.role === 'user')) ? u : null;
}

function _crmAcharLead_(leadId) {
  if (!leadId) return null;
  var sh = getSheet(SHEET_CRM);
  var d = sh.getDataRange().getValues();
  var cab = d[0].map(String);
  var iId = cab.indexOf('id');
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][iId]) !== String(leadId)) continue;
    var cf = {};
    try { cf = JSON.parse(String(d[i][cab.indexOf('custom_fields')] || '{}')) || {}; } catch (e) {}
    return {
      linha: i + 1,
      lead: { id: String(leadId), name: String(d[i][cab.indexOf('name')] || ''),
              email: String(d[i][cab.indexOf('email')] || '').toLowerCase().trim(),
              phone: String(d[i][cab.indexOf('phone')] || ''), cf: cf }
    };
  }
  return null;
}

// Conta ativa no app para este e-mail (null se não houver)
function _crmContaDoEmail_(email) {
  var alvo = String(email || '').toLowerCase().trim();
  if (!alvo) return null;
  var u = sheetToObjects(getSheet(SHEET_USERS)).filter(function (x) {
    return String(x.email || '').toLowerCase().trim() === alvo && x.active;
  })[0];
  return u || null;
}

// WhatsApp válido do lead, só dígitos (com DDI). Vazio se não der.
function _crmZap_(fone) {
  var d = String(fone || '').replace(/\D/g, '');
  if (d.indexOf('00') === 0) d = d.slice(2);   // discagem internacional (00 44…) — igual ao front
  if (!d) return '';
  var br = (typeof _tcE164_ === 'function') ? _tcE164_(d) : { ok: false };
  if (br.ok) return br.e164.replace(/\D/g, '');
  // Número de fora do Brasil (DDI que não é 55), já completo
  if (d.indexOf('55') !== 0 && d.length >= 11 && d.length <= 15) return d;
  return '';
}

// Registra no histórico do lead quem fez o quê
function _crmHistorico_(linha, texto, quem) {
  try {
    var sh = getSheet(SHEET_CRM);
    var cab = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    var iTl = cab.indexOf('timeline'), iUp = cab.indexOf('updated_at');
    if (iTl < 0) return;
    var cel = sh.getRange(linha, iTl + 1);
    var tl = [];
    try { tl = JSON.parse(String(cel.getValue() || '[]')); } catch (e) {}
    tl.push({ action: texto, user: quem || 'sistema', timestamp: nowISO() });
    cel.setValue(JSON.stringify(tl.slice(-60)));
    if (iUp >= 0) sh.getRange(linha, iUp + 1).setValue(nowISO());
    invalidateLeadsCache_();
  } catch (e) {}
}

// Dados do teste da pessoa (dias e fim), para preencher variáveis de data
function _crmCtxDoLead_(lead) {
  var ctx = { nome: lead.name, email: lead.email, dias: Number(lead.cf.oferta_dias) || 7, valor: '17,00' };
  try {
    var row = lead.email ? _getAssinaturaRow_(lead.email) : null;
    if (row) {
      ctx.dias = Number(row[_ASS_.TRIAL_DAYS]) || ctx.dias;
      var te = row[_ASS_.TRIAL_END];
      if (te) ctx.fimTeste = Utilities.formatDate(new Date(te), 'America/Sao_Paulo', 'dd/MM/yyyy');
    }
  } catch (e) {}
  return ctx;
}

// ─────────────────────────────────────────────────────────────
// ROTA: crmPrepararTemplate { leadId, template, idioma }
// O que o template pede e o valor sugerido de cada variável PARA ESTE
// lead (mapeamento salvo, se o template é um dos configurados; senão,
// pelo nome/posição da variável). O painel mostra, a pessoa edita.
// ─────────────────────────────────────────────────────────────
function crmPrepararTemplate(token, data) {
  var user = _crmUsuarioAcao_(token);
  if (!user) return { ok: false, error: 'Sem permissão.' };
  data = data || {};
  var achado = _crmAcharLead_(data.leadId);
  if (!achado) return { ok: false, error: 'Lead não encontrado.' };
  var nome = String(data.template || '').trim(), idioma = String(data.idioma || 'pt_BR');
  var est = _waEstrutura_(nome, idioma);
  if (!est || est.erro) return { ok: false, error: 'Não consegui ler esse template na Meta agora.' };
  if (est.status === 'NAO_EXISTE') return { ok: false, error: 'Esse template não existe mais na Meta.' };

  var salvo = '';
  [['wa_tpl_boasvindas_sc', 'wa_tpl_boasvindas_sc_vars'], ['wa_tpl_boasvindas', 'wa_tpl_boasvindas_vars'],
   ['wa_tpl_lembrete', 'wa_tpl_lembrete_vars'], ['wa_tpl_recuperacao', 'wa_tpl_recuperacao_vars']].forEach(function (p) {
    if (!salvo && String(_waCfg_(p[0])) === nome) salvo = String(_waCfg_(p[1], '[]'));
  });
  var mapa = [];
  try { mapa = JSON.parse(salvo || '[]'); } catch (e) {}

  var ctx = _crmCtxDoLead_(achado.lead);
  if (achado.lead.cf.origem === 'trial-cartao' && ctx.fimTeste) ctx.dataCobranca = ctx.fimTeste;
  var vars = ((est.corpo && est.corpo.vars) || []).map(function (v, i) {
    var fonte = (Array.isArray(mapa) ? mapa[i] : (mapa && mapa[v])) || _waFontePadrao_(v, i);
    return { nome: v, fonte: fonte, valor: _waResolverVar_(fonte, ctx) };
  });
  return { ok: true, data: {
    template: nome, idioma: est.idioma || idioma, status: est.status, categoria: est.categoria,
    formato: est.formato, texto: (est.corpo && est.corpo.texto) || '', vars: vars,
    header: est.header, botoes: (est.botoes || []).map(function (b) { return { tipo: b.tipo, temVar: b.temVar }; })
  } };
}

// ─────────────────────────────────────────────────────────────
// ROTA: crmEnviarTemplate { leadId, template, idioma, valores }
// `valores` = { nomeDaVariavel: texto } — o que o painel mostrou já
// preenchido e a pessoa pode ter editado. Vazio = preenche sozinho.
// ─────────────────────────────────────────────────────────────
function crmEnviarTemplate(token, data) {
  var user = _crmUsuarioAcao_(token);
  if (!user) return { ok: false, error: 'Sem permissão.' };
  if (typeof _rateLimit_ === 'function' && _rateLimit_('crm_wa', String(user.id || user.email), 60, 3600)) {
    return { ok: false, error: 'Muitos envios seguidos. Aguarde um pouco.' };
  }
  data = data || {};
  var achado = _crmAcharLead_(data.leadId);
  if (!achado) return { ok: false, error: 'Lead não encontrado.' };
  var lead = achado.lead;
  var fone = _crmZap_(lead.phone);
  if (!fone) return { ok: false, error: 'Esse lead não tem um WhatsApp válido.' };

  var nome = String(data.template || '').trim(), idioma = String(data.idioma || 'pt_BR');
  if (!nome) return { ok: false, error: 'Escolha o template.' };
  var est = _waEstrutura_(nome, idioma);
  if (!est || est.erro) return { ok: false, error: 'Não consegui ler esse template na Meta agora. Tente de novo.' };
  if (est.status !== 'APPROVED') return { ok: false, error: 'Esse template não está aprovado na Meta.' };

  // Texto digitado vira valor literal (prefixo txt:); vazio cai no padrão
  var valores = (data.valores && typeof data.valores === 'object') ? data.valores : {};
  var vars = (est.corpo && est.corpo.vars) || [];
  var literal = function (v, i) {
    var t = String(valores[v] == null ? '' : valores[v]).replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 900);
    return t ? 'txt:' + t : _waFontePadrao_(v, i);
  };
  var mapa;
  if (est.formato === 'NAMED') { mapa = {}; vars.forEach(function (v, i) { mapa[v] = literal(v, i); }); }
  else mapa = vars.map(function (v, i) { return literal(v, i); });

  var ctx = _crmCtxDoLead_(lead);
  var r = _waEnviarTemplate_(fone, nome, idioma, [], { mapaJson: JSON.stringify(mapa), ctx: ctx,
                                                       tipo: 'CRM (manual)', leadId: lead.id });
  var motivo = r.ok ? '' : ((typeof ritoMotivo_ === 'function') ? ritoMotivo_(r.error) : r.error);
  // v173: "aceito" não é "entregue" — a entrega entra no histórico quando a Meta avisar
  _crmHistorico_(achado.linha, r.ok ? 'WhatsApp: template "' + nome + '" aceito pela Meta'
                                    : 'WhatsApp: template "' + nome + '" não saiu — ' + motivo, user.email);
  logAction(user.email, r.ok ? 'CRM_WA_ENVIADO' : 'CRM_WA_FALHOU', 'lead', lead.id, nome + (r.ok ? '' : ' | ' + r.error));
  return r.ok ? { ok: true, id: r.id, message: 'Aceito pela Meta para +' + fone + '. A entrega aparece no histórico do lead.' }
              : { ok: false, error: motivo };
}

// ─────────────────────────────────────────────────────────────
// ROTA: crmEnviarEmail { leadId, tipo: 'boas_vindas' | 'recuperacao' }
// Boas-vindas: quem tem conta recebe o acesso (link do app — NÃO troca
// senha); quem não tem recebe o convite para o teste grátis.
// Recuperação: só para quem tem conta (manda o código de 6 dígitos).
// ─────────────────────────────────────────────────────────────
function crmEnviarEmail(token, data) {
  var user = _crmUsuarioAcao_(token);
  if (!user) return { ok: false, error: 'Sem permissão.' };
  if (typeof _rateLimit_ === 'function' && _rateLimit_('crm_mail', String(user.id || user.email), 40, 3600)) {
    return { ok: false, error: 'Muitos envios seguidos. Aguarde um pouco.' };
  }
  data = data || {};
  var achado = _crmAcharLead_(data.leadId);
  if (!achado) return { ok: false, error: 'Lead não encontrado.' };
  var lead = achado.lead;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lead.email)) return { ok: false, error: 'Esse lead não tem um e-mail válido.' };
  var conta = _crmContaDoEmail_(lead.email);
  var tipo = String(data.tipo || '');

  if (tipo === 'recuperacao') {
    if (!conta) return { ok: false, error: 'Esse e-mail não tem conta no app. Mande as boas-vindas.' };
    var rr = sendPasswordReset(lead.email);
    _crmHistorico_(achado.linha, rr.ok ? 'E-mail: código de recuperação de senha enviado'
                                       : 'E-mail: recuperação de senha não saiu — ' + (rr.error || ''), user.email);
    logAction(user.email, 'CRM_EMAIL_RECUPERACAO', 'lead', lead.id, rr.ok ? 'ok' : (rr.error || ''));
    return rr.ok ? { ok: true, message: 'Código de recuperação enviado para ' + lead.email + '.' }
                 : { ok: false, error: rr.error || 'Não consegui enviar.' };
  }

  if (tipo !== 'boas_vindas') return { ok: false, error: 'Tipo de e-mail desconhecido.' };
  var primeiro = String(lead.name || '').trim().split(/\s+/)[0] || 'tudo bem';
  var esc = function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var assunto, texto, html;
  if (conta) {
    assunto = 'Seu acesso ao Desafio 21 Dias';
    texto = 'Seu acesso ao Desafio 21 Dias esta pronto. Entre em https://app.wpktavares.com.br/?entrar=1 com ' +
            lead.email + '. Se nao lembrar a senha, toque em "Esqueci minha senha".';
    html = emMontarEmail_({
      preheader: 'Seu acesso está pronto — é só entrar.',
      titulo: 'Oi, ' + esc(primeiro) + '!',
      subtitulo: 'Seu acesso ao Desafio 21 Dias está pronto.',
      corpoHtml: 'Entre com o e-mail <strong>' + esc(lead.email) + '</strong> e a sua senha. ' +
                 'Se não lembrar, toque em <strong>Esqueci minha senha</strong> na tela de entrada — o código chega por e-mail.',
      btnTexto: 'Abrir o app', btnLink: 'https://app.wpktavares.com.br/?entrar=1',
      nota: 'Pode instalar o app no celular: abra o link e toque em "Instalar".',
      motivo: 'Você recebeu este e-mail porque tem uma conta no Desafio 21 Dias.',
      email: lead.email
    });
  } else {
    var dias = 7;
    try { dias = (typeof _trialDiasApp_ === 'function') ? _trialDiasApp_() : 7; } catch (e) {}
    assunto = primeiro + ', seu teste grátis do Desafio 21 Dias está te esperando';
    texto = 'Comece seu teste gratis de ' + dias + ' dias: https://wpktavares.com.br/checkout-trial/?dias=' + dias;
    html = emMontarEmail_({
      preheader: dias + ' dias grátis, sem cartão. Leva menos de 1 minuto.',
      titulo: 'Oi, ' + esc(primeiro) + '!',
      subtitulo: 'Seus ' + dias + ' dias grátis estão te esperando.',
      corpoHtml: 'Meditação guiada, leitura, exercício e áudios diários — um dia de cada vez, até virar hábito. ' +
                 'São <strong>' + dias + ' dias grátis</strong>, sem cartão.',
      btnTexto: 'Começar meu teste grátis',
      btnLink: 'https://wpktavares.com.br/checkout-trial/?dias=' + dias + '&utm_source=crm&utm_medium=email&utm_campaign=boas_vindas',
      nota: 'Se já tiver começado, é só entrar pelo app.',
      motivo: 'Você recebeu este e-mail porque deixou seu contato com o Desafio 21 Dias.',
      email: lead.email
    });
  }
  var env = _enviarEmailWpk_(lead.email, emAssuntoLimpo_(assunto), texto, html, 'crm');
  _crmHistorico_(achado.linha, env.ok ? 'E-mail de boas-vindas enviado' + (conta ? ' (acesso ao app)' : ' (convite para o teste)')
                                      : 'E-mail de boas-vindas não saiu — ' + (env.erro || ''), user.email);
  logAction(user.email, 'CRM_EMAIL_BOASVINDAS', 'lead', lead.id, env.ok ? env.via : env.erro);
  return env.ok ? { ok: true, message: 'Boas-vindas enviadas para ' + lead.email + '.' }
                : { ok: false, error: 'Não consegui enviar o e-mail agora.' };
}
