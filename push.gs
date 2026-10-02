// ============================================================
// push.gs — Notificações push (FCM HTTP v1) — v167
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// POR QUE FCM E NÃO WEB PUSH DIRETO
//
// O protocolo Web Push exige assinar um JWT com ECDSA P-256 e
// criptografar o payload com ECDH + AES-GCM. O Apps Script não
// faz nenhum dos dois: Utilities só oferece HMAC e RSA.
//
// O FCM resolve isso do outro lado — mandamos um POST comum e
// ele cuida da assinatura VAPID e da criptografia. E a conta de
// serviço usa JWT RS256, que o Apps Script assina nativamente
// com computeRsaSha256Signature. É o único caminho que fecha
// dentro desta arquitetura.
//
// iOS: push na web só funciona a partir do iOS 16.4 E com o app
// INSTALADO na tela de início. Safari em aba não recebe nada.
// Isso não é limitação nossa nem contornável — por isso o app
// insiste na instalação antes de pedir permissão.
// ============================================================

var PUSH_ABA    = 'push_tokens';
var PUSH_ESCOPO = 'https://www.googleapis.com/auth/firebase.messaging';

function _puNorm_(e) { return String(e || '').toLowerCase().trim(); }

function _puAba_() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(PUSH_ABA);
  if (!sh) {
    sh = ss.insertSheet(PUSH_ABA);
    sh.appendRow(['email', 'token', 'plataforma', 'instalado', 'criado_em',
                  'ultimo_envio', 'falhas', 'ativo']);
    sh.getRange(1, 1, 1, 8).setFontWeight('bold')
      .setBackground('#b71c1c').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function _puConta_() {
  var raw = '';
  try { raw = PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT') || ''; } catch (e) {}
  if (!raw) return null;
  try {
    var c = JSON.parse(raw);
    if (!c.client_email || !c.private_key || !c.project_id) return null;
    return c;
  } catch (e) { return null; }
}

function pushConfigurado_() { return !!_puConta_(); }

// ─────────────────────────────────────────────────────────────
// OAuth da conta de serviço — JWT RS256 trocado por access_token.
// O token vale 1h; guardamos por 50 min para não pedir a cada envio.
// ─────────────────────────────────────────────────────────────
function _puAccessToken_() {
  var cache = CacheService.getScriptCache();
  try {
    var pronto = cache.get('fcm_token');
    if (pronto) return pronto;
  } catch (e) {}

  var conta = _puConta_();
  if (!conta) return '';

  var agora = Math.floor(Date.now() / 1000);
  var cabecalho = { alg: 'RS256', typ: 'JWT' };
  var corpo = {
    iss: conta.client_email,
    scope: PUSH_ESCOPO,
    aud: 'https://oauth2.googleapis.com/token',
    iat: agora,
    exp: agora + 3600
  };

  var b64 = function (obj) {
    return Utilities.base64EncodeWebSafe(JSON.stringify(obj)).replace(/=+$/, '');
  };
  var base = b64(cabecalho) + '.' + b64(corpo);
  var assinatura = Utilities.computeRsaSha256Signature(base, conta.private_key);
  var jwt = base + '.' + Utilities.base64EncodeWebSafe(assinatura).replace(/=+$/, '');

  var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    logAction('system', 'PUSH_OAUTH_ERRO', 'push', '', resp.getContentText().slice(0, 200));
    return '';
  }
  var t = JSON.parse(resp.getContentText()).access_token || '';
  if (t) { try { cache.put('fcm_token', t, 3000); } catch (e) {} }
  return t;
}

// ─────────────────────────────────────────────────────────────
// ROTA (auth): pushRegistrar — o app manda o token do aparelho
// ─────────────────────────────────────────────────────────────
function pushRegistrar(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  var d = data || {};
  var fcm = String(d.fcmToken || '').trim();
  if (fcm.length < 40) return { ok: false, error: 'Token inválido.' };

  var email = _puNorm_(user.email);
  var sh = _puAba_();
  var linhas = sh.getDataRange().getValues();
  var agora = nowISO();

  for (var i = 1; i < linhas.length; i++) {
    if (String(linhas[i][1]) === fcm) {
      // Mesmo aparelho: atualiza dono e reativa. Aparelho emprestado
      // ou conta trocada não pode continuar recebendo aviso de outro.
      sh.getRange(i + 1, 1).setValue(email);
      sh.getRange(i + 1, 3).setValue(String(d.plataforma || ''));
      sh.getRange(i + 1, 4).setValue(d.instalado === true);
      sh.getRange(i + 1, 7).setValue(0);
      sh.getRange(i + 1, 8).setValue(true);
      return { ok: true, novo: false };
    }
  }

  sh.appendRow([email, fcm, String(d.plataforma || ''), d.instalado === true,
                agora, '', 0, true]);
  logAction(email, 'PUSH_REGISTRADO', 'push', String(d.plataforma || ''), '');
  return { ok: true, novo: true };
}

function pushRemover(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  var fcm = String((data || {}).fcmToken || '').trim();
  var sh = _puAba_();
  var d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][1]) === fcm) { sh.getRange(i + 1, 8).setValue(false); break; }
  }
  return { ok: true };
}

