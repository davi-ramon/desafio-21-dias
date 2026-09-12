// ============================================================
// onboarding.gs — Fluxo de primeiro acesso pós-compra (v106)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// Substitui a "senha provisória por e-mail" por um LINK MÁGICO
// de uso único onde o próprio comprador cria a senha.
//
// Fluxo:
//   Stripe aprova
//     → /obrigado/?session_id=...  (confirma a compra, mostra passos)
//     → e-mail "Criar minha senha" (link de uso único, 48h)
//     → /definir-senha/?t=<token>  (cria a senha)
//     → login automático → app
//
// Reusa a aba `password_reset` (id, email, code, expires_at,
// used, created_at). O token longo vive na coluna `code` — não
// colide com os códigos de 6 dígitos do reset comum.
// ============================================================

var ONB_TOKEN_HORAS = 48;
// Fica no MESMO host do app de propósito: sessionStorage é por origem, e a
// página faz login automático logo após criar a senha. Servida direto pelo
// Firebase (não há rewrite catch-all), então o redirect de host do index.html
// da raiz não interfere neste caminho.
var ONB_URL_SENHA   = 'https://app.wpktavares.com.br/definir-senha/';
var ONB_URL_APP     = 'https://app.wpktavares.com.br';

// ─────────────────────────────────────────────────────────────
// Geração do token de uso único
// ─────────────────────────────────────────────────────────────
function _gerarTokenAcesso_(email, horas) {
  email = String(email || '').toLowerCase().trim();
  if (!email) return '';

  try { initPasswordResetSheet_(); } catch (e) {}
  var sh = getSpreadsheet_().getSheetByName(SHEET_RESET_CODES);
  if (!sh) throw new Error('Aba password_reset ausente.');

  // 40 chars — inadivinhável e sem colisão com códigos de 6 dígitos
  var token = Utilities.getUuid().replace(/-/g, '') +
              Utilities.getUuid().replace(/-/g, '').slice(0, 8);

  var agora   = new Date();
  var expira  = new Date(agora.getTime() + (parseInt(horas || ONB_TOKEN_HORAS)) * 3600 * 1000);
  sh.appendRow([generateId(), email, token, expira.toISOString(), false, agora.toISOString()]);

  return token;
}

function _linkDefinirSenha_(email, horas) {
  var t = _gerarTokenAcesso_(email, horas);
  return t ? (ONB_URL_SENHA + '?t=' + encodeURIComponent(t)) : ONB_URL_APP;
}

// Localiza a linha do token válido. Retorna { rowIndex, email } ou null.
function _acharTokenAcesso_(token) {
  token = String(token || '').trim();
  if (!token || token.length < 20) return null;

  var sh = getSpreadsheet_().getSheetByName(SHEET_RESET_CODES);
  if (!sh || sh.getLastRow() < 2) return null;

  var dados   = sh.getDataRange().getValues();
  var headers = dados[0].map(function (h) { return String(h); });
  var iEmail  = headers.indexOf('email');
  var iCode   = headers.indexOf('code');
  var iExp    = headers.indexOf('expires_at');
  var iUsed   = headers.indexOf('used');
  if (iCode < 0) return null;

  var agora = new Date();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][iCode]) !== token) continue;
    if (dados[i][iUsed] === true) return null;                 // já usado
    if (!(new Date(dados[i][iExp]) > agora)) return null;      // expirado
    return { rowIndex: i + 1, email: String(dados[i][iEmail] || ''), usedCol: iUsed + 1 };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// ROTA PÚBLICA: validarTokenAcesso — a página /definir-senha/
