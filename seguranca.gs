// ============================================================
// seguranca.gs — Camada de Blindagem (FASE 1)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// 1. Validação do secret do webhook Cakto (anti-fraude)
// 2. Rate-limit por identificador (anti brute-force / spam / DoS)
// 3. Honeypot nos formulários públicos (anti-bot)
// ------------------------------------------------------------
// Dev: Claude Code, sob comando de David Ramon.
// ============================================================

// ─────────────────────────────────────────────────────────────
// 1. SECRET DO WEBHOOK CAKTO
// Guardado no PropertiesService — NUNCA em texto claro no código.
// Configuração (2 formas):
//   A) UI do editor: ⚙ Configurações do projeto → Propriedades do script
//      → adicionar propriedade  CAKTO_WEBHOOK_SECRET = <valor da Cakto>
//   B) Código: rode setupCaktoSecret('<valor>') UMA VEZ passando o valor,
//      e NÃO deixe o valor salvo no arquivo depois.
// ─────────────────────────────────────────────────────────────
function setupCaktoSecret(secret) {
  secret = String(secret || '').trim();
  if (!secret) throw new Error('Informe o secret: setupCaktoSecret("valor-da-cakto")');
  PropertiesService.getScriptProperties().setProperty('CAKTO_WEBHOOK_SECRET', secret);
  Logger.log('✅ Secret do webhook Cakto gravado no PropertiesService.');
  return 'OK — secret Cakto configurado. A partir de agora o webhook é validado.';
}

function _caktoSecretEsperado_() {
  return PropertiesService.getScriptProperties().getProperty('CAKTO_WEBHOOK_SECRET') || '';
}

// Valida o secret recebido no payload da Cakto.
// FAIL-OPEN enquanto o secret não estiver configurado (não quebra produção
// antes de rodar setupCaktoSecret). FAIL-CLOSED depois de configurado.
// Comparação em tempo constante (evita timing attack).
// Retorna { ok:true } | { ok:true, semConfig:true } | { ok:false, motivo }.
function _validarCaktoSecret_(recebido) {
  var esperado = _caktoSecretEsperado_();
  if (!esperado) return { ok: true, semConfig: true };   // ainda não blindado
  if (!recebido) return { ok: false, motivo: 'sem secret' };
  recebido = String(recebido);
  if (recebido.length !== esperado.length) return { ok: false, motivo: 'secret invalido' };
  var diff = 0;
  for (var i = 0; i < esperado.length; i++) {
    diff |= (esperado.charCodeAt(i) ^ recebido.charCodeAt(i));
  }
  return diff === 0 ? { ok: true } : { ok: false, motivo: 'secret invalido' };
}

// Bloqueio padrão de webhook não autorizado (+ alerta Telegram).
function _rejeitarWebhook_(event, motivo) {
  _alertaSuspeito_('webhook_rejeitado', '🚨 Webhook REJEITADO (' + motivo + '). Possível fraude. event=' + (event || '?'));
  var out = ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'unauthorized' }));
  out.setMimeType(ContentService.MimeType.JSON);
  return out;
}

// ─────────────────────────────────────────────────────────────
// ALERTA DE ATIVIDADE SUSPEITA (deduplicado p/ não spammar o grupo)
// Dispara no máximo 1 alerta por tipo a cada 15 min (via CacheService).
// Envia pelo Telegram se o bot estiver configurado (setupTelegram()).
// ─────────────────────────────────────────────────────────────
function _alertaSuspeito_(tipo, detalhe) {
  try {
    var cache = CacheService.getScriptCache();
    var k = 'alerta_' + tipo;
    if (cache.get(k)) return;              // já alertou recentemente → silencia
    cache.put(k, '1', 900);                // 15 min de silêncio por tipo
    var msg = '🛡️ *Alerta de segurança*\n' + String(detalhe || tipo);
    if (typeof tgEnviarErro_ === 'function')      { tgEnviarErro_('seguranca', msg); }
    else if (typeof tgEnviar_ === 'function')     { tgEnviar_(msg); }
  } catch (_e) {}
}