function _puTokensDe_(email) {
  email = _puNorm_(email);
  var out = [];
  try {
    var sh = _puAba_();
    if (sh.getLastRow() < 2) return out;
    var d = sh.getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      if (_puNorm_(d[i][0]) !== email) continue;
      if (d[i][7] === false) continue;
      out.push({ linha: i + 1, token: String(d[i][1]) });
    }
  } catch (e) {}
  return out;
}

// ─────────────────────────────────────────────────────────────
// ENVIO
// ------------------------------------------------------------
// Mandamos só `data`, sem o bloco `notification`. Com
// `notification` o navegador desenha sozinho e o nosso
// onBackgroundMessage nunca roda — perderíamos agrupamento por
// tag e o clique que foca a aba já aberta.
// ─────────────────────────────────────────────────────────────
function pushEnviar_(email, aviso) {
  if (!pushConfigurado_()) return { ok: false, error: 'push nao configurado' };
  var tokens = _puTokensDe_(email);
  if (!tokens.length) return { ok: false, error: 'sem aparelho' };

  var access = _puAccessToken_();
  if (!access) return { ok: false, error: 'sem credencial' };

  var conta = _puConta_();
  var url = 'https://fcm.googleapis.com/v1/projects/' + conta.project_id + '/messages:send';
  var sh = _puAba_();
  var res = { enviados: 0, falhas: 0, removidos: 0, motivo: '' };

  tokens.forEach(function (t) {
    var corpo = {
      message: {
        token: t.token,
        data: {
          titulo: String(aviso.titulo || 'Desafio 21 Dias'),
          corpo:  String(aviso.corpo || ''),
          url:    String(aviso.url || '/app'),
          grupo:  String(aviso.grupo || 'geral'),
          acao:   String(aviso.acao || '')
        },
        webpush: {
          headers: { Urgency: aviso.urgente ? 'high' : 'normal', TTL: '10800' },
          fcm_options: { link: String(aviso.url || '/app') }
        }
      }
    };

    var r = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + access },
      payload: JSON.stringify(corpo), muteHttpExceptions: true
    });
    var codigo = r.getResponseCode();

    if (codigo === 200) {
      res.enviados++;
      try { sh.getRange(t.linha, 6).setValue(nowISO()); sh.getRange(t.linha, 7).setValue(0); } catch (e) {}
      return;
    }

    res.falhas++;
    if (!res.motivo) {
      var det = '';
      try {
        var j = JSON.parse(r.getContentText());
        det = (j.error && (j.error.message || j.error.status)) || '';
      } catch (e) { det = String(r.getContentText() || '').slice(0, 160); }
      res.motivo = 'HTTP ' + codigo + (det ? ' — ' + det : '');
    }
    // 404 e 403 do FCM significam token morto: app desinstalado ou
    // permissão revogada. Insistir só gasta cota — desativa e segue.
    if (codigo === 404 || codigo === 403) {
      try { sh.getRange(t.linha, 8).setValue(false); } catch (e) {}
      res.removidos++;
    } else {
      try {
        var f = Number(sh.getRange(t.linha, 7).getValue()) || 0;
        sh.getRange(t.linha, 7).setValue(f + 1);
        if (f + 1 >= 5) sh.getRange(t.linha, 8).setValue(false);
      } catch (e) {}
    }
  });

  return { ok: res.enviados > 0, data: res };
}

