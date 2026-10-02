// ============================================================
// email_layout.gs — Layout profissional de e-mail (v155)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// POR QUE UM ARQUIVO NOVO
//
// 1) Os "??????" no e-mail de boas-vindas eram os emoji. Acentos
//    passam (o arquivo .gs esta em UTF-8 e "Bem-vindo" chegou
//    certo); o que quebra sao os caracteres FORA do BMP — 🔓 e ✅
//    ocupam 4 bytes e viram interrogacao no caminho ate a caixa.
//    Aqui nao entra nenhum caractere acima de U+FFFF: o simbolo
//    virou desenho feito com HTML, que sempre renderiza.
//
// 2) O template antigo dependia de <style> com classes. O Gmail
//    web aceita, mas o app do Gmail e o Outlook removem a tag
//    inteira — o e-mail chegaria sem estilo nenhum para boa parte
//    da base. Aqui tudo e tabela com estilo inline, que e o que
//    todo cliente entende.
//
// SOBRE ANIMACAO: e-mail nao e pagina. Gmail (app), Outlook e
// Yahoo removem @keyframes. Entao o brilho e feito com gradiente
// — que aparece em todo lugar — e a animacao entra so como
// enfeite opcional para quem suporta. O e-mail nunca depende dela.
// ============================================================

var EM_MARCA      = 'Desafio 21 Dias';
var EM_EMPRESA    = 'WPK Tavares - Equipe Lapidados';
var EM_LOGO       = 'https://i.imgur.com/bOf9i1R.png';
var EM_SITE       = 'https://wpktavares.com.br';
var EM_APP        = 'https://app.wpktavares.com.br';
var EM_SUPORTE    = 'wpktavares@gmail.com';
var EM_WHATS      = 'https://wa.me/559484427988';

// Paleta
var EM_BG      = '#050706';
var EM_CARD    = '#0f1412';
var EM_LINHA   = '#1d2a20';
var EM_TEXTO   = '#dde8dd';
var EM_SUAVE   = '#8aa88c';
var EM_FRACO   = '#5c7360';
var EM_VERDE   = '#4caf50';
var EM_NEON    = '#6dde71';

var EM_FONTE = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

function _emEsc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Remove qualquer caractere fora do BMP que escape para o assunto.
// Um emoji no assunto vira "??????" e ainda pesa contra a entrega.
function emAssuntoLimpo_(s) {
  return String(s || '').replace(/[\uD800-\uDFFF]./g, '').replace(/\s+/g, ' ').trim();
}

// ── Botao que funciona ate no Outlook ────────────────────────
// Outlook desktop ignora padding e border-radius em <a>; sem o VML
// abaixo o CTA chega como um link de texto sem cor.
function _emBotao_(texto, link) {
  var l = _emEsc_(link);
  return '' +
  '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:26px 0 6px">' +
   '<tr><td align="center">' +
    '<!--[if mso]>' +
    '<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" ' +
      'href="' + l + '" style="height:52px;v-text-anchor:middle;width:320px;" arcsize="22%" ' +
      'stroke="f" fillcolor="' + EM_VERDE + '">' +
      '<w:anchorlock/><center style="color:#ffffff;font-family:' + EM_FONTE + ';font-size:16px;font-weight:bold;">' +
      _emEsc_(texto) + '</center></v:roundrect>' +
    '<![endif]-->' +
    '<!--[if !mso]><!-- -->' +
    '<a href="' + l + '" target="_blank" style="display:inline-block;width:100%;max-width:320px;' +
      'background:linear-gradient(135deg,#57c25b 0%,#4caf50 55%,#3c8f40 100%);background-color:' + EM_VERDE + ';' +
      'color:#ffffff;font-family:' + EM_FONTE + ';font-size:16px;font-weight:700;line-height:52px;' +
      'text-align:center;text-decoration:none;border-radius:12px;' +
      'box-shadow:0 6px 26px rgba(76,175,80,.38);letter-spacing:.2px">' +
      _emEsc_(texto) + '</a>' +
    '<!--<![endif]-->' +
   '</td></tr></table>';
}

