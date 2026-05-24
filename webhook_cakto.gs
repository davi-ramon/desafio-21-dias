var CFG = {
  // GPT Maker — API oficial (Bia Tavares)
  GPTMAKER_TOKEN:   'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJncHRtYWtlciIsImlkIjoiM0Q3RENEM0QzREZCQjExOUJDOTY1QTI5RDcwQzBFQTciLCJ0ZW5hbnQiOiIzRDdEQ0QzRDNERkJCMTE5QkM5NjVBMjlENzBDMEVBNyIsInV1aWQiOiIzY2E3ODczYi1kYjZiLTRlMDAtOTdlZi0zYTU4NTJmYTJiMzgifQ.WikjQZv0EkQiBpkYpPUiy34FxFi9borCXqvUdJa72hE',
  GPTMAKER_CHAT_ID: '3EC71D3CE79690D58F1406248698ACFB-556392998814',

  // Planilha
  SHEET_ID:    '1KLn6C4LRW0GGTYVZnxYRrEaTQjPfxVfmAG9r3-ixhOU',
  SHEET_COMP:  'compradores',

  // Links do produto
  PDF_LINK:    'https://drive.google.com/file/d/119EuQBQ6VG8jvwGu14BdziPixfIllHmF/view?usp=drive_link',
  GRUPO_LINK:  'https://chat.whatsapp.com/KRpaLAV4lD526yhgOeC4Us',
  AUDIOS_LINK: 'https://wpktavares.com.br/audios', // ajuste se mudar
  SALA_LINK:   'https://meet.google.com/SEU_LINK',  // ajuste pelo link real da sala
};

// Mapa de colunas (índice base-0)
var COL = {
  ORDER_ID:    0,  // A
  EMAIL:       1,  // B
  STATUS:      2,  // C
  NOME:        3,  // D
  TELEFONE:    4,  // E
  PAID_AT:     5,  // F
  CREATED_AT:  6,  // G
  PRODUTO:     7,  // H
  CHECKOUT:    8,  // I
  EBOOK:       9,  // J
  AUDIOS:     10,  // K
  GRUPO:      11,  // L
  DIA_ATUAL:  12,  // M
  ATIVO:      13,  // N
  ULT_CHECK:  14,  // O
  ONBOARDED:  15,  // P
  DIA_CONC:   16,  // Q
  D1:         17   // R — D1 começa aqui, D2 em S (18), etc.
};

