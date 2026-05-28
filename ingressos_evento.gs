// ============================================================
// ingressos_evento.gs — Sistema de Ingressos Digitais
// Seminário Empresarial Fábio Luiz
// Fluxo: Cakto webhook → planilha ingressos_evento
//        → UUID + QR Code → email HTML com ingresso
//        → validação de check-in via /checkin/?id=UUID
// ============================================================

var _EVENTO_ = {
  SHEET:       'ingressos_evento',
  PRODUTO_KEY: 'fabio luiz',            // substring normalizada p/ detectar produto

  // E-mail remetente (deve ser uma conta autorizada no GAS)
  FROM_EMAIL:  'wpktavares@gmail.com',
  FROM_NAME:   'WPK Tavares — Eventos',

  // URL base do check-in (Firebase Hosting)
  CHECKIN_URL: 'https://wpktavares.com.br/checkin/',

  // Dados do evento (aparece no ingresso)
  TITULO:      'Seminário Empresarial',
  SUBTITULO:   'Fábio Luiz',
  DATA_EXT:    '26 de Julho de 2026',
  DIASEM:      'Domingo',
  HORA:        '09:00',
  LOCAL_NOME:  'Hotel Ibis',
  LOCAL_CIDADE:'Bacabal / MA',
  LOGO:        'https://i.imgur.com/bOf9i1R.png',
};

// Índices das colunas (base-0) na aba ingressos_evento
var _IC_ = {
  UUID:    0,   // A — UUID completo (também a chave de check-in)
  CODIGO:  1,   // B — código de exibição (8 chars)
  ORDER:   2,   // C — order_id Cakto
  NOME:    3,   // D
  EMAIL:   4,   // E
  CPF:     5,   // F
  TEL:     6,   // G
  PRODUTO: 7,   // H
  VALOR:   8,   // I
  PAGTO:   9,   // J — método de pagamento
  COMPROU: 10,  // K — data/hora da compra (ISO)
  CHECKIN: 11,  // L — data/hora do check-in (ISO) — vazio = não usou
  STATUS:  12,  // M — 'valido' | 'presente' | 'cancelado'
  ENVIADO: 13,  // N — 'true' quando e-mail enviado
};

// ─────────────────────────────────────────────────────────────
// DETECÇÃO DE PRODUTO — normaliza acentos antes de comparar
// ─────────────────────────────────────────────────────────────
function isEventoFabioLuiz_(nomeProduto) {
  var n = String(nomeProduto || '').toLowerCase()
    .replace(/[áàâã]/g, 'a').replace(/[éèê]/g, 'e')
    .replace(/[íìî]/g, 'i').replace(/[óòôõ]/g, 'o')
    .replace(/[úùû]/g, 'u').replace(/[ç]/g, 'c');
  return n.indexOf(_EVENTO_.PRODUTO_KEY) !== -1;
}

// ─────────────────────────────────────────────────────────────
// FLATTEN — converte payload Cakto v2 (array/nested) em objeto plano
// Usado tanto aqui quanto para passar ao processWebhookCakto_ legado
// ─────────────────────────────────────────────────────────────
function flattenCaktoV2_(d) {
  var c = d.customer || {};
  return {
    transaction_id:   d.id,
    order_id:         d.id,
    id:               d.id,
    customer_name:    c.name  || '',
    customer_email:   c.email || '',
    customer_phone:   c.phone || '',
    name:             c.name  || '',
    email:            c.email || '',
    phone:            c.phone || '',
    cpf:              c.docNumber || '',
    product_name:     (d.product && d.product.name) || '',
    product:          (d.product && d.product.name) || '',
    status:           d.status || '',
    payment_status:   d.status || '',
    amount:           d.amount || 0,
    paidAt:           d.paidAt || '',
    paymentMethod:    d.paymentMethod || '',
    paymentMethodName: d.paymentMethodName || '',
  };
}