// chama isso ao abrir, pra saudar a pessoa e validar o link.
// Não expõe nada sensível: só primeiro nome e e-mail mascarado.
// ─────────────────────────────────────────────────────────────
function validarTokenAcesso(token) {
  var achado = _acharTokenAcesso_(token);
  if (!achado) return { ok: false, error: 'Este link expirou ou já foi usado.' };

  var nome = '';
  try {
    var users = sheetToObjects(getSheet(SHEET_USERS));
    var u = users.find(function (x) {
      return String(x.email || '').toLowerCase().trim() === achado.email;
    });
    if (u) nome = String(u.name || '');
  } catch (e) {}

  return {
    ok: true,
    nome: nome.split(' ')[0] || '',
    email: (typeof _maskEmail_ === 'function') ? _maskEmail_(achado.email) : ''
  };
}

// ─────────────────────────────────────────────────────────────
// ROTA PÚBLICA: definirSenhaComToken — grava a senha escolhida.
// Devolve o e-mail em claro para o front fazer o login logo em
// seguida (ele já tem a senha em memória).
// ─────────────────────────────────────────────────────────────
function definirSenhaComToken(token, novaSenha) {
  novaSenha = String(novaSenha || '');
  if (novaSenha.length < 6) return { ok: false, error: 'A senha precisa ter ao menos 6 caracteres.' };

  var achado = _acharTokenAcesso_(token);
  if (!achado) return { ok: false, error: 'Este link expirou ou já foi usado.' };

  var sheet   = getSheet(SHEET_USERS);
  var dados   = sheet.getDataRange().getValues();
  var headers = dados[0].map(function (h) { return String(h); });
  var iEmail  = headers.indexOf('email');
  var iHash   = headers.indexOf('password_hash');
  var iAtivo  = headers.indexOf('active');
  if (iEmail < 0 || iHash < 0) return { ok: false, error: 'Estrutura de usuários inválida.' };

  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][iEmail] || '').toLowerCase().trim() !== achado.email) continue;

    sheet.getRange(i + 1, iHash + 1).setValue(hashPassword(novaSenha));
    if (iAtivo >= 0 && dados[i][iAtivo] !== true) sheet.getRange(i + 1, iAtivo + 1).setValue(true);

    // Queima o token (uso único)
    var rs = getSpreadsheet_().getSheetByName(SHEET_RESET_CODES);
    if (rs) rs.getRange(achado.rowIndex, achado.usedCol).setValue(true);

    logAction(achado.email, 'SENHA_DEFINIDA_TOKEN', 'user', achado.email, '');
    return { ok: true, email: achado.email };
  }

  return { ok: false, error: 'Usuário não encontrado.' };
}

// ─────────────────────────────────────────────────────────────
// E-MAIL 1 — comprador NOVO: "crie sua senha"
// ─────────────────────────────────────────────────────────────
function _enviarBoasVindasComLink_(email, nome, wsNome, trial) {
  wsNome = wsNome || 'WPK Tavares';
  var link  = _linkDefinirSenha_(email, ONB_TOKEN_HORAS);
  var prim  = _onbPrimeiroNome_(nome);
  var ehTrial = !!(trial && trial.dias);

  // Sem emoji: fora do BMP, viravam "??????" no assunto e no corpo.
  var subject = ehTrial
    ? 'Seu teste de ' + trial.dias + ' dias começou — crie sua senha de acesso'
    : 'Bem-vindo ao Desafio 21 Dias — crie sua senha de acesso';
  subject = emAssuntoLimpo_(subject);

  var texto = (ehTrial
      ? 'Seu teste de ' + trial.dias + ' dias do Desafio 21 Dias começou. Nenhuma cobrança foi feita hoje.'
      : 'Sua assinatura do Desafio 21 Dias está confirmada.') +
    '\n\nCrie sua senha de acesso: ' + link +
    '\n\nO link vale por ' + ONB_TOKEN_HORAS + ' horas.';

  var corpo = ehTrial
    ? 'Seu cartão foi cadastrado com segurança e <strong>nenhuma cobrança foi feita hoje</strong>. ' +
      'Falta só um passo para começar: criar sua senha de acesso.'
    : 'Sua assinatura do <strong>Desafio 21 Dias</strong> está confirmada. ' +
      'Falta só um passo: criar sua senha de acesso.';

  // Resumo do teste dentro do proprio e-mail: a pessoa nao precisa
  // voltar na pagina para lembrar quando e quanto vai pagar.
  if (ehTrial) {
    corpo += emCaixaResumo_('Seu teste',
      emLinhaResumo_('Período gratuito', trial.dias + ' dias') +
      emLinhaResumo_('Cobrado hoje', 'R$ 0,00', true) +
      (trial.primeiraCobranca ? emLinhaResumo_('Primeira cobrança', trial.primeiraCobranca) : '') +
      emLinhaResumo_('Valor a partir de então', 'R$ ' + Number(trial.valor || 17).toFixed(2).replace('.', ',') + '/mês') +
      emLinhaResumo_('Cancelamento', 'Pelo app, quando quiser'));
  }

  var html = emMontarEmail_({
    preheader: ehTrial
      ? 'Nada foi cobrado hoje. Crie sua senha e comece agora.'
      : 'Falta um passo: criar sua senha de acesso.',
    titulo:    'Tudo certo, ' + prim + '!',
    subtitulo: ehTrial ? 'Seu teste de ' + trial.dias + ' dias já está valendo.' : '',
    corpoHtml: corpo,
    btnTexto:  'Criar minha senha',
    btnLink:   link,
    nota:      'O link é pessoal e vale por ' + ONB_TOKEN_HORAS + ' horas. ' +
               'Se não foi você quem se cadastrou, ignore este e-mail com segurança.',
    motivo:    'Você recebeu este e-mail porque acabou de criar uma conta no Desafio 21 Dias.',
    email:     email
  });

  _onbEnviar_(email, subject, texto, html);
}