// ── Selo do topo: substitui o emoji por um desenho em HTML ───
function _emSelo_() {
  return '' +
  '<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 auto 22px">' +
   '<tr><td align="center" width="64" height="64" style="width:64px;height:64px;border-radius:18px;' +
     'background:linear-gradient(135deg,#1e3a22 0%,#122a16 100%);border:1px solid rgba(109,222,113,.34);' +
     'box-shadow:0 0 34px rgba(76,175,80,.22)">' +
     '<img src="' + EM_LOGO + '" width="34" height="34" alt="" ' +
       'style="display:block;margin:0 auto;border:0;border-radius:9px">' +
   '</td></tr></table>';
}

// ── Linha do resumo (periodo, cobranca, valor...) ────────────
function emLinhaResumo_(rotulo, valor, destaque) {
  return '' +
  '<tr>' +
   '<td style="padding:12px 0;border-bottom:1px solid ' + EM_LINHA + ';font-family:' + EM_FONTE + ';' +
     'font-size:14px;color:' + EM_SUAVE + '">' + _emEsc_(rotulo) + '</td>' +
   '<td align="right" style="padding:12px 0;border-bottom:1px solid ' + EM_LINHA + ';font-family:' + EM_FONTE + ';' +
     'font-size:14px;font-weight:700;color:' + (destaque ? EM_NEON : EM_TEXTO) + '">' + _emEsc_(valor) + '</td>' +
  '</tr>';
}

function emCaixaResumo_(titulo, linhasHtml) {
  return '' +
  '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" ' +
    'style="margin:22px 0 4px;background:#0b100d;border:1px solid ' + EM_LINHA + ';border-radius:14px">' +
   '<tr><td style="padding:6px 20px 10px">' +
     (titulo
       ? '<div style="font-family:' + EM_FONTE + ';font-size:11px;font-weight:700;letter-spacing:1.4px;' +
         'text-transform:uppercase;color:' + EM_FRACO + ';padding:14px 0 2px">' + _emEsc_(titulo) + '</div>'
       : '') +
     '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">' +
       linhasHtml +
     '</table>' +
   '</td></tr></table>';
}