// ─────────────────────────────────────────────────────────────
// SANITIZAÇÃO ANTI-XSS — remove vetores executáveis de conteúdo
// gerado por usuário (posts/comentários/mensagens). Preserva texto,
// emoji e quebras de linha; mata script/iframe/handlers/js:.
// ─────────────────────────────────────────────────────────────
function _limparXSS_(str) {
  var s = String(str == null ? '' : str);
  s = s.replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, '');
  s = s.replace(/<\s*\/?\s*(script|iframe|object|embed|link|meta|style|base|form)\b[^>]*>/gi, '');
  s = s.replace(/\son\w+\s*=\s*"[^"]*"/gi, '');
  s = s.replace(/\son\w+\s*=\s*'[^']*'/gi, '');
  s = s.replace(/\son\w+\s*=\s*[^\s>]+/gi, '');
  s = s.replace(/javascript\s*:/gi, '');
  s = s.replace(/data\s*:\s*text\/html/gi, '');
  return s;
}

// Neutraliza injeção de fórmula p/ valores abertos em Excel/Sheets pela equipe.
// Prefixa aspas simples se o valor começa com = + - @ ou tab.
function _sanitFormula_(v) {
  var s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
  return s;
}

// Identificador parcial p/ alertas (privacidade): "jo***@dominio" ou "abc***".
function _idParcial_(id) {
  var s = String(id || 'anon');
  var at = s.indexOf('@');
  if (at > 0) return s.substring(0, Math.min(2, at)) + '***' + s.substring(at);
  return s.substring(0, 3) + '***';
}

// ─────────────────────────────────────────────────────────────
// 2. RATE-LIMIT por identificador (CacheService)
// GAS Web App NÃO expõe o IP do cliente, então limitamos por
// identificador (e-mail / whatsapp / ação). Cobre os ataques reais:
// brute-force de login, bombardeio de reset e spam de cadastro.
// Retorna true se ESTOUROU o limite (deve bloquear).
// ─────────────────────────────────────────────────────────────
function _rateLimit_(bucket, id, maxHits, windowSec) {
  try {
    if (!id) id = 'anon';
    var key = 'rl_' + bucket + '_' + Utilities.base64EncodeWebSafe(String(id)).slice(0, 90);
    var cache = CacheService.getScriptCache();
    var atual = parseInt(cache.get(key) || '0', 10);
    if (atual >= maxHits) return true;              // estourou
    cache.put(key, String(atual + 1), windowSec);   // janela deslizante simples
    return false;
  } catch (e) {
    return false;   // fail-open em erro de cache (não derruba o serviço)
  }
}

