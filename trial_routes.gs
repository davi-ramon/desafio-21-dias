// ============================================================
// trial_routes.gs — Sistema de Trial Gratuito (sem cartão)
// Desafio 21 Dias — WPK Tavares
// ============================================================

var SHEET_TRIAL_LEADS = 'trial_leads';

// ─────────────────────────────────────────────────────────────
// ROTA PÚBLICA: salvar lead INCOMPLETO (abandono de checkout)
// POST action=salvarLeadIncompleto { nome, email, whatsapp, dias, estagio, origem }
// Faz upsert por email (ou whatsapp). Base p/ recuperação futura.
// ─────────────────────────────────────────────────────────────
function salvarLeadIncompleto_(data) {
  try {
    var nome     = String(data.nome     || '').trim();
    var email    = String(data.email    || '').toLowerCase().trim();
    var whatsapp = String(data.whatsapp || '').replace(/\D/g, '');
    var dias     = parseInt(data.dias) || 7;
    var estagio  = String(data.estagio || '').trim();   // ex: 'nome', 'email', 'whatsapp'
    var origem   = String(data.origem  || '').trim();   // ex: '/checkout-trial/?dias=7'

    // precisa de pelo menos email ou whatsapp pra valer
    if (!email && whatsapp.length < 10) return { ok: false, error: 'Sem identificador.' };

    var ss = getSpreadsheet_();
    var sh = ss.getSheetByName(SHEET_TRIAL_LEADS);
    if (!sh) {
      sh = ss.insertSheet(SHEET_TRIAL_LEADS);
      sh.appendRow([
        'CriadoEm','Nome','Email','WhatsApp','OfertaDias',
        'Estagio','Origem','Status','Convertido','AtualizadoEm'
      ]);
      sh.getRange(1,1,1,10).setFontWeight('bold').setBackground('#1a237e').setFontColor('#ffffff');
      sh.setFrozenRows(1);
    }

    var now  = new Date().toISOString();
    var rows = sh.getDataRange().getValues();

    // procura lead existente (por email; senão por whatsapp)
    for (var i = 1; i < rows.length; i++) {
      var rEmail = String(rows[i][2] || '').toLowerCase().trim();
      var rWa    = String(rows[i][3] || '').replace(/\D/g, '');
      var match  = (email && rEmail === email) || (whatsapp.length >= 10 && rWa === whatsapp);
      if (match) {
        // atualiza campos preenchidos + estágio + timestamp
        if (nome)     sh.getRange(i+1, 2).setValue(nome);
        if (email)    sh.getRange(i+1, 3).setValue(email);
        if (whatsapp) sh.getRange(i+1, 4).setValue('+' + whatsapp);
        sh.getRange(i+1, 5).setValue(dias);
        if (estagio)  sh.getRange(i+1, 6).setValue(estagio);
        if (origem)   sh.getRange(i+1, 7).setValue(origem);
        sh.getRange(i+1, 10).setValue(now);
        return { ok: true, updated: true };
      }
    }

    // novo lead incompleto
    sh.appendRow([
      now, nome, email, whatsapp ? '+' + whatsapp : '', dias,
      estagio, origem, 'incompleto', 'nao', now
    ]);
    return { ok: true, created: true };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// Marca lead como convertido quando o trial é criado (chamado por registrarTrial_)
function _marcarLeadConvertido_(email, whatsapp) {
  try {
    var ss = getSpreadsheet_();
    var sh = ss.getSheetByName(SHEET_TRIAL_LEADS);
    if (!sh) return;
    var emailN = String(email || '').toLowerCase().trim();
    var waN    = String(whatsapp || '').replace(/\D/g, '');
    var rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var rEmail = String(rows[i][2] || '').toLowerCase().trim();
      var rWa    = String(rows[i][3] || '').replace(/\D/g, '');
      if ((emailN && rEmail === emailN) || (waN.length >= 10 && rWa === waN)) {
        sh.getRange(i+1, 8).setValue('convertido');
        sh.getRange(i+1, 9).setValue('sim');
        sh.getRange(i+1, 10).setValue(new Date().toISOString());
        return;
      }
    }
  } catch(e) {}
}

// ─────────────────────────────────────────────────────────────
// ROTA PÚBLICA: registrar lead no trial gratuito
// POST action=registrarTrial { nome, email, whatsapp, dias }
// ─────────────────────────────────────────────────────────────
function registrarTrial_(data) {
  var nome     = String(data.nome     || '').trim();
  var email    = String(data.email    || '').toLowerCase().trim();
  var whatsapp = String(data.whatsapp || '').replace(/\D/g, '');
  var dias     = parseInt(data.dias)  || 7;

  // ── Validações ────────────────────────────────────────────
  if (!nome || nome.length < 3)
    return { ok: false, error: 'Digite seu nome completo.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { ok: false, error: 'E-mail inválido.' };
  if (whatsapp.length < 10 || whatsapp.length > 13)
    return { ok: false, error: 'WhatsApp inválido. Digite com DDD (ex: 11999999999).' };
  if ([7, 14, 21].indexOf(dias) < 0) dias = 7;

  // Normaliza WhatsApp: garante código Brasil 55
  if (!whatsapp.startsWith('55') && whatsapp.length <= 11) {
    whatsapp = '55' + whatsapp;
  }

  var ss    = getSpreadsheet_();
  var users = ss.getSheetByName(SHEET_USERS);

  // ── Verifica se e-mail já existe ──────────────────────────
  var existingUsers = sheetToObjects(users);
  var existingUser  = existingUsers.find(function(u) {
    return String(u.email || '').toLowerCase().trim() === email;
  });

  if (existingUser) {
    var assRow = _getAssinaturaRow_(email);
    if (assRow) {
      var currentStatus = String(assRow[_ASS_.APP_STATUS] || '');
      if (currentStatus === AS.ACTIVE) {
        return { ok: false, error: 'Este e-mail já possui uma assinatura ativa. Acesse: app.wpktavares.com.br' };
      }
      if (currentStatus === AS.TRIAL) {
        return { ok: false, error: 'Este e-mail já está em período de trial. Acesse: app.wpktavares.com.br' };
      }
    }
  }

  // v159: indicacao tambem vale no trial sem cartao
  try {
    if (data.ref) indRegistrarConversao_(data.ref, email, nome, 'cadastro', dias, 'trial-sem-cartao');
  } catch (e) {}

  var now      = new Date();
  var trialFim = new Date(now.getTime() + dias * 86400000).toISOString();
  var orderId  = 'TRIAL-' + dias + 'D-' + Date.now();

  // Sempre gera senha temporária → o e-mail SEMPRE entrega credenciais.
  var senha = _gerarSenhaTrial_();
  var hash  = hashPassword(senha);
  if (!existingUser) {
    users.appendRow([generateId(), nome, email, hash, 'aluno', '', true, now.toISOString()]);
  } else {
    // Reativação (usuário lapso/expirado): reseta p/ a nova senha temporária
    _resetSenhaUsuario_(email, hash);
  }

  // ── Cria entrada em compradores (se não existir) ──────────
  var comp = ss.getSheetByName(SHEET_COMPRADORES);
  if (comp) {
    var compRows = comp.getDataRange().getValues();
    var inComp   = false;
    for (var i = 1; i < compRows.length; i++) {
      if (String(compRows[i][COL_COMP.EMAIL] || '').toLowerCase().trim() === email) {
        inComp = true; break;
      }
    }
    if (!inComp) {
      var row = new Array(38).fill('');
      row[COL_COMP.ORDER_ID]   = orderId;
      row[COL_COMP.EMAIL]      = email;
      row[COL_COMP.STATUS]     = 'active';
      row[COL_COMP.NOME]       = nome;
      row[COL_COMP.TELEFONE]   = '+' + whatsapp;
      row[COL_COMP.PAID_AT]    = now.toISOString();
      row[COL_COMP.CREATED_AT] = now.toISOString();
      row[COL_COMP.PRODUTO]    = 'Desafio 21 Dias — Trial ' + dias + ' dias';
      row[COL_COMP.DIA_ATUAL]  = 0;
      row[COL_COMP.ATIVO]      = true;
      comp.appendRow(row);
    }
  }

  // ── Cria / atualiza assinatura ────────────────────────────
  _upsertAssinatura_(email, {
    sub_id:       orderId,
    cakto_status: 'trial',
    app_status:   AS.TRIAL,
    plan:         'monthly',
    trial_start:  now.toISOString(),
    trial_end:    trialFim,
    trial_days:   dias,
    trial_rem:    dias,
    next_billing: trialFim,
    amount:       0,
  });
  _syncAcesso_(email, AS.TRIAL);

  // ── E-mail de boas-vindas (sempre com credenciais) ────────
  try {
    _enviarBoasVindasTrial_(email, nome, senha, dias);
  } catch(e) {
    logAction('system', 'TRIAL_EMAIL_ERRO', 'user', email, e.message);
    try {
      MailApp.sendEmail(email, 'Seu acesso ao Desafio 21 Dias esta pronto!',
        'Ola ' + nome + '!\n\nSeu trial de ' + dias + ' dias esta ativo.\n' +
        'E-mail: ' + email + '\nSenha provisoria: ' + senha +
        '\n\nAcesse: https://app.wpktavares.com.br',
        _optsFromWpk_({}));
    } catch(e2) {}
  }

  _marcarLeadConvertido_(email, whatsapp);
  try { if (typeof tgNotificarTrial_ === 'function') tgNotificarTrial_(nome, email, whatsapp, dias); } catch(_t) {}

  // ── Meta CAPI (server-side) — Lead + CompleteRegistration ──
  try {
    if (typeof enviarEventoCapi_ === 'function') {
      var capiOpts = {
        email:      email,
        phone:      whatsapp,
        first_name: nome.split(' ')[0],
        event_id:   data.event_id || ('trial_' + orderId),   // dedup c/ o Pixel
        fbp:        data.fbp || '',
        fbc:        data.fbc || '',
        client_ua:  data.client_ua || '',
        url:        data.origem || 'https://wpktavares.com.br/checkout-trial/?dias=' + dias,
        custom:     { content_name: 'Desafio 21 Dias Trial ' + dias + ' dias', currency: 'BRL', value: 0 },
      };
      enviarEventoCapi_('Lead', capiOpts);
      enviarEventoCapi_('CompleteRegistration', capiOpts);
    }
  } catch(e) {
    logAction('system', 'TRIAL_CAPI_ERRO', 'user', email, e.message);
  }

  logAction('system', 'TRIAL_CADASTRO', 'user', email, dias + ' dias — ' + orderId);
  return { ok: true, message: 'Acesso criado! Verifique seu e-mail.' };
}

// Gera senha legível: ex. Foco#482
function _gerarSenhaTrial_() {
  var palavras = ['Verde','Forte','Mente','Foco','Luz','Ouro','Prata','Calma','Meta','Acao'];
  var palavra  = palavras[Math.floor(Math.random() * palavras.length)];
  var num      = Math.floor(100 + Math.random() * 900);
  var chars    = '!@#';
  var char     = chars[Math.floor(Math.random() * chars.length)];
  return palavra + char + num;
}

// ─────────────────────────────────────────────────────────────
// E-MAIL DE BOAS-VINDAS — novo usuário trial
// ─────────────────────────────────────────────────────────────
function _enviarBoasVindasTrial_(email, nome, senha, dias) {
  var firstName = String(nome || '').split(' ')[0] || 'você';
  var appUrl    = 'https://app.wpktavares.com.br';
  var planosUrl = 'https://wpktavares.com.br/planos/';
  var esc = function(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };

  var html =
  '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
  '<body style="margin:0;padding:0;background:#05070a">' +
  '<div style="display:none;max-height:0;overflow:hidden;opacity:0">Seu acesso de ' + dias + ' dias ao Desafio 21 Dias esta pronto — login dentro.</div>' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#05070a;padding:32px 12px;font-family:\'Segoe UI\',Helvetica,Arial,sans-serif">' +
  '<tr><td align="center">' +
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#0c110f;border:1px solid rgba(109,222,113,0.18);border-radius:20px;overflow:hidden;box-shadow:0 20px 60px -20px rgba(0,0,0,0.8)">' +
  '<tr><td style="height:4px;background:linear-gradient(90deg,#1b5e20,#6dde71,#1b5e20);line-height:4px;font-size:0">&nbsp;</td></tr>' +
  '<tr><td style="background:radial-gradient(120% 100% at 50% 0%,#0f2417,#0c110f 70%);padding:40px 40px 30px;text-align:center;border-bottom:1px solid rgba(109,222,113,0.1)">' +
    '<img src="https://wpktavares.com.br/icons/icon-192.png" width="60" height="60" alt="Desafio 21 Dias" style="border-radius:15px;margin-bottom:18px">' +
    '<div style="display:inline-block;background:rgba(109,222,113,0.12);border:1px solid rgba(109,222,113,0.35);color:#6dde71;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;padding:6px 16px;border-radius:100px;margin-bottom:16px">' + dias + ' dias gratis &middot; sem cartao</div>' +
    '<h1 style="margin:0;font-size:28px;line-height:1.2;color:#eef4ec;font-weight:800;letter-spacing:-0.5px">Seu acesso esta pronto,<br><span style="color:#6dde71">' + esc(firstName) + '</span>!</h1>' +
  '</td></tr>' +
  '<tr><td style="padding:34px 40px 8px;color:#c8d6c6">' +
    '<p style="margin:0;font-size:16px;line-height:1.6">Bem-vindo ao <strong style="color:#eef4ec">Desafio 21 Dias</strong>. Seus <strong style="color:#6dde71">' + dias + ' dias de acesso completo</strong> ja estao liberados — use o login abaixo para entrar.</p>' +
  '</td></tr>' +
  '<tr><td style="padding:14px 40px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a1512;border:1px solid rgba(109,222,113,0.28);border-radius:14px"><tr><td style="padding:20px 24px">' +
      '<div style="font-size:10px;color:#6e9070;text-transform:uppercase;letter-spacing:0.15em;margin-bottom:5px">Seu e-mail de acesso</div>' +
      '<div style="font-size:16px;color:#eef4ec;font-weight:600;font-family:Consolas,Menlo,monospace;word-break:break-all;margin-bottom:18px">' + esc(email) + '</div>' +
      '<div style="font-size:10px;color:#6e9070;text-transform:uppercase;letter-spacing:0.15em;margin-bottom:5px">Senha provisoria</div>' +
      '<div style="font-size:22px;color:#7fe886;font-weight:800;font-family:Consolas,Menlo,monospace;letter-spacing:2px">' + esc(senha) + '</div>' +
    '</td></tr></table>' +
  '</td></tr>' +
  '<tr><td style="padding:26px 40px 8px" align="center">' +
    '<a href="' + appUrl + '" style="display:block;background:linear-gradient(135deg,#4caf50,#2e8b3d);color:#05130a;text-decoration:none;font-size:17px;font-weight:800;padding:18px 28px;border-radius:14px;text-align:center;box-shadow:0 10px 30px -8px rgba(76,175,80,0.6)">Acessar o App agora &rarr;</a>' +
    '<div style="font-size:12px;color:#5f7a62;margin-top:10px">ou acesse <span style="color:#8aa08c">app.wpktavares.com.br</span></div>' +
  '</td></tr>' +
  '<tr><td style="padding:26px 40px 6px">' +
    '<div style="font-size:11px;color:#6e9070;text-transform:uppercase;letter-spacing:0.12em;font-weight:700;margin-bottom:16px">Primeiro acesso em 4 passos</div>' +
    _passoTrial_(1, 'Toque em "Acessar o App"', 'Abre a tela de login no celular ou computador.') +
    _passoTrial_(2, 'Entre com o e-mail e a senha acima', 'Digite exatamente como esta — respeitando maiusculas e o simbolo.') +
    _passoTrial_(3, 'Crie sua senha definitiva', 'Em Perfil &rarr; Alterar senha. Assim voce nao esquece.') +
    _passoTrial_(4, 'Complete o Dia 1', 'Meditacao + Leitura + Exercicio. ~45 min e o primeiro dia ja conta!') +
  '</td></tr>' +
  '<tr><td style="padding:16px 40px 4px">' +
    '<p style="font-size:13px;color:#7a927c;line-height:1.6;border-top:1px solid rgba(109,222,113,0.1);padding-top:18px;margin:0">Ao fim dos ' + dias + ' dias voce pode continuar assinando em <a href="' + planosUrl + '" style="color:#6dde71;text-decoration:none">wpktavares.com.br/planos</a>.</p>' +
  '</td></tr>' +
  '<tr><td style="background:#080c0a;border-top:1px solid rgba(109,222,113,0.08);padding:22px 40px;text-align:center">' +
    '<div style="font-size:12px;color:#eef4ec;font-weight:700;margin-bottom:4px">Desafio 21 Dias &middot; WPK Tavares</div>' +
    '<div style="font-size:11px;color:#4a5f4c;line-height:1.7">Duvidas? <a href="mailto:wpktavares@gmail.com" style="color:#6dde71;text-decoration:none">wpktavares@gmail.com</a> &middot; <a href="https://wa.me/559484427988" style="color:#6dde71;text-decoration:none">WhatsApp</a><br>&copy; 2026 WPK Tavares — Todos os direitos reservados</div>' +
  '</td></tr>' +
  '</table></td></tr></table></body></html>';

  var texto = 'Seu trial de ' + dias + ' dias esta ativo.\nE-mail: ' + email + '\nSenha provisoria: ' + senha + '\nAcesse: ' + appUrl;
  return _enviarEmailWpk_(email, firstName + ', seu acesso ao Desafio 21 Dias esta pronto', texto, html);
}

// ─────────────────────────────────────────────────────────────
// ENVIO ROBUSTO — o HTML bonito SEMPRE vai (nunca cai pro texto),
// e usa o remetente WPK Tavares quando o alias estiver disponível.
// ─────────────────────────────────────────────────────────────
function _enviarEmailWpk_(to, subject, textoPlano, html) {
  var nome = 'Desafio 21 Dias - WPK Tavares';
  var diag = { via: '', erro: '' };
  // 0) PREFERENCIAL: Resend do domínio wpktavares.com.br (remetente suporte@wpktavares.com.br)
  try { if (_resendEnviar_(to, subject, html)) { diag.via = 'resend'; return diag; } } catch (e) { diag.erro += 'resend:' + e.message + ' | '; }
  // 1) Fallback GmailApp (dono do script), HTML bonito
  try { GmailApp.sendEmail(to, subject, textoPlano, { htmlBody: html, name: nome }); diag.via = 'gmail-owner'; return diag; } catch (e) { diag.erro += 'owner:' + e.message + ' | '; }
  // 2) Fallback MailApp com HTML (nunca manda simples)
  try { MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, body: textoPlano, name: nome }); diag.via = 'mailapp-html'; return diag; } catch (e) { diag.erro += 'mail:' + e.message; }
  return diag;
}