// ─────────────────────────────────────────────────────────────
// LAYOUT PRINCIPAL
//
// o = { preheader, titulo, subtitulo, corpoHtml, btnTexto,
//       btnLink, nota, motivo, email }
// ─────────────────────────────────────────────────────────────
function emMontarEmail_(o) {
  o = o || {};
  var linkDesc = EM_SITE + '/descadastrar/?e=' + encodeURIComponent(String(o.email || ''));

  return '' +
'<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">' +
'<html xmlns="http://www.w3.org/1999/xhtml"><head>' +
'<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />' +
'<meta name="viewport" content="width=device-width,initial-scale=1" />' +
'<meta name="x-apple-disable-message-reformatting" />' +
'<meta name="color-scheme" content="dark" /><meta name="supported-color-schemes" content="dark" />' +
'<title>' + _emEsc_(o.titulo || EM_MARCA) + '</title>' +
'<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch>' +
'</o:OfficeDocumentSettings></xml><![endif]-->' +
// Enfeite opcional: onde houver suporte, a barra do topo desliza.
// Onde nao houver, ela continua sendo um gradiente bonito.
'<style>' +
  '@media (prefers-reduced-motion:no-preference){' +
    '@keyframes emBrilho{0%{background-position:0% 50%}100%{background-position:200% 50%}}' +
    '.em-bar{background-size:200% 100%;animation:emBrilho 3.4s linear infinite}' +
  '}' +
  '@media only screen and (max-width:600px){' +
    '.em-pad{padding-left:22px !important;padding-right:22px !important}' +
    '.em-h1{font-size:26px !important;line-height:1.2 !important}' +
  '}' +
'</style>' +
'</head>' +
'<body style="margin:0;padding:0;background:' + EM_BG + ';-webkit-text-size-adjust:100%">' +

// Preheader: o trecho que o Gmail mostra ao lado do assunto na lista.
// Sem ele, o cliente exibe o primeiro texto do HTML, que costuma ser lixo.
'<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0">' +
  _emEsc_(o.preheader || '') +
'</div>' +

'<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" ' +
  'style="background:' + EM_BG + ';padding:34px 14px">' +
 '<tr><td align="center">' +

  '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" ' +
    'style="max-width:560px;background:' + EM_CARD + ';border:1px solid rgba(76,175,80,.17);' +
    'border-radius:20px;overflow:hidden;box-shadow:0 18px 60px rgba(0,0,0,.55)">' +

   // barra superior com o brilho
   '<tr><td class="em-bar" height="4" style="height:4px;line-height:4px;font-size:0;' +
     'background:linear-gradient(90deg,#2e7d32,#6dde71,#7CFF6B,#6dde71,#2e7d32)">&nbsp;</td></tr>' +

   '<tr><td class="em-pad" style="padding:38px 38px 30px" align="center">' +

     _emSelo_() +

     '<div style="font-family:' + EM_FONTE + ';font-size:11px;font-weight:700;letter-spacing:2.6px;' +
       'text-transform:uppercase;color:' + EM_FRACO + ';margin-bottom:12px">' + _emEsc_(EM_MARCA) + '</div>' +

     '<h1 class="em-h1" style="margin:0 0 12px;font-family:' + EM_FONTE + ';font-size:30px;line-height:1.18;' +
       'font-weight:800;color:' + EM_TEXTO + ';letter-spacing:-.4px">' + o.titulo + '</h1>' +

     (o.subtitulo
       ? '<p style="margin:0 0 4px;font-family:' + EM_FONTE + ';font-size:15px;line-height:1.65;color:' + EM_SUAVE + '">' +
         o.subtitulo + '</p>'
       : '') +

     '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">' +
      '<tr><td align="left" style="font-family:' + EM_FONTE + ';font-size:15px;line-height:1.7;color:' + EM_SUAVE + '">' +
        (o.corpoHtml || '') +
      '</td></tr></table>' +

     (o.btnLink ? _emBotao_(o.btnTexto || 'Continuar', o.btnLink) : '') +

     (o.nota
       ? '<p style="margin:18px 0 0;font-family:' + EM_FONTE + ';font-size:12.5px;line-height:1.7;color:' + EM_FRACO + '">' +
         o.nota + '</p>'
       : '') +

   '</td></tr>' +

   // Ajuda
   '<tr><td class="em-pad" style="padding:0 38px 30px" align="center">' +
     '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" ' +
       'style="background:#0b100d;border:1px solid ' + EM_LINHA + ';border-radius:12px">' +
      '<tr><td style="padding:16px 18px;font-family:' + EM_FONTE + ';font-size:13px;line-height:1.65;color:' + EM_SUAVE + '">' +
        'Precisa de ajuda? Responda este e-mail ou fale com a gente no ' +
        '<a href="' + EM_WHATS + '" style="color:' + EM_NEON + ';text-decoration:none;font-weight:600">WhatsApp</a>.' +
      '</td></tr></table>' +
   '</td></tr>' +

   // Rodape
   '<tr><td class="em-pad" style="padding:24px 38px 30px;background:#0a0e0c;border-top:1px solid ' + EM_LINHA + '" align="center">' +
     '<div style="font-family:' + EM_FONTE + ';font-size:13px;font-weight:700;color:' + EM_TEXTO + ';margin-bottom:4px">' +
       _emEsc_(EM_MARCA) + '</div>' +
     '<div style="font-family:' + EM_FONTE + ';font-size:11.5px;color:' + EM_FRACO + ';margin-bottom:14px">' +
       _emEsc_(EM_EMPRESA) + '</div>' +

     '<div style="font-family:' + EM_FONTE + ';font-size:11.5px;color:' + EM_FRACO + ';line-height:2">' +
       '<a href="' + EM_APP + '" style="color:' + EM_SUAVE + ';text-decoration:none">Acessar o app</a>' +
       '<span style="color:' + EM_LINHA + '"> &nbsp;|&nbsp; </span>' +
       '<a href="' + EM_SITE + '/politica-de-privacidade/" style="color:' + EM_SUAVE + ';text-decoration:none">Privacidade</a>' +
       '<span style="color:' + EM_LINHA + '"> &nbsp;|&nbsp; </span>' +
       '<a href="' + EM_SITE + '/termos-de-uso/" style="color:' + EM_SUAVE + ';text-decoration:none">Termos</a>' +
       '<span style="color:' + EM_LINHA + '"> &nbsp;|&nbsp; </span>' +
       '<a href="mailto:' + EM_SUPORTE + '" style="color:' + EM_SUAVE + ';text-decoration:none">Suporte</a>' +
     '</div>' +

     '<div style="font-family:' + EM_FONTE + ';font-size:11px;color:#3f5343;line-height:1.75;margin-top:16px">' +
       (o.motivo || 'Você recebeu este e-mail porque tem uma conta no Desafio 21 Dias.') +
       '<br />' +
       '<a href="' + linkDesc + '" style="color:#4d6551;text-decoration:underline">' +
         'Gerenciar preferências ou cancelar e-mails</a>' +
     '</div>' +

     '<div style="font-family:' + EM_FONTE + ';font-size:10.5px;color:#33443680;margin-top:12px">' +
       '&copy; ' + (new Date()).getFullYear() + ' ' + _emEsc_(EM_EMPRESA) + '</div>' +

   '</td></tr>' +
  '</table>' +

 '</td></tr></table>' +
'</body></html>';
}

