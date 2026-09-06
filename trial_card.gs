// ============================================================
// trial_card.gs — Trial COM cartão: OTP de e-mail, telefone
// normalizado e consentimento registrado (v141)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// Roda EM PARALELO ao trial sem cartão (registrarTrial_). Nada
// aqui toca no fluxo antigo — é requisito da spec, para permitir
// teste A/B e migração controlada.
//
// O código de verificação vive no CacheService, não em planilha:
// expira sozinho, não deixa rastro e não gasta escrita. Guardamos
// o HASH do código, nunca o código em claro.
// ============================================================

var TC_OTP_TTL_SEG      = 5 * 60;    // validade do código
var TC_OTP_MAX_TENT     = 5;         // tentativas por código
var TC_OTP_COOLDOWN_SEG = 60;        // espera mínima entre reenvios
var TC_OTP_MAX_ENVIOS   = 5;         // envios por e-mail a cada 30 min
var TC_TICKET_TTL_SEG   = 30 * 60;   // validade da verificação concluída
var TC_TRIALS_VALIDOS   = [7, 14, 21, 30];
var TC_TERMOS_VERSAO    = '2026-08-v1';

function _tcCache_() { return CacheService.getScriptCache(); }
function _tcNorm_(email) { return String(email || '').toLowerCase().trim(); }
function _tcHash_(s) { return _sha256Hex_(String(s)); }
function _tcChaveOtp_(email)    { return 'tcotp_' + _tcHash_(_tcNorm_(email)).substring(0, 32); }
function _tcChaveTicket_(email) { return 'tctk_'  + _tcHash_(_tcNorm_(email)).substring(0, 32); }
function _tcChaveEnvios_(email) { return 'tcenv_' + _tcHash_(_tcNorm_(email)).substring(0, 32); }

function _tcEmailValido_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(_tcNorm_(email));
}

// ─────────────────────────────────────────────────────────────
// Telefone para E.164. Cobre o que o brasileiro realmente digita:
// "(94) 99123-4567", "94991234567", "+55 94 99123 4567", "0055...".
// ─────────────────────────────────────────────────────────────
function _tcE164_(bruto) {
  var d = String(bruto || '').replace(/\D/g, '');
  if (!d) return { ok: false, erro: 'Informe seu WhatsApp.' };

  if (d.indexOf('00') === 0) d = d.slice(2);                    // discagem internacional
  if (d.length >= 12 && d.indexOf('55') === 0) d = d.slice(2);  // já vinha com DDI

  if (d.length === 10 || d.length === 11) {
    var ddd = parseInt(d.substring(0, 2), 10);
    if (ddd < 11 || ddd > 99) return { ok: false, erro: 'DDD inválido.' };

    // Celular brasileiro tem 9 dígitos e começa com 9. Um número de
    // 10 dígitos só é celular se o terceiro dígito já for 9.
    if (d.length === 10) {
      if (d.charAt(2) === '9') d = d.substring(0, 2) + '9' + d.substring(2);
      else return { ok: false, erro: 'Informe um celular com DDD.' };
    }
    if (d.charAt(2) !== '9') return { ok: false, erro: 'Informe um celular (com o 9 na frente).' };
    return { ok: true, e164: '+55' + d, nacional: d };
  }
  return { ok: false, erro: 'Número incompleto. Use DDD + número.' };
}

// ROTA PÚBLICA: validarWhatsappTrial — feedback imediato no formulário
function validarWhatsappTrial(data) {
  var r = _tcE164_((data || {}).whatsapp);
  return r.ok ? { ok: true, e164: r.e164 } : { ok: false, error: r.erro };
}