// ─────────────────────────────────────────────────────────────
// E-MAIL 2 — quem JÁ tinha conta e assinou: confirmação.
// Não mexe na senha; só confirma e manda pro app.
// ─────────────────────────────────────────────────────────────
function _enviarConfirmacaoAssinatura_(email, nome, plano, wsNome) {
  wsNome = wsNome || 'WPK Tavares';
  var nomePlano = _onbNomePlano_(plano);
  var subject   = emAssuntoLimpo_('Sua assinatura do Desafio 21 Dias está ativa');
  var texto     = 'Sua assinatura do Desafio 21 Dias (' + nomePlano + ') esta ativa.\n' +
                  'Acesse: ' + ONB_URL_APP;
  var html      = _buildOnbEmailHtml_({
    icone:    '✅',
    titulo:   'Assinatura confirmada, ' + _onbPrimeiroNome_(nome) + '!',
    corpo:    'Seu plano <strong>' + nomePlano + '</strong> está ativo. ' +
              'Entre com o e-mail e a senha que você já usa.',
    btnTexto: 'Entrar no app →',
    btnLink:  ONB_URL_APP,
    nota:     'Esqueceu a senha? Use "Esqueci minha senha" na tela de login.',
    wsNome:   wsNome
  });
  _onbEnviar_(email, subject, texto, html);
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function _onbEnviar_(email, subject, texto, html) {
  if (typeof _enviarEmailWpk_ === 'function') {
    _enviarEmailWpk_(email, subject, texto, html);
  } else {
    MailApp.sendEmail({ to: email, subject: subject, htmlBody: html });
  }
}

function _onbPrimeiroNome_(nome) {
  var n = String(nome || '').trim().split(' ')[0];
  return _onbEsc_(n || 'tudo bem');
}

function _onbNomePlano_(plano) {
  switch (String(plano || '')) {
    case 'monthly':   return 'Mensal';
    case 'quarterly': return 'Trimestral';
    case 'yearly':    return 'Anual';
    default:          return 'Premium';
  }
}

function _onbEsc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Template dark — mesma identidade do _buildAcessoEmailHtml_ (reabertura.gs)
function _buildOnbEmailHtml_(o) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    'body{background:#07090a;margin:0;padding:40px 16px;font-family:\'DM Sans\',Segoe UI,sans-serif}' +
    '.wrap{max-width:520px;margin:0 auto;background:#0f1412;border:1px solid rgba(76,175,80,0.18);border-radius:20px;overflow:hidden}' +
    '.bar{height:3px;background:linear-gradient(90deg,#4caf50,#6dde71,#4caf50)}' +
    '.body{padding:36px 32px}' +
    '.icon{width:52px;height:52px;background:linear-gradient(135deg,#4caf50,#2e6b31);border-radius:14px;' +
      'display:inline-flex;align-items:center;justify-content:center;font-size:26px;margin-bottom:20px}' +
    'h2{color:#dde8dd;font-size:22px;font-weight:800;margin:0 0 8px}' +
    'p{color:#6e9070;font-size:14px;line-height:1.65;margin:0 0 16px}' +
    'strong{color:#dde8dd}' +
    '.btn{display:block;background:#4caf50;color:#fff !important;font-size:15px;font-weight:700;' +
      'text-decoration:none;text-align:center;padding:16px 24px;border-radius:11px;margin-top:22px;' +
      'box-shadow:0 4px 24px rgba(76,175,80,.28)}' +
    '.note{font-size:12px;color:#3e5a3e;margin-top:16px;line-height:1.7}' +
    '.foot{padding:18px 32px;border-top:1px solid rgba(76,175,80,.08);text-align:center;font-size:11px;color:#3e5a3e}' +
    '</style></head><body>' +
    '<div class="wrap"><div class="bar"></div><div class="body">' +
    '<div class="icon">' + o.icone + '</div>' +
    '<h2>' + o.titulo + '</h2>' +
    '<p>' + o.corpo + '</p>' +
    '<a href="' + _onbEsc_(o.btnLink) + '" class="btn">' + o.btnTexto + '</a>' +
    '<p class="note">' + o.nota + '</p>' +
    '</div>' +
    '<div class="foot">' + _onbEsc_(o.wsNome) + ' · Desafio 21 Dias</div>' +
    '</div></body></html>';
}