// ─────────────────────────────────────────────────────────────
// PREFERENCIAS DE E-MAIL (link do rodape)
// ------------------------------------------------------------
// Um detalhe que nao da para ignorar: e-mail de acesso e de
// seguranca NAO entram no descadastro. Se a pessoa cancelasse o
// "crie sua senha", ficaria pagando sem conseguir entrar. O
// opt-out vale para lembrete e novidade — que e o que a lei
// anti-spam trata como comunicacao comercial.
// ─────────────────────────────────────────────────────────────
var EM_ABA_OPTOUT = 'email_optout';

function _emAbaOptout_() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(EM_ABA_OPTOUT);
  if (!sh) {
    sh = ss.insertSheet(EM_ABA_OPTOUT);
    sh.appendRow(['email', 'marketing', 'atualizado_em', 'origem']);
    sh.getRange(1, 1, 1, 4).setFontWeight('bold')
      .setBackground('#1a237e').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function emAceitaMarketing_(email) {
  email = String(email || '').toLowerCase().trim();
  if (!email) return false;
  try {
    var sh = _emAbaOptout_();
    if (sh.getLastRow() < 2) return true;
    var d = sh.getDataRange().getValues();
    for (var i = d.length - 1; i >= 1; i--) {
      if (String(d[i][0] || '').toLowerCase().trim() === email) {
        return String(d[i][1]) !== 'nao';
      }
    }
  } catch (e) {}
  return true;   // sem registro = nunca pediu para sair
}

function preferenciasEmail(data) {
  var d = data || {};
  var email = String(d.email || '').toLowerCase().trim();
  var acao  = String(d.acao || 'consultar');

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { ok: false, error: 'E-mail invalido.' };
  }

  try {
    if (acao === 'consultar') {
      return { ok: true, email: email, marketing: emAceitaMarketing_(email) };
    }

    var querMarketing = (acao === 'reativar');
    var sh = _emAbaOptout_();
    var d2 = sh.getDataRange().getValues();
    var agora = new Date().toISOString();
    var achou = false;

    for (var i = 1; i < d2.length && !achou; i++) {
      if (String(d2[i][0] || '').toLowerCase().trim() === email) {
        sh.getRange(i + 1, 2).setValue(querMarketing ? 'sim' : 'nao');
        sh.getRange(i + 1, 3).setValue(agora);
        achou = true;
      }
    }
    if (!achou) sh.appendRow([email, querMarketing ? 'sim' : 'nao', agora, 'rodape_email']);

    logAction(email, querMarketing ? 'EMAIL_OPTIN' : 'EMAIL_OPTOUT', 'email', email, '');
    return { ok: true, email: email, marketing: querMarketing };

  } catch (e) {
    return { ok: false, error: e.message };
  }
}