// Envia via Resend (domínio verificado wpktavares.com.br). Precisa da Script Property RESEND_API_KEY.
// Retorna true se enviou. Se a chave não existir, retorna false (cai no fallback Gmail).
function _resendEnviar_(to, subject, html) {
  var key = '';
  try { key = PropertiesService.getScriptProperties().getProperty('RESEND_API_KEY') || ''; } catch (e) {}
  if (!key) return false;
  var payload = {
    from: 'Desafio 21 Dias <suporte@wpktavares.com.br>',
    to: [to], subject: subject, html: html, reply_to: 'wpktavares@gmail.com'
  };
  var resp = UrlFetchApp.fetch('https://api.resend.com/emails', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  return code >= 200 && code < 300;
}

// Linha de passo do e-mail (table-based p/ compatibilidade)
function _passoTrial_(n, titulo, desc) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px"><tr>' +
    '<td width="34" valign="top" style="padding-right:14px">' +
      '<div style="width:30px;height:30px;background:rgba(109,222,113,0.12);border:1px solid rgba(109,222,113,0.3);border-radius:50%;color:#6dde71;font-size:13px;font-weight:800;text-align:center;line-height:30px">' + n + '</div>' +
    '</td><td valign="top">' +
      '<div style="font-size:14px;color:#eef4ec;font-weight:700;margin-bottom:2px">' + titulo + '</div>' +
      '<div style="font-size:13px;color:#7a927c;line-height:1.5">' + desc + '</div>' +
    '</td></tr></table>';
}