// ─────────────────────────────────────────────────────────────
// ROTA PÚBLICA: enviarCodigoTrial
// ─────────────────────────────────────────────────────────────
function enviarCodigoTrial(data) {
  data = data || {};
  var email = _tcNorm_(data.email);
  var nome  = String(data.nome || '').replace(/\s+/g, ' ').trim().slice(0, 80);

  if (!_tcEmailValido_(email)) return { ok: false, error: 'Informe um e-mail válido.' };

  var c = _tcCache_();

  // Cooldown: impede rajada de reenvio
  var st = _tcLerOtp_(email);
  if (st && st.enviadoEm && (Date.now() - st.enviadoEm) < TC_OTP_COOLDOWN_SEG * 1000) {
    var faltam = Math.ceil((TC_OTP_COOLDOWN_SEG * 1000 - (Date.now() - st.enviadoEm)) / 1000);
    return { ok: false, error: 'Aguarde ' + faltam + 's para pedir outro código.', espera: faltam };
  }

  // Teto de envios por e-mail na janela
  var kEnv = _tcChaveEnvios_(email);
  var envios = Number(c.get(kEnv) || 0) + 1;
  if (envios > TC_OTP_MAX_ENVIOS) {
    return { ok: false, error: 'Muitos códigos pedidos. Tente novamente em alguns minutos.' };
  }
  c.put(kEnv, String(envios), 30 * 60);

  var codigo = String(Math.floor(100000 + Math.random() * 900000));
  c.put(_tcChaveOtp_(email), JSON.stringify({
    hash: _tcHash_(codigo + '|' + email),
    tentativas: 0,
    enviadoEm: Date.now()
  }), TC_OTP_TTL_SEG);

  try {
    _enviarEmailWpk_(email, 'Seu codigo: ' + codigo,
      'Seu codigo de verificacao e ' + codigo + '. Ele vale por 5 minutos.',
      _tcEmailOtpHtml_(nome.split(' ')[0] || '', codigo));
  } catch (e) {
    logAction(email, 'TRIAL_OTP_EMAIL_FALHOU', 'checkout', '', e.message);
    return { ok: false, error: 'Nao consegui enviar o codigo agora. Tente de novo.' };
  }

  logAction(email, 'TRIAL_OTP_ENVIADO', 'checkout', '', '');
  return { ok: true, expiraEm: TC_OTP_TTL_SEG, cooldown: TC_OTP_COOLDOWN_SEG };
}