// ─────────────────────────────────────────────────────────────
// ROTA PÚBLICA: reenviarLinkAcesso — botão "não recebi o e-mail"
// da página /obrigado/. Anti-enumeração: sempre responde ok.
// ─────────────────────────────────────────────────────────────
function reenviarLinkAcesso(email) {
  email = String(email || '').toLowerCase().trim();
  if (!email) return { ok: true };

  try {
    var users = sheetToObjects(getSheet(SHEET_USERS));
    var u = users.find(function (x) {
      return String(x.email || '').toLowerCase().trim() === email;
    });
    if (u) {
      var wsNome = 'WPK Tavares';
      try { wsNome = getWorkspaceConfig().nome || wsNome; } catch (e) {}

      // v155: quem esta em teste precisa receber o e-mail DE TESTE.
      // Mandar "assinatura confirmada" para quem nao pagou nada gera
      // duvida de cobranca justo em quem ja esta inseguro.
      var trial = null;
      try {
        var lin = _getAssinaturaRow_(email);
        if (lin && String(lin[_ASS_.APP_STATUS] || '') === AS.TRIAL) {
          var fim = lin[_ASS_.TRIAL_END];
          trial = {
            dias: Number(lin[_ASS_.TRIAL_DAYS]) || 0,
            primeiraCobranca: fim
              ? Utilities.formatDate(new Date(fim), 'America/Sao_Paulo', 'dd/MM/yyyy') : '',
            valor: Number(lin[_ASS_.AMOUNT]) || 17
          };
          if (!trial.dias) trial = null;
        }
      } catch (e) {}

      _enviarBoasVindasComLink_(email, u.name || '', wsNome, trial);
      logAction(email, 'REENVIO_LINK_ACESSO', 'user', email, trial ? 'trial' : 'assinatura');
    }
  } catch (e) {
    logAction('system', 'REENVIO_LINK_ERRO', 'user', email, e.message);
  }
  return { ok: true };
}
