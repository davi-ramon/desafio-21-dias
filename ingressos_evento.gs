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

  // E-mail remetente — deve ser a conta PROPRIETÁRIA do Apps Script.
  // Enquanto o script estiver sob ads.deyvid@gmail.com, use esse e-mail.
  // Quando transferir propriedade para wpktavares@gmail.com, troque aqui.
  FROM_EMAIL:  'ads.deyvid@gmail.com',
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

  // Imagem do ingresso visual (banner principal do e-mail)
  BANNER_IMG:  'https://i.imgur.com/Z93ZB0M.jpeg',

  // Imgur API — Client-ID para upload de QR Codes
  // Registre em: https://api.imgur.com/oauth2/addclient (anônimo, sem login obrigatório)
  // Deixe '' para usar o serviço qrserver.com com cid: inline
  IMGUR_CLIENT_ID: '',
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
// Estratégia de QR Code em cascata:
//   1. Imgur API (se IMGUR_CLIENT_ID configurado) → URL pública confiável
//   2. qrserver.com como blob cid: (fallback)
//   3. URL direta no <img src> (último recurso)
// ─────────────────────────────────────────────────────────────
function enviarEmailIngresso_(g) {
  var checkinUrl = _EVENTO_.CHECKIN_URL + '?id=' + encodeURIComponent(g.uuid);
  var assunto    = 'Ingresso Confirmado | ' + _EVENTO_.TITULO + ' ' + _EVENTO_.SUBTITULO;

  // ── Estratégia 1: Imgur API ────────────────────────────────
  if (_EVENTO_.IMGUR_CLIENT_ID) {
    try {
      var qrImgurUrl = _uploadQRToImgur_(checkinUrl);
      var html = _buildIngressoHTML_(g, qrImgurUrl);
      GmailApp.sendEmail(g.email, assunto, '', {
        from: _EVENTO_.FROM_EMAIL, name: _EVENTO_.FROM_NAME,
        htmlBody: html, replyTo: _EVENTO_.FROM_EMAIL,
      });
      return;
    } catch(e) {
      logAction('system', 'EVENTO_IMGUR_ERRO', 'email', g.orderId, e.message);
    }
  }

  // ── Estratégia 2: qrserver.com → blob cid: ────────────────
  try {
    var qrApiUrl = 'https://api.qrserver.com/v1/create-qr-code/'
                 + '?size=200x200&ecc=H&format=png&data='
                 + encodeURIComponent(checkinUrl);
    var resp = UrlFetchApp.fetch(qrApiUrl, { muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      var qrBlob = resp.getBlob().setName('qrcode.png');
      var html   = _buildIngressoHTML_(g, 'cid:qrcode');
      GmailApp.sendEmail(g.email, assunto, '', {
        from: _EVENTO_.FROM_EMAIL, name: _EVENTO_.FROM_NAME,
        htmlBody: html, replyTo: _EVENTO_.FROM_EMAIL,
        inlineImages: { qrcode: qrBlob },
      });
      return;
    }
  } catch(e) {
    logAction('system', 'EVENTO_QR_BLOB_ERRO', 'email', g.orderId, e.message);
  }

  // ── Estratégia 3: URL direta (último recurso) ──────────────
  var qrDirectUrl = 'https://api.qrserver.com/v1/create-qr-code/'
                  + '?size=200x200&ecc=H&format=png&data='
                  + encodeURIComponent(checkinUrl);
  var html = _buildIngressoHTML_(g, qrDirectUrl);
  GmailApp.sendEmail(g.email, assunto, '', {
    from: _EVENTO_.FROM_EMAIL, name: _EVENTO_.FROM_NAME,
    htmlBody: html, replyTo: _EVENTO_.FROM_EMAIL,
  });
}

// ─────────────────────────────────────────────────────────────
// IMGUR API — sobe o QR Code e retorna URL pública permanente
// ─────────────────────────────────────────────────────────────
function _uploadQRToImgur_(checkinUrl) {
  var qrApiUrl = 'https://api.qrserver.com/v1/create-qr-code/'
               + '?size=200x200&ecc=H&format=png&data='
               + encodeURIComponent(checkinUrl);
  var qrBytes  = UrlFetchApp.fetch(qrApiUrl).getContent();
  var base64   = Utilities.base64Encode(qrBytes);

  var resp = UrlFetchApp.fetch('https://api.imgur.com/3/image', {
    method:  'post',
    headers: { 'Authorization': 'Client-ID ' + _EVENTO_.IMGUR_CLIENT_ID },
    payload: { image: base64, type: 'base64', title: 'QR-' + Utilities.getUuid().substring(0,8) },
    muteHttpExceptions: true,
  });
  var data = JSON.parse(resp.getContentText());
  if (!data.success) throw new Error('Imgur upload falhou: ' + JSON.stringify(data.data));
  return data.data.link;
}

// ─────────────────────────────────────────────────────────────
// TEMPLATE HTML DO INGRESSO
// Layout: imagem do ingresso como hero → saudação → QR + dados → footer
// Sem emoji (causam ????? no GmailApp). QR via cid:qrcode (sempre exibido).
// ─────────────────────────────────────────────────────────────
function _buildIngressoHTML_(g, qrSrc) {
  qrSrc = qrSrc || 'cid:qrcode';

  var html = '<!DOCTYPE html>'
+ '<html lang="pt-BR">'
+ '<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
+ '<body style="margin:0;padding:0;background:#111111;font-family:Arial,Helvetica,sans-serif;">'

// Wrapper
+ '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#111111;padding:24px 0;">'
+ '<tr><td align="center">'
+ '<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">'

// ── HERO: imagem do ingresso (100% largura, sem padding lateral) ──
+ '<tr><td style="padding:0;line-height:0;">'
+ '<img src="' + _EVENTO_.BANNER_IMG + '" alt="Ingresso ' + _escHtml_(_EVENTO_.TITULO) + '"'
+ ' width="600" style="display:block;width:100%;max-width:600px;border:0;border-radius:10px 10px 0 0;">'
+ '</td></tr>'

// ── FAIXA PRETA: "Seu ingresso está confirmado" ──
+ '<tr><td style="background:#0a0a0a;padding:20px 28px;border-left:1px solid #222;border-right:1px solid #222;">'
+ '<p style="margin:0;font-size:15px;color:#e0e0e0;line-height:1.6;">'
+ 'Ola, <strong style="color:#ffffff;">' + _escHtml_(g.nome) + '</strong>!'
+ '<br>Seu ingresso esta confirmado. Apresente o QR Code abaixo na entrada do evento.'
+ '</p>'
+ '</td></tr>'

// ── SECAO VERDE ESCURO: QR Code + dados do participante ──
+ '<tr><td style="background:#0d1a0d;padding:0;border:1px solid #1a3d1a;border-top:none;">'
+ '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'

// Coluna esquerda — QR Code
+ '<td width="200" style="padding:24px 16px 24px 24px;text-align:center;'
+ 'border-right:1px dashed #2d5a2d;vertical-align:middle;">'
+ '<div style="background:#ffffff;padding:8px;display:inline-block;border-radius:8px;">'
+ '<img src="' + qrSrc + '" alt="QR Code" width="156" height="156"'
+ ' style="display:block;">'
+ '</div>'
+ '<p style="margin:8px 0 0;font-size:10px;color:#4caf50;letter-spacing:1px;text-transform:uppercase;font-weight:700;">Aponte a camera</p>'
+ '</td>'

// Coluna direita — dados
+ '<td style="padding:24px;vertical-align:middle;">'

+ '<div style="margin-bottom:14px;">'
+ '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#4caf50;margin-bottom:3px;">Participante</div>'
+ '<div style="font-size:16px;font-weight:700;color:#ffffff;">' + _escHtml_(g.nome) + '</div>'
+ '</div>'

+ '<div style="margin-bottom:14px;">'
+ '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#4caf50;margin-bottom:3px;">CPF</div>'
+ '<div style="font-size:14px;font-weight:600;color:#e0e0e0;">' + _escHtml_(g.cpf) + '</div>'
+ '</div>'

+ '<div style="margin-bottom:14px;">'
+ '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#4caf50;margin-bottom:3px;">Tipo de ingresso</div>'
+ '<div style="font-size:13px;font-weight:600;color:#e0e0e0;">Ingresso Virtual</div>'
+ '</div>'

+ '<div>'
+ '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#4caf50;margin-bottom:6px;">Codigo do ingresso</div>'
+ '<div style="display:inline-block;background:#1b5e20;border:1px solid #4caf50;'
+ 'color:#ffffff;font-size:20px;font-weight:900;letter-spacing:5px;'
+ 'padding:8px 16px;border-radius:6px;font-family:Courier,monospace;">'
+ _escHtml_(g.codigo)
+ '</div>'
+ '</div>'

+ '</td>'
+ '</tr></table>'
+ '</td></tr>'

// ── AVISO ──
+ '<tr><td style="background:#0a0a0a;padding:14px 28px;'
+ 'border-left:1px solid #222;border-right:1px solid #222;">'
+ '<p style="margin:0;font-size:11px;color:#757575;text-align:center;">'
+ 'ATENCAO: Este ingresso e pessoal e intransferivel. Sera validado <strong style="color:#9e9e9e;">uma unica vez</strong> na entrada.'
+ '</p>'
+ '</td></tr>'

// ── FOOTER ──
+ '<tr><td style="background:#050505;padding:16px 28px;text-align:center;'
+ 'border:1px solid #1a1a1a;border-top:1px solid #222;border-radius:0 0 10px 10px;">'
+ '<p style="margin:0;color:#424242;font-size:11px;">'
+ 'Duvidas? Fale conosco via WhatsApp ou em '
+ '<a href="mailto:wpktavares@gmail.com" style="color:#4caf50;">wpktavares@gmail.com</a>'
+ '</p>'
+ '<p style="margin:5px 0 0;color:#2e2e2e;font-size:10px;">(c) 2026 WPK Tavares — Todos os direitos reservados</p>'
+ '</td></tr>'

+ '</table>'
+ '</td></tr>'
+ '</table>'
+ '</body></html>';

  return html;
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