// ─────────────────────────────────────────────────────────────
// WEBHOOK HANDLER — chamado de doPost em code.gs
// Recebe o elemento bruto do array Cakto v2: { event, secret, data:{...} }
// ─────────────────────────────────────────────────────────────
function processWebhookCaktoEvento_(caktoEvt) {
  try {
    var d = caktoEvt.data || caktoEvt;   // suporte a ambos os formatos

    var status = String(d.status || '').toLowerCase();
    if (status !== 'paid' && status !== 'approved') {
      logAction('system', 'EVENTO_CAKTO_IGNORED', 'webhook', '', 'status=' + status);
      return _okEvento_('ignored', 'Status ignorado: ' + status);
    }

    var c       = d.customer || {};
    var orderId = String(d.id || '');
    var nome    = String(c.name  || '');
    var email   = String(c.email || '');
    var cpf     = String(c.docNumber || '');
    var tel     = String(c.phone || '');
    var produto = String((d.product && d.product.name) || 'Ingresso Seminário');
    var valor   = String(d.amount  || '');
    var pagto   = String(d.paymentMethodName || d.paymentMethod || '');
    var paidAt  = String(d.paidAt || new Date().toISOString());

    if (!email) {
      logAction('system', 'EVENTO_SEM_EMAIL', 'webhook', orderId, nome);
      return _okEvento_('error', 'Sem e-mail — pulando');
    }

    if (ingressoExiste_(orderId)) {
      logAction('system', 'EVENTO_DUPLICADO', 'webhook', orderId, email);
      return _okEvento_('duplicate', 'Pedido já registrado: ' + orderId);
    }

    // Gera UUID e código de exibição
    var uuid    = _gerarUUID_();
    var codigo  = _codigoExibicao_(uuid);

    // Monta objeto do ingresso
    var ingresso = {
      uuid:    uuid,
      codigo:  codigo,
      orderId: orderId,
      nome:    nome,
      email:   email,
      cpf:     _formatCPF_(cpf),
      tel:     tel,
      produto: produto,
      valor:   valor ? 'R$ ' + parseFloat(valor).toFixed(2).replace('.', ',') : '',
      pagto:   pagto,
      comprou: paidAt,
    };

    // Salva na planilha
    salvarIngresso_(ingresso);

    // Envia e-mail com o ingresso HTML
    try {
      enviarEmailIngresso_(ingresso);
      // Marca envio como concluído
      _marcarEmailEnviado_(orderId);
    } catch(emailErr) {
      logAction('system', 'EVENTO_EMAIL_ERRO', 'ingresso', orderId, emailErr.message);
    }

    logAction('system', 'EVENTO_INGRESSO_CRIADO', 'ingresso', uuid, nome + ' | ' + email);
    return _okEvento_('ok', 'Ingresso criado: ' + codigo);

  } catch(err) {
    logAction('system', 'EVENTO_ERRO', 'webhook', '', err.message);
    return _okEvento_('error', err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// VERIFICAR CHECK-IN — chamado via GET/POST público
// Valida UUID, marca como presente se primeira vez
// ─────────────────────────────────────────────────────────────
function verificarIngressoUUID_(uuid) {
  if (!uuid) return { ok: false, error: 'UUID não informado.' };

  var ss   = getSpreadsheet_();
  var aba  = ss.getSheetByName(_EVENTO_.SHEET);
  if (!aba) return { ok: false, error: 'Sistema de ingressos não inicializado.' };

  var dados   = aba.getDataRange().getValues();
  var uuidNorm = String(uuid).toUpperCase().trim();

  for (var i = 1; i < dados.length; i++) {
    var rowUuid = String(dados[i][_IC_.UUID] || '').toUpperCase().trim();
    if (rowUuid !== uuidNorm) continue;

    var status   = String(dados[i][_IC_.STATUS] || 'valido').toLowerCase();
    var checkinAt = String(dados[i][_IC_.CHECKIN] || '');

    // Ingresso cancelado
    if (status === 'cancelado') {
      return {
        ok:     false,
        valido: false,
        tipo:   'cancelado',
        nome:   String(dados[i][_IC_.NOME]),
        email:  String(dados[i][_IC_.EMAIL]),
        codigo: String(dados[i][_IC_.CODIGO]),
      };
    }

    // Já utilizado
    if (status === 'presente' || checkinAt) {
      return {
        ok:        true,
        valido:    false,
        tipo:      'ja_utilizado',
        checkinAt: checkinAt,
        nome:      String(dados[i][_IC_.NOME]),
        email:     String(dados[i][_IC_.EMAIL]),
        cpf:       String(dados[i][_IC_.CPF]),
        produto:   String(dados[i][_IC_.PRODUTO]),
        codigo:    String(dados[i][_IC_.CODIGO]),
      };
    }

    // Válido — marcar check-in
    var agora = new Date().toISOString();
    aba.getRange(i + 1, _IC_.CHECKIN + 1).setValue(agora);
    aba.getRange(i + 1, _IC_.STATUS  + 1).setValue('presente');

    logAction('system', 'EVENTO_CHECKIN', 'ingresso',
      String(dados[i][_IC_.UUID]),
      String(dados[i][_IC_.NOME]) + ' | ' + String(dados[i][_IC_.EMAIL]));

    return {
      ok:        true,
      valido:    true,
      tipo:      'valido',
      checkinAt: agora,
      nome:      String(dados[i][_IC_.NOME]),
      email:     String(dados[i][_IC_.EMAIL]),
      cpf:       String(dados[i][_IC_.CPF]),
      produto:   String(dados[i][_IC_.PRODUTO]),
      valor:     String(dados[i][_IC_.VALOR]),
      codigo:    String(dados[i][_IC_.CODIGO]),
    };
  }

  return { ok: false, valido: false, tipo: 'nao_encontrado', error: 'Ingresso não encontrado.' };
}

// ─────────────────────────────────────────────────────────────
// SALVAR INGRESSO NA PLANILHA
// ─────────────────────────────────────────────────────────────
function salvarIngresso_(g) {
  var ss  = getSpreadsheet_();
  var aba = ss.getSheetByName(_EVENTO_.SHEET);

  if (!aba) {
    aba = ss.insertSheet(_EVENTO_.SHEET);
    var cab = [
      'UUID','Codigo','OrderId','Nome','Email','CPF','Telefone',
      'Produto','Valor','Pagamento','CompradoEm',
      'CheckinEm','Status','EmailEnviado'
    ];
    aba.appendRow(cab);
    aba.getRange(1, 1, 1, cab.length)
       .setFontWeight('bold')
       .setBackground('#1a237e')
       .setFontColor('#ffffff');
    aba.setFrozenRows(1);
  }

  aba.appendRow([
    g.uuid,
    g.codigo,
    g.orderId,
    g.nome,
    g.email,
    g.cpf,
    g.tel,
    g.produto,
    g.valor,
    g.pagto,
    g.comprou,
    '',           // CheckinEm — vazio
    'valido',     // Status inicial
    'false',      // EmailEnviado — atualizado depois
  ]);
}

// ─────────────────────────────────────────────────────────────
// VERIFICA DUPLICATA
// ─────────────────────────────────────────────────────────────
function ingressoExiste_(orderId) {
  var ss  = getSpreadsheet_();
  var aba = ss.getSheetByName(_EVENTO_.SHEET);
  if (!aba) return false;
  var dados = aba.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][_IC_.ORDER]) === String(orderId)) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
// MARCA EMAIL ENVIADO
// ─────────────────────────────────────────────────────────────
function _marcarEmailEnviado_(orderId) {
  var ss   = getSpreadsheet_();
  var aba  = ss.getSheetByName(_EVENTO_.SHEET);
  if (!aba) return;
  var dados = aba.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][_IC_.ORDER]) === String(orderId)) {
      aba.getRange(i + 1, _IC_.ENVIADO + 1).setValue('true');
      return;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// ENVIO DO E-MAIL COM INGRESSO HTML
// ─────────────────────────────────────────────────────────────
function enviarEmailIngresso_(g) {
  var html    = _buildIngressoHTML_(g);
  var assunto = '🎟️ Seu ingresso — ' + _EVENTO_.TITULO + ' ' + _EVENTO_.SUBTITULO;

  GmailApp.sendEmail(g.email, assunto, '', {
    from:     _EVENTO_.FROM_EMAIL,
    name:     _EVENTO_.FROM_NAME,
    htmlBody: html,
    replyTo:  _EVENTO_.FROM_EMAIL,
  });
}

// ─────────────────────────────────────────────────────────────
// TEMPLATE HTML DO INGRESSO (inline CSS, compatível com Gmail/Outlook)
// ─────────────────────────────────────────────────────────────
function _buildIngressoHTML_(g) {
  var checkinUrl = _EVENTO_.CHECKIN_URL + '?id=' + encodeURIComponent(g.uuid);
  var qrUrl      = 'https://chart.googleapis.com/chart?cht=qr&chs=220x220&chld=H|1&chl='
                   + encodeURIComponent(checkinUrl);

  return [
'<!DOCTYPE html>',
'<html lang="pt-BR">',
'<head>',
'<meta charset="UTF-8">',
'<meta name="viewport" content="width=device-width,initial-scale=1">',
'<title>Seu Ingresso — ' + _EVENTO_.TITULO + ' ' + _EVENTO_.SUBTITULO + '</title>',
'</head>',
'<body style="margin:0;padding:0;background:#f0f0f0;font-family:Arial,Helvetica,sans-serif;">',

'<!-- Wrapper -->',
'<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f0f0;padding:32px 0;">',
'<tr><td align="center">',

'<!-- Container -->',
'<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">',

'<!-- HEADER LOGO -->',
'<tr><td style="background:#0d1b4b;padding:28px 32px;text-align:center;border-radius:12px 12px 0 0;">',
'<img src="' + _EVENTO_.LOGO + '" alt="WPK Tavares" height="52" style="max-height:52px;display:block;margin:0 auto 12px;">',
'<p style="margin:0;color:#c8d4ff;font-size:13px;letter-spacing:1px;text-transform:uppercase;">Ingresso Digital Oficial</p>',
'</td></tr>',

'<!-- TITULO EVENTO -->',
'<tr><td style="background:#1a237e;padding:28px 32px;text-align:center;">',
'<h1 style="margin:0 0 4px;color:#ffffff;font-size:28px;font-weight:900;letter-spacing:-0.5px;">' + _EVENTO_.TITULO + '</h1>',
'<h2 style="margin:0;color:#90caf9;font-size:22px;font-weight:700;">' + _EVENTO_.SUBTITULO + '</h2>',
'</td></tr>',

'<!-- FAIXA DATA/LOCAL -->',
'<tr><td style="background:#283593;padding:16px 32px;">',
'<table width="100%" cellpadding="0" cellspacing="0" border="0">',
'<tr>',
'<td style="text-align:center;color:#e8eaf6;font-size:14px;border-right:1px solid #3949ab;padding:0 16px;">',
'<span style="display:block;font-size:24px;">📅</span>',
'<strong style="font-size:15px;color:#fff;">' + _EVENTO_.DIASEM + '</strong><br>',
_EVENTO_.DATA_EXT,
'</td>',
'<td style="text-align:center;color:#e8eaf6;font-size:14px;border-right:1px solid #3949ab;padding:0 16px;">',
'<span style="display:block;font-size:24px;">🕘</span>',
'<strong style="font-size:15px;color:#fff;">' + _EVENTO_.HORA + 'h</strong><br>',
'Abertura dos portões',
'</td>',
'<td style="text-align:center;color:#e8eaf6;font-size:14px;padding:0 16px;">',
'<span style="display:block;font-size:24px;">📍</span>',
'<strong style="font-size:15px;color:#fff;">' + _EVENTO_.LOCAL_NOME + '</strong><br>',
_EVENTO_.LOCAL_CIDADE,
'</td>',
'</tr>',
'</table>',
'</td></tr>',

'<!-- BODY BRANCO -->',
'<tr><td style="background:#ffffff;padding:32px;">',

'<!-- Saudação -->',
'<p style="margin:0 0 20px;font-size:16px;color:#212121;">',
'Olá, <strong>' + _escHtml_(g.nome) + '</strong>! 🎉<br>',
'Seu ingresso está confirmado. Apresente o QR Code abaixo na entrada do evento.',
'</p>',

'<!-- INGRESSO — linha tracejada -->',
'<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px dashed #3f51b5;border-radius:12px;overflow:hidden;">',
'<tr>',

'<!-- Lado esquerdo — QR Code -->',
'<td width="240" style="padding:24px;text-align:center;background:#f8f9ff;border-right:2px dashed #3f51b5;vertical-align:middle;">',
'<img src="' + qrUrl + '" alt="QR Code" width="180" height="180"',
' style="display:block;margin:0 auto;border:6px solid #1a237e;border-radius:8px;">',
'<p style="margin:10px 0 0;font-size:11px;color:#9e9e9e;letter-spacing:1px;text-transform:uppercase;">Aponte a câmera</p>',
'</td>',

'<!-- Lado direito — dados -->',
'<td style="padding:24px;vertical-align:middle;">',

'<table cellpadding="0" cellspacing="0" border="0" width="100%">',

'<tr><td style="padding-bottom:14px;">',
'<span style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#9e9e9e;">Participante</span>',
'<strong style="font-size:16px;color:#1a237e;">' + _escHtml_(g.nome) + '</strong>',
'</td></tr>',

'<tr><td style="padding-bottom:14px;">',
'<span style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#9e9e9e;">CPF</span>',
'<strong style="font-size:14px;color:#212121;">' + _escHtml_(g.cpf) + '</strong>',
'</td></tr>',

'<tr><td style="padding-bottom:14px;">',
'<span style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#9e9e9e;">Ingresso</span>',
'<strong style="font-size:13px;color:#212121;">' + _escHtml_(g.produto) + '</strong>',
'</td></tr>',

'<tr><td style="padding-bottom:14px;">',
'<span style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#9e9e9e;">Valor pago</span>',
'<strong style="font-size:14px;color:#212121;">' + _escHtml_(g.valor) + '</strong>',
'</td></tr>',

'<!-- Código de exibição -->',
'<tr><td>',
'<span style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#9e9e9e;margin-bottom:4px;">Código</span>',
'<span style="display:inline-block;background:#1a237e;color:#ffffff;font-size:18px;font-weight:900;',
'letter-spacing:4px;padding:8px 16px;border-radius:6px;font-family:Courier,monospace;">' + g.codigo + '</span>',
'</td></tr>',

'</table>',
'</td>',
'</tr>',
'</table>',
'<!-- fim ingresso tracejado -->',

'<!-- Aviso -->',
'<p style="margin:24px 0 0;font-size:13px;color:#757575;text-align:center;',
'border-top:1px solid #f0f0f0;padding-top:16px;">',
'⚠️ Este ingresso é pessoal e intransferível. Será validado <strong>uma única vez</strong> na entrada.',
'</p>',

'</td></tr>',
'<!-- fim body branco -->',

'<!-- FOOTER -->',
'<tr><td style="background:#0d1b4b;padding:20px 32px;text-align:center;border-radius:0 0 12px 12px;">',
'<p style="margin:0;color:#7986cb;font-size:12px;">',
'Dúvidas? Fale conosco via WhatsApp ou em <a href="mailto:wpktavares@gmail.com" style="color:#90caf9;">wpktavares@gmail.com</a>',
'</p>',
'<p style="margin:6px 0 0;color:#3f51b5;font-size:11px;">© 2026 WPK Tavares — Todos os direitos reservados</p>',
'</td></tr>',

'</table>',
'<!-- fim container -->',

'</td></tr>',
'</table>',
'<!-- fim wrapper -->',

'</body>',
'</html>',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

/** Gera UUID v4 completo em maiúsculas */
function _gerarUUID_() {
  return Utilities.getUuid().toUpperCase();
}

/** Código de exibição: primeiros 8 hex chars do UUID sem hífens */
function _codigoExibicao_(uuid) {
  return String(uuid).replace(/-/g, '').substring(0, 8).toUpperCase();
}

/** Formata CPF: 12345678909 → 123.456.789-09 */
function _formatCPF_(digits) {
  var d = String(digits || '').replace(/\D/g, '');
  if (d.length === 11) {
    return d.substring(0,3) + '.' + d.substring(3,6) + '.' + d.substring(6,9) + '-' + d.substring(9,11);
  }
  return digits || '';
}

/** Escapa HTML para evitar XSS no template do e-mail */
function _escHtml_(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Resposta JSON padrão para webhooks de evento */
function _okEvento_(status, msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: status, msg: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}