// Reseta a senha de um usuario existente (reativacao de trial)
function _resetSenhaUsuario_(email, hash) {
  try {
    var sh = getSheet(SHEET_USERS);
    var data = sh.getDataRange().getValues();
    var headers = data[0];
    var emailIdx = headers.indexOf('email');
    var hashCol  = headers.indexOf('password_hash') + 1;
    var norm = String(email).toLowerCase().trim();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][emailIdx]).toLowerCase().trim() === norm) {
        sh.getRange(i + 1, hashCol).setValue(hash);
        return true;
      }
    }
  } catch (e) {}
  return false;
}

// Opcoes de envio "como WPK Tavares" — usa o alias se estiver configurado no Gmail do script.
// Enquanto o alias nao existir, envia normal (nao quebra).
function _optsFromWpk_(extra) {
  extra = extra || {};
  if (!extra.name) extra.name = 'Desafio 21 Dias — WPK Tavares';
  try {
    var aliases = GmailApp.getAliases();
    if (aliases && aliases.indexOf('wpktavares@gmail.com') !== -1) extra.from = 'wpktavares@gmail.com';
  } catch (e) {}
  return extra;
}

// ─────────────────────────────────────────────────────────────
// NOTIFICAÇÃO D-1 — roda diariamente às 09:00
// Busca trials que vencem amanhã e dispara e-mail + notif in-app
// Configure: execute setupTrialNotifTrigger() UMA VEZ no editor
// ─────────────────────────────────────────────────────────────
function notificarTrialExpirando_() {
  var sh = getSheet(SHEET_ASSINATURAS);
  if (!sh) return;

  var rows = sh.getDataRange().getValues();
  if (rows.length < 2) return;

  var amanha     = new Date();
  amanha.setDate(amanha.getDate() + 1);
  var amanhaDate = amanha.toISOString().slice(0, 10); // YYYY-MM-DD

  var usersRows = sheetToObjects(getSheet(SHEET_USERS));
  var enviados  = 0;

  for (var i = 1; i < rows.length; i++) {
    var row       = rows[i];
    var email     = String(row[_ASS_.EMAIL]      || '').toLowerCase().trim();
    var appStatus = String(row[_ASS_.APP_STATUS] || '');
    var trialFim  = String(row[_ASS_.TRIAL_END]  || '');
    var trialDias = parseInt(row[_ASS_.TRIAL_DAYS] || 7);

    if (!email || appStatus !== AS.TRIAL) continue;
    if (!trialFim || trialFim.slice(0, 10) !== amanhaDate) continue;
    // v108: não repete o mesmo aviso para a mesma pessoa (o trigger roda
    // todo dia; sem isso, qualquer reprocessamento vira spam diário).
    if (typeof _notifJaEnviada_ === 'function' &&
        _notifJaEnviada_(email, '⏰ Seu trial vence amanhã', 3)) continue;

    // Busca nome do usuário
    var nome = email;
    var uRow = usersRows.find(function(u) {
      return String(u.email || '').toLowerCase().trim() === email;
    });
    if (uRow) nome = uRow.name || email;

    // 1. E-mail D-1
    try {
      _enviarEmailD1Trial_(email, nome, trialDias);
    } catch(e) {
      logAction('system', 'TRIAL_NOTIF_EMAIL_ERRO', 'assinatura', email, e.message);
    }

    // 2. Notificação in-app — PESSOAL (antes ia sem destinatário e o
    //    aviso do trial de um aluno aparecia para todos os outros).
    try {
      _notifCriar_(
        '⏰ Seu trial vence amanhã',
        'Seu acesso gratuito de ' + trialDias + ' dias termina amanhã. Escolha um plano para não perder seu progresso.',
        'alerta',
        email
      );
    } catch(e) {}

    enviados++;
  }

  logAction('system', 'TRIAL_NOTIF_BATCH', 'sistema', '', enviados + ' notificações D-1 enviadas');
  Logger.log('✅ Notificações D-1 enviadas: ' + enviados);
  return enviados;
}