function _blockResp_(msg) {
  return { ok: false, error: msg || 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' };
}

// ─────────────────────────────────────────────────────────────
// 3. HONEYPot — campo oculto que humanos deixam vazio.
// Se vier preenchido = bot. (O front pode adicionar um input escondido
// com name="_hp" ou "website"; sem isso, nunca gera falso positivo.)
// ─────────────────────────────────────────────────────────────
function _honeypotAcionado_(data) {
  if (!data) return false;
  return !!(data._hp || data.website || data.url_site || data.confirmEmail);
}

// ─────────────────────────────────────────────────────────────
// 4. GATE central das rotas públicas.
// Aplica honeypot + rate-limit ANTES de executar a ação pública.
// Retorna null se liberado, ou um objeto de resposta se bloqueado.
// ─────────────────────────────────────────────────────────────
function _gatePublico_(payload) {
  var action = payload.action;
  var data   = payload.data || {};
  var email  = String(data.email || '').toLowerCase().trim();
  var wa     = String(data.whatsapp || '').replace(/\D/g, '');

  // Honeypot nos formulários de cadastro/lead → finge sucesso pro bot não perceber
  if ((action === 'registrarTrial' || action === 'salvarLeadIncompleto') && _honeypotAcionado_(data)) {
    return { ok: true, message: 'ok' };
  }

  switch (action) {
    case 'login':
      // 8 tentativas / 5 min por e-mail (anti brute-force)
      if (_rateLimit_('login', email, 8, 300)) {
        _alertaSuspeito_('bruteforce_login', '🔐 Excesso de tentativas de LOGIN. Alvo: ' + _idParcial_(email));
        return _blockResp_('Muitas tentativas de login. Aguarde 5 minutos.');
      }
      break;

    case 'sendPasswordReset':
      // 3 pedidos / 15 min por e-mail (anti reset-bombing)
      if (_rateLimit_('pwreset', email, 3, 900)) {
        _alertaSuspeito_('reset_bombing', '📧 Excesso de pedidos de recuperação de senha. Alvo: ' + _idParcial_(email));
        return _blockResp_('Você já solicitou a recuperação recentemente. Aguarde alguns minutos.');
      }
      break;

    case 'verifyAndResetPassword':
      // 10 tentativas / 15 min por e-mail (anti brute-force do código de 6 dígitos)
      if (_rateLimit_('pwverify', email, 10, 900)) {
        _alertaSuspeito_('bruteforce_codigo', '🔢 Excesso de tentativas de código de reset. Alvo: ' + _idParcial_(email));
        return _blockResp_('Muitas tentativas. Solicite um novo código.');
      }
      break;

    case 'reaberturaAccess':
      // 6 tentativas / 15 min por e-mail
      if (_rateLimit_('reabertura', email, 6, 900))
        return _blockResp_('Muitas tentativas. Aguarde alguns minutos.');
      break;

    case 'registrarTrial':
      // 5 cadastros / hora por e-mail E por whatsapp (anti spam de trial)
      if (_rateLimit_('trial_e', email, 5, 3600) || _rateLimit_('trial_w', wa, 5, 3600))
        return _blockResp_('Limite de cadastros atingido. Tente novamente mais tarde.');
      break;

    case 'salvarLeadIncompleto':
      // chamado a cada passo do form → mais permissivo: 40 / hora
      if (_rateLimit_('lead', email || wa, 40, 3600))
        return { ok: true, throttled: true };
      break;

    // v106 — onboarding pós-compra
    case 'definirSenhaComToken':
      // 10 tentativas / 15 min por token (anti brute-force do link mágico)
      if (_rateLimit_('setpwd', String(data.t || '').slice(0, 24), 10, 900)) {
        _alertaSuspeito_('bruteforce_link', '🔗 Excesso de tentativas em link de acesso.');
        return _blockResp_('Muitas tentativas. Solicite um novo link.');
      }
      break;

    case 'validarTokenAcesso':
      // 30 leituras / 15 min por token (a página valida ao abrir)
      if (_rateLimit_('chktok', String(data.t || '').slice(0, 24), 30, 900))
        return _blockResp_('Muitas tentativas. Aguarde alguns minutos.');
      break;

    case 'reenviarLinkAcesso':
      // 3 reenvios / 15 min por e-mail (anti bombing — mesmo teto do reset)
      if (_rateLimit_('reenvlink', email, 3, 900))
        return { ok: true };   // anti-enumeração: finge sucesso
      break;

    case 'confirmarCheckoutStripe':
      // 30 consultas / 15 min por sessão (a página faz retry enquanto o
      // webhook não processa — precisa caber várias chamadas legítimas)
      if (_rateLimit_('confses', String(data.sessionId || '').slice(0, 24), 30, 900))
        return _blockResp_('Muitas consultas. Recarregue a página em instantes.');
      break;

    // trackPageEvent / trackVsl / getEventoBySlug / verificarIngresso:
    // leitura/telemetria — sem rate-limit por identificador (baixo risco).
  }
  return null; // liberado
}

// ─────────────────────────────────────────────────────────────
// DIAGNÓSTICO — confirma o estado da blindagem (rode quando quiser)
// ─────────────────────────────────────────────────────────────
function statusBlindagem() {
  var secret = _caktoSecretEsperado_();
  var msg = '🛡️ Blindagem FASE 1\n' +
    '• Secret Cakto: ' + (secret ? 'CONFIGURADO ✅ (webhook validado)' : 'PENDENTE ⚠️ (rode setupCaktoSecret)') + '\n' +
    '• Rate-limit rotas públicas: ATIVO ✅\n' +
    '• Honeypot formulários: ATIVO ✅';
  Logger.log(msg);
  return msg;
}