// ─────────────────────────────────────────────────────────────
// WEBHOOK — recebe POST da Cakto após pagamento aprovado
// ─────────────────────────────────────────────────────────────
// NOTA: esta função foi renomeada de doPost para doPostCaktoLegado_
// porque code.gs já contém o doPost principal que roteia tudo (incluindo
// payloads da Cakto via processWebhookCakto_). Dois doPost no mesmo projeto
// GAS causam conflito — o arquivo carregado por último (alfabeticamente,
// webhook_cakto.gs > code.gs) sobrepunha o roteador principal.
function doPostCaktoLegado_(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    Logger.log('Webhook: ' + JSON.stringify(data));

    var status = String(data.status || data.payment_status || '').toLowerCase();
    if (status !== 'paid' && status !== 'approved') {
      return ok('Ignorado: status=' + status);
    }

    var nome     = String(data.customer_name  || data.name  || '');
    var email    = String(data.customer_email || data.email || '');
    var telefone = limparFone(data.customer_phone || data.phone || '');
    var orderId  = String(data.transaction_id || data.order_id || data.id || '');
    var produto  = String(data.product_name   || data.product  || 'Desafio 21 Dias');
    var paidAt   = new Date().toISOString();

    if (!telefone) return ok('Sem telefone — pulando');

    // Evitar duplicatas
    if (compradorExiste(orderId)) return ok('Pedido já registrado: ' + orderId);

    // 1. Salvar na planilha
    salvarComprador(orderId, email, 'paid', nome, telefone, paidAt, produto);

    // 2. Disparar onboarding via GPT Maker
    var primeiroNome = nome.split(' ')[0] || 'pessoal';
    var msgOnboarding =
      'Boa, ' + primeiroNome + '! 🙌\n\n' +
      'Sua inscrição no *Desafio 21 Dias* tá confirmada.\n\n' +
      '📄 Seu guia em PDF: ' + CFG.PDF_LINK + '\n' +
      '💬 Grupo do desafio: ' + CFG.GRUPO_LINK + '\n\n' +
      '*Dia 1 começa agora.* Bora! 💪';

    enviarMensagem(telefone, msgOnboarding);

    return ok('Onboarding enviado para ' + nome);

  } catch (err) {
    Logger.log('Erro doPost: ' + err.toString());
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ─────────────────────────────────────────────────────────────
// ROTINA MANHÃ — 05:30 (trigger diário)
// Envia link da sala + áudio do dia
// ─────────────────────────────────────────────────────────────
function rotinaManha() {
  var linhas = getCompradores();
  linhas.forEach(function(linha, i) {
    if (!linha[COL.ATIVO]) return;
    var dia = parseInt(linha[COL.DIA_ATUAL]) || 1;
    if (dia > 21) return;

    var nome  = (String(linha[COL.NOME] || '')).split(' ')[0] || 'você';
    var fone  = String(linha[COL.TELEFONE]);
    var audio = CFG.AUDIOS_LINK + '/dia-' + dia;

    var msg =
      '☀️ *Dia ' + dia + ' de 21 — bom dia, ' + nome + '!*\n\n' +
      '🌅 Sala de leitura em 25 min:\n' + CFG.SALA_LINK + '\n\n' +
      '🎧 Áudio de hoje:\n' + audio + '\n\n' +
      '3 pilares: 🧘 Meditação · 📖 Leitura · 🏃 Exercício';

    enviarMensagem(fone, msg);
  });
}

// ─────────────────────────────────────────────────────────────
// ROTINA NOITE — 21:00 (trigger diário)
// Check-in do dia e avança contador
// ─────────────────────────────────────────────────────────────
function rotinaNight() {
  var ss  = SpreadsheetApp.openById(CFG.SHEET_ID);
  var aba = ss.getSheetByName(CFG.SHEET_COMP);
  if (!aba) return;

  var dados = aba.getDataRange().getValues();
  // pula cabeçalho (linha 0)
  for (var i = 1; i < dados.length; i++) {
    var linha = dados[i];
    if (!linha[COL.ATIVO]) continue;

    var dia  = parseInt(linha[COL.DIA_ATUAL]) || 1;
    if (dia > 21) continue;

    var nome = (String(linha[COL.NOME] || '')).split(' ')[0] || 'você';
    var fone = String(linha[COL.TELEFONE]);

    var msg =
      '🌙 *Check-in — Dia ' + dia + ', ' + nome + '*\n\n' +
      'Concluiu os 3 pilares hoje?\n\n' +
      'Responde aqui:\n' +
      '✅ *SIM* — completei tudo\n' +
      '🔄 *PARCIAL* — completei parte';

    enviarMensagem(fone, msg);

    // Avança o dia e registra timestamp do check-in
    aba.getRange(i + 1, COL.DIA_ATUAL + 1).setValue(dia + 1);
    aba.getRange(i + 1, COL.ULT_CHECK + 1).setValue(new Date().toISOString());

    // Se completou o desafio
    if (dia === 21) {
      aba.getRange(i + 1, COL.ATIVO + 1).setValue(false);
      aba.getRange(i + 1, COL.DIA_CONC + 1).setValue(new Date().toISOString());

      var msgFim =
        '🏆 *PARABÉNS, ' + nome.toUpperCase() + '!*\n\n' +
        'Você completou os 21 dias! 🎉\n\n' +
        'Isso que você fez é raro. Continue. 💪\n\n' +
        '_Equipe WPK Tavares_';
      enviarMensagem(fone, msgFim);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// REGISTRAR CHECK-IN QUANDO O COMPRADOR RESPONDE
// (opcional: criar um segundo webhook ou tratar via GPT Maker)
// ─────────────────────────────────────────────────────────────
function registrarCheckin(telefone, resposta) {
  var ss  = SpreadsheetApp.openById(CFG.SHEET_ID);
  var aba = ss.getSheetByName(CFG.SHEET_COMP);
  if (!aba) return;

  var dados = aba.getDataRange().getValues();
  var foneNorm = limparFone(telefone);

  for (var i = 1; i < dados.length; i++) {
    var fonePlanilha = limparFone(String(dados[i][COL.TELEFONE]));
    if (fonePlanilha !== foneNorm) continue;

    var dia = parseInt(dados[i][COL.DIA_ATUAL]) || 1;
    // Dia que acabou = dia - 1 (o contador já foi avançado pela rotina noturna)
    var diaCheckin = dia - 1;
    if (diaCheckin < 1 || diaCheckin > 21) return;

    var colCheckin = COL.D1 + (diaCheckin - 1); // D1 = col 17 (R), D21 = col 37 (AL)
    var valor = resposta.toUpperCase().indexOf('SIM') !== -1 ? 'SIM' :
                resposta.toUpperCase().indexOf('PARCIAL') !== -1 ? 'PARCIAL' : 'NÃO';

    aba.getRange(i + 1, colCheckin + 1).setValue(valor);
    aba.getRange(i + 1, COL.ULT_CHECK + 1).setValue(new Date().toISOString());
    Logger.log('Checkin registrado: ' + fonePlanilha + ' D' + diaCheckin + '=' + valor);
    break;
  }
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

/** Envia mensagem via API GPT Maker (janela 24h aberta pelo template) */
function enviarMensagem(telefone, mensagem) {
  var endpoint = 'https://api.gptmaker.ai/v2/chat/' + CFG.GPTMAKER_CHAT_ID + '/send-message';
  var options = {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + CFG.GPTMAKER_TOKEN,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({
      message: mensagem,
      replyMessageId: ''   // string vazia = nova mensagem
    }),
    muteHttpExceptions: true
  };

  // NOTA: a API do GPT Maker identifica o destinatário pelo chat_id que já contém
  // o número. Para enviar para números diferentes, o chat_id muda por conversa.
  // Se a API suportar destinatário dinâmico, adicione "to": telefone no payload.
  // Verifique a documentação do GPT Maker para envio em massa.

  var resp = UrlFetchApp.fetch(endpoint, options);
  Logger.log('GPTMaker [' + telefone + ']: ' + resp.getResponseCode() + ' ' + resp.getContentText().substring(0, 200));
}

/** Salva linha na aba compradores com todas as colunas A–Q */
function salvarComprador(orderId, email, status, nome, telefone, paidAt, produto) {
  var ss  = SpreadsheetApp.openById(CFG.SHEET_ID);
  var aba = ss.getSheetByName(CFG.SHEET_COMP);

  if (!aba) {
    aba = ss.insertSheet(CFG.SHEET_COMP);
    // Cabeçalho completo
    var cab = [
      'OrderId','Email','Status','Nome','Telefone','PaidAt','CreatedAt','Produto',
      'CheckoutUrl','EbookUrl','AudiosUrl','GrupoUrl',
      'DiaAtual','Ativo','UltimoCheckin','OnboardingEnviado','DiaConcluido'
    ];
    // Adicionar D1–D21
    for (var d = 1; d <= 21; d++) cab.push('D' + d);
    aba.appendRow(cab);
  }

  var agora = new Date().toISOString();
  var linha = [
    orderId, email, status, nome, telefone, paidAt, agora, produto,
    '',               // CheckoutUrl (não enviado pelo Cakto neste campo)
    CFG.PDF_LINK,
    CFG.AUDIOS_LINK,
    CFG.GRUPO_LINK,
    1,                // DiaAtual começa em 1
    true,             // Ativo
    '',               // UltimoCheckin
    true,             // OnboardingEnviado
    ''                // DiaConcluido
  ];
  // 21 colunas de checkin vazias
  for (var i = 0; i < 21; i++) linha.push('');

  aba.appendRow(linha);
  Logger.log('Comprador salvo: ' + nome + ' | ' + email);
}

/** Verifica se orderId já foi registrado (evita duplicata) */
function compradorExiste(orderId) {
  var ss  = SpreadsheetApp.openById(CFG.SHEET_ID);
  var aba = ss.getSheetByName(CFG.SHEET_COMP);
  if (!aba) return false;
  var dados = aba.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][COL.ORDER_ID]) === String(orderId)) return true;
  }
  return false;
}

/** Retorna todas as linhas de compradores ativos */
function getCompradores() {
  var ss  = SpreadsheetApp.openById(CFG.SHEET_ID);
  var aba = ss.getSheetByName(CFG.SHEET_COMP);
  if (!aba) return [];
  var dados = aba.getDataRange().getValues();
  return dados.slice(1).filter(function(r) { return r[COL.ATIVO] === true; });
}

/** Remove não-dígitos, garante prefixo 55 */
function limparFone(tel) {
  var t = String(tel).replace(/\D/g, '');
  if (t.length >= 10 && t.substring(0, 2) !== '55') t = '55' + t;
  return t;
}

function ok(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', msg: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}