// ─────────────────────────────────────────────────────────────
// ROTAS DE ADMIN
// ─────────────────────────────────────────────────────────────
function pushStatus(token) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };

  var total = 0, ativos = 0, instalados = 0, porPlataforma = {}, aparelhos = [];
  try {
    var sh = _puAba_();
    if (sh.getLastRow() > 1) {
      var d = sh.getDataRange().getValues();
      for (var i = 1; i < d.length; i++) {
        total++;
        if (d[i][7] !== false) ativos++;
        if (d[i][3] === true) instalados++;
        var p = String(d[i][2] || 'outro');
        porPlataforma[p] = (porPlataforma[p] || 0) + 1;
        aparelhos.push({
          email: _puNorm_(d[i][0]),
          plataforma: p,
          instalado: d[i][3] === true,
          criado: d[i][4] ? String(d[i][4]) : '',
          ultimo: d[i][5] ? String(d[i][5]) : '',
          falhas: Number(d[i][6]) || 0,
          ativo: d[i][7] !== false,
          // Só o fim do token: o suficiente para distinguir dois
          // aparelhos da mesma pessoa, inútil para qualquer outra coisa.
          fim: String(d[i][1] || '').slice(-8)
        });
      }
    }
  } catch (e) {}
  aparelhos.sort(function (a, b) { return String(b.criado).localeCompare(String(a.criado)); });

  var trigger = false;
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'pushRodarAgenda') trigger = true;
    });
  } catch (e) {}

  return { ok: true, data: {
    configurado: pushConfigurado_(),
    vapid: String(getConfig_('push_vapid') || '') ? true : false,
    rotina: trigger,
    total: total, ativos: ativos, instalados: instalados,
    porPlataforma: porPlataforma,
    aparelhos: aparelhos,
    // Para o painel poder avisar quando o e-mail de admin nao tem
    // aparelho — que foi exatamente o que aconteceu no primeiro teste.
    meuEmail: _puNorm_(user.email)
  } };
}

function pushSalvarConfig(token, data) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };
  var d = data || {};

  if (d.serviceAccount) {
    var raw = String(d.serviceAccount).trim();
    try {
      var c = JSON.parse(raw);
      if (!c.client_email || !c.private_key || !c.project_id) {
        return { ok: false, error: 'JSON incompleto: faltam client_email, private_key ou project_id.' };
      }
      // Segredo vai para Script Properties, nunca para a planilha.
      PropertiesService.getScriptProperties().setProperty('FCM_SERVICE_ACCOUNT', raw);
      try { CacheService.getScriptCache().remove('fcm_token'); } catch (e) {}
    } catch (e) {
      return { ok: false, error: 'O conteudo colado nao e um JSON valido.' };
    }
  }

  if (d.vapid !== undefined) setConfig_('push_vapid', String(d.vapid || '').trim());

  logAction(user.email, 'PUSH_CONFIG', 'push', '', d.serviceAccount ? 'conta+vapid' : 'vapid');
  return { ok: true, message: 'Configuracao salva.' };
}

// A chave VAPID é pública por natureza — o app precisa dela no
// navegador para assinar a inscrição. Por isso sai numa rota
// aberta, junto do estado do push.
function getPushPublico(token) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };
  return { ok: true, data: {
    vapid: String(getConfig_('push_vapid') || ''),
    ativo: pushConfigurado_()
  } };
}

function pushTestar(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  // Qualquer um pode testar no proprio aparelho. Mandar para OUTRA
  // pessoa e disparo em nome de terceiro, entao so admin.
  var alvo = _puNorm_((data || {}).email) || _puNorm_(user.email);
  if (alvo !== _puNorm_(user.email) && user.role !== 'admin') {
    return { ok: false, error: 'Sem permissao.' };
  }

  // Erro util em vez de "sem aparelho": diz quantos aparelhos existem e
  // com quais e-mails, para o admin nao ficar adivinhando.
  if (!_puTokensDe_(alvo).length) {
    var donos = {};
    try {
      var sh = _puAba_();
      if (sh.getLastRow() > 1) {
        var d = sh.getDataRange().getValues();
        for (var i = 1; i < d.length; i++) {
          if (d[i][7] === false) continue;
          var e = _puNorm_(d[i][0]);
          if (e) donos[e] = (donos[e] || 0) + 1;
        }
      }
    } catch (e2) {}
    var lista = Object.keys(donos);
    return { ok: false,
      error: lista.length
        ? 'Nenhum aparelho em ' + alvo + '. Ha aparelho(s) registrado(s) em: ' + lista.join(', ')
        : 'Nenhum aparelho registrado ainda. Abra o app, ative as notificacoes e tente de novo.',
      emails: lista };
  }

  var r = pushEnviar_(alvo, {
    titulo: 'Teste do Desafio 21 Dias',
    corpo: 'Se voce esta lendo isso, o push esta funcionando.',
    url: '/app', grupo: 'teste'
  });
  if (!r.ok) {
    return { ok: false, data: r.data,
      error: (r.data && r.data.motivo) ? ('O Firebase recusou: ' + r.data.motivo)
                                       : (r.error || 'Nao consegui enviar.') };
  }
  return { ok: true, data: r.data, email: alvo };
}