function _tcLerOtp_(email) {
  try {
    var raw = _tcCache_().get(_tcChaveOtp_(email));
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

// ─────────────────────────────────────────────────────────────
// ROTA PÚBLICA: verificarCodigoTrial
// Acertando, emite um TICKET no cache. O checkout exige o ticket:
// sem ele ninguém cria assinatura chamando a rota direto e pulando
// a verificação de e-mail.
// ─────────────────────────────────────────────────────────────
function verificarCodigoTrial(data) {
  data = data || {};
  var email  = _tcNorm_(data.email);
  var codigo = String(data.codigo || '').replace(/\D/g, '');

  if (!_tcEmailValido_(email)) return { ok: false, error: 'E-mail invalido.' };
  if (codigo.length !== 6)     return { ok: false, error: 'Digite os 6 digitos.' };

  var st = _tcLerOtp_(email);
  if (!st) return { ok: false, error: 'Codigo expirado. Peca um novo.', expirado: true };

  st.tentativas = Number(st.tentativas || 0) + 1;
  if (st.tentativas > TC_OTP_MAX_TENT) {
    _tcCache_().remove(_tcChaveOtp_(email));
    logAction(email, 'TRIAL_OTP_BLOQUEADO', 'checkout', '', 'excedeu tentativas');
    return { ok: false, error: 'Muitas tentativas. Peca um codigo novo.', expirado: true };
  }

  if (!_timingEq_(_tcHash_(codigo + '|' + email), String(st.hash))) {
    _tcCache_().put(_tcChaveOtp_(email), JSON.stringify(st), TC_OTP_TTL_SEG);
    var restam = TC_OTP_MAX_TENT - st.tentativas;
    return { ok: false, error: 'Codigo incorreto.' + (restam > 0 ? ' Restam ' + restam + ' tentativa(s).' : '') };
  }

  _tcCache_().remove(_tcChaveOtp_(email));   // uso único
  var ticket = Utilities.getUuid().replace(/-/g, '');
  _tcCache_().put(_tcChaveTicket_(email), _tcHash_(ticket), TC_TICKET_TTL_SEG);

  logAction(email, 'TRIAL_OTP_OK', 'checkout', '', '');
  return { ok: true, ticket: ticket, validoPor: TC_TICKET_TTL_SEG };
}

function _tcTicketValido_(email, ticket) {
  if (!ticket) return false;
  var guardado = _tcCache_().get(_tcChaveTicket_(email));
  return !!guardado && _timingEq_(String(guardado), _tcHash_(String(ticket)));
}

// ─────────────────────────────────────────────────────────────
// Consentimento — a spec pede timestamp e versão dos termos.
// Fica numa aba própria: é prova de que a pessoa concordou com
// cobrança automática, e precisa sobreviver a qualquer refatoração.
// ─────────────────────────────────────────────────────────────
var TC_ABA_CONSENT = 'consentimentos';

function _tcAbaConsent_() {
  var ss = getSpreadsheet_();
  var aba = ss.getSheetByName(TC_ABA_CONSENT);
  if (!aba) {
    aba = ss.insertSheet(TC_ABA_CONSENT);
    var cab = ['id','email','whatsapp','nome','trial_dias','valor_pos_trial',
               'termos_versao','aceito_em','origem','campanha'];
    aba.appendRow(cab);
    aba.getRange(1, 1, 1, cab.length)
       .setFontWeight('bold').setBackground('#6c47ff').setFontColor('#ffffff');
    aba.setFrozenRows(1);
  }
  return aba;
}

function _tcRegistrarConsentimento_(dados) {
  try {
    _tcAbaConsent_().appendRow([
      generateId(),
      _tcNorm_(dados.email),
      String(dados.whatsapp || ''),
      String(dados.nome || ''),
      Number(dados.trialDias) || 0,
      Number(dados.valor) || 0,
      TC_TERMOS_VERSAO,
      nowISO(),
      String(dados.origem || ''),
      String(dados.campanha || '')
    ]);
    return true;
  } catch (e) {
    logAction(dados && dados.email, 'CONSENT_FALHOU', 'checkout', '', e.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// E-mail do código
// ─────────────────────────────────────────────────────────────
function _tcEmailOtpHtml_(nome, codigo) {
  var abre = nome ? '<p style="margin:0 0 14px">Oi, ' + nome + '!</p>' : '';
  return '' +
  '<div style="margin:0;padding:28px 16px;background:#f4f6f4;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">' +
    '<div style="max-width:460px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 14px rgba(0,0,0,.07)">' +
      '<div style="background:linear-gradient(135deg,#4caf50,#2e7d32);padding:22px 26px">' +
        '<div style="color:rgba(255,255,255,.72);font-size:11px;letter-spacing:2px;text-transform:uppercase">WPK Tavares</div>' +
        '<div style="color:#fff;font-size:18px;font-weight:800;margin-top:4px">Confirme seu e-mail</div>' +
      '</div>' +
      '<div style="padding:26px;color:#2c3a30;font-size:14.5px;line-height:1.65">' +
        abre +
        '<p style="margin:0 0 18px">Use o codigo abaixo para continuar e comecar seu periodo gratuito:</p>' +
        '<div style="text-align:center;margin:22px 0">' +
          '<div style="display:inline-block;background:#f2f7f3;border:1px solid #d7e6da;border-radius:12px;' +
                      'padding:15px 26px;font-size:31px;font-weight:800;letter-spacing:9px;color:#2e7d32">' + codigo + '</div>' +
        '</div>' +
        '<p style="margin:0;color:#7a8a7e;font-size:13px">O codigo vale por 5 minutos e so pode ser usado uma vez.</p>' +
      '</div>' +
      '<div style="padding:16px 26px;border-top:1px solid #eef1ee;color:#8a9a8e;font-size:11.5px">' +
        'Se nao foi voce quem pediu, ignore este e-mail.' +
      '</div>' +
    '</div>' +
  '</div>';
}

// ─────────────────────────────────────────────────────────────
// Handler do payment_method.attached — confirma que o cartão
// ficou salvo no Customer. Só registra: quem manda no acesso
// continua sendo o evento de assinatura.
// ─────────────────────────────────────────────────────────────
function _stripeOnPmAttached_(pm) {
  try {
    var cust = pm && pm.customer;
    if (!cust) return;
    var info = _stripeCall_('get', '/v1/customers/' + encodeURIComponent(cust));
    var email = (info && info.email) ? String(info.email).toLowerCase().trim() : '';
    var marca = (pm.card && pm.card.brand) || pm.type || 'cartao';
    var fim   = (pm.card && pm.card.last4) ? ' final ' + pm.card.last4 : '';
    logAction(email || cust, 'STRIPE_PM_ANEXADO', 'checkout', pm.id, marca + fim);
  } catch (e) {
    logAction('system', 'STRIPE_PM_ERRO', 'webhook', '', e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// ROTA PÚBLICA: criarCheckoutTrialCartao
// Porta única do trial com cartão. Exige, nesta ordem:
//   e-mail verificado por OTP (ticket) → WhatsApp válido →
//   consentimento explícito → então cria a sessão no Stripe.
// O Stripe não cobra nada agora: em mode=subscription com
// trial_period_days ele valida e guarda o cartão, e só cobra no
// fim do período.
// ─────────────────────────────────────────────────────────────
function criarCheckoutTrialCartao(data) {
  data = data || {};
  var email = _tcNorm_(data.email);
  var nome  = String(data.nome || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  var dias  = parseInt(data.dias, 10);

  if (!_tcEmailValido_(email))             return { ok: false, error: 'Informe um e-mail valido.' };
  if (nome.length < 3)                     return { ok: false, error: 'Informe seu nome completo.' };
  if (TC_TRIALS_VALIDOS.indexOf(dias) < 0) return { ok: false, error: 'Periodo de teste invalido.' };

  // 1) e-mail precisa ter passado pelo código
  if (!_tcTicketValido_(email, data.ticket)) {
    return { ok: false, error: 'Confirme seu e-mail antes de continuar.', precisaVerificar: true };
  }

  // 2) WhatsApp normalizado
  var tel = _tcE164_(data.whatsapp);
  if (!tel.ok) return { ok: false, error: tel.erro };

  // 3) consentimento explícito — sem isso não há cobrança automática
  if (data.consentimento !== true && data.consentimento !== 'true') {
    return { ok: false, error: 'Voce precisa concordar com os termos para comecar.' };
  }

  _tcRegistrarConsentimento_({
    email: email, whatsapp: tel.e164, nome: nome, trialDias: dias,
    valor: 17, origem: data.origem || 'checkout-trial', campanha: data.campanha || ''
  });

  // Guarda o lead antes do Stripe: se a pessoa abandonar o cartão,
  // ainda temos nome, e-mail e WhatsApp para recuperar.
  try {
    // v154: `dias` faltava aqui. salvarLeadIncompleto_ faz
    // `parseInt(data.dias) || 7`, entao TODO trial com cartao era gravado
    // como OfertaDias=7 — mesmo com a origem dizendo 'trial-cartao-14d'.
    salvarLeadIncompleto_({ nome: nome, email: email, whatsapp: tel.e164,
                            dias: dias, estagio: 'cartao_iniciado',
                            origem: 'trial-cartao-' + dias + 'd' });
  } catch (e) {}

  // v159: indicacao. Registrada AQUI, antes do Stripe: se a pessoa
  // desistir no cartao, quem indicou ainda ve que levou alguem ate o fim
  // do formulario — e o dado nao depende de a assinatura existir.
  try {
    if (data.ref) {
      indRegistrarConversao_(data.ref, email, nome, 'cadastro', dias, 'checkout-cartao');
    }
  } catch (e) {}

  var r = criarCheckoutStripe({
    plan: 'monthly',
    trialDays: dias,
    email: email,
    intent: 'new',
    origin: 'custom',
    // v154: viajam junto para a metadata da assinatura. Sem isso o
    // webhook so tem o e-mail, e nao sabe nem o periodo contratado.
    nome: nome,
    whatsapp: tel.e164,
    campanha: data.campanha || '',
    ref: String(data.ref || ''),
    origemCheckout: data.origem || 'checkout-trial-cartao',
    returnUrl: String(data.returnUrl || 'https://wpktavares.com.br/checkout-trial/')
  });
  if (!r || !r.ok) return r || { ok: false, error: 'Nao consegui abrir o checkout.' };

  // v144: publico qualificado (e-mail verificado + WhatsApp + consentimento)
  try {
    capiTrialIniciado_({ email: email, nome: nome, whatsapp: tel.e164, dias: dias,
                         fbp: data.fbp, fbc: data.fbc, client_ua: data.userAgent,
                         url: data.returnUrl });
  } catch (e) {}

  logAction(email, 'TRIAL_CARTAO_CHECKOUT', 'checkout', '', dias + ' dias | ' + tel.e164);
  return { ok: true, url: r.url, sessionId: r.sessionId || r.id, dias: dias, whatsapp: tel.e164 };
}