// E-mail HTML D-1
function _enviarEmailD1Trial_(email, nome, dias) {
  var firstName = nome.split(' ')[0];
  var planosUrl = 'https://wpktavares.com.br/planos/';

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    'body{margin:0;padding:0;background:#07090a;font-family:\'Segoe UI\',Arial,sans-serif}' +
    '.wrap{max-width:560px;margin:40px auto;background:#0f1412;border:1px solid rgba(232,64,64,0.22);border-radius:16px;overflow:hidden}' +
    '.hdr{background:linear-gradient(135deg,#1a0a08,#0d0d0a);padding:36px 40px 28px;text-align:center;border-bottom:1px solid rgba(232,64,64,0.15)}' +
    '.logo{width:52px;height:52px;border-radius:12px;margin-bottom:14px}' +
    '.badge{display:inline-block;background:#e84040;color:#fff;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;padding:5px 16px;border-radius:100px;margin-bottom:10px}' +
    '.title{font-family:Georgia,serif;font-size:24px;color:#eeeadc;margin:0;line-height:1.3}' +
    '.bod{padding:36px 40px;color:#dde8dd}' +
    '.plan{background:#141c18;border:1px solid rgba(76,175,80,0.15);border-radius:10px;padding:16px 20px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center}' +
    '.plan.best{border-color:rgba(76,175,80,0.4);background:rgba(76,175,80,0.06)}' +
    '.pn{font-size:14px;color:#eeeadc;font-weight:600}' +
    '.pb{font-size:10px;color:#4caf50;background:rgba(76,175,80,0.12);padding:2px 8px;border-radius:100px;margin-left:6px}' +
    '.pp{font-size:18px;font-weight:700;color:#6dde71}' +
    '.pp small{font-size:12px;color:#6e9070;font-weight:400}' +
    '.btn{display:block;background:#4caf50;color:#fff !important;text-decoration:none;font-size:16px;font-weight:700;padding:18px;border-radius:12px;text-align:center;margin:28px 0}' +
    '.ftr{background:#0a0d0b;border-top:1px solid rgba(76,175,80,0.07);padding:18px 40px;text-align:center;font-size:11px;color:#3a5a3a;line-height:1.8}' +
    '</style></head><body>' +
    '<div class="wrap">' +
      '<div class="hdr">' +
        '<img src="https://i.imgur.com/bOf9i1R.png" class="logo" alt="Logo">' +
        '<div class="badge">⏰ Vence Amanhã</div>' +
        '<p class="title">' + firstName + ', seu trial acaba amanhã</p>' +
      '</div>' +
      '<div class="bod">' +
        '<p style="font-size:16px;margin:0 0 20px">Seu período gratuito de <strong style="color:#6dde71">' + dias + ' dias</strong> termina amanhã. Assine agora para continuar com acesso completo.</p>' +
        '<p style="font-size:13px;color:#6e9070;margin:0 0 14px">Escolha seu plano:</p>' +
        '<div class="plan"><div><div class="pn">Mensal</div><div style="font-size:11px;color:#6e9070">Cobrado mensalmente</div></div><div class="pp">R$17<small>/mês</small></div></div>' +
        '<div class="plan best"><div><div class="pn">Anual<span class="pb">⭐ 14% OFF</span></div><div style="font-size:11px;color:#6e9070">Melhor custo-benefício</div></div><div class="pp">R$177<small>/ano</small></div></div>' +
        '<div class="plan"><div><div class="pn">Trimestral<span class="pb">7% OFF</span></div><div style="font-size:11px;color:#6e9070">A cada 3 meses</div></div><div class="pp">R$47<small>/trim</small></div></div>' +
        '<a href="' + planosUrl + '" class="btn">🔒 Garantir meu acesso agora</a>' +
        '<p style="font-size:12px;color:#3a5a3a;text-align:center">Garantia de 7 dias em todos os planos pagos.</p>' +
      '</div>' +
      '<div class="ftr">© 2026 WPK Tavares · <a href="mailto:wpktavares@gmail.com" style="color:#4caf50">wpktavares@gmail.com</a></div>' +
    '</div></body></html>';

  _enviarEmailWpk_(email,
    '⏰ ' + firstName + ', seu trial no Desafio 21 Dias vence amanhã!',
    'Seu período de ' + dias + ' dias acaba amanhã. Escolha um plano: ' + planosUrl,
    html);
}

// ─────────────────────────────────────────────────────────────
// SETUP — Execute UMA VEZ no editor para ativar o trigger D-1
// ─────────────────────────────────────────────────────────────
function setupTrialNotifTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'notificarTrialExpirando_') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('notificarTrialExpirando_')
    .timeBased().everyDays(1).atHour(9).create();
  Logger.log('✅ Trigger D-1 configurado: notificarTrialExpirando_ todos os dias às 09:00');
  return 'OK';
}
