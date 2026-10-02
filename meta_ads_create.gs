// ============================================================
// meta_ads_create.gs — Criacao de campanha + ad set + ad + criativos
// Complementa metaApi.gs (que so faz leitura/insights)
// Token persistido em `aba config` (chave `meta_access_token`)
// Ad account id em `aba config` (chave `meta_ad_account_id`)
// ============================================================

const SHEET_CRIATIVOS = 'criativos';
const CRIATIVO_HEADERS = [
  'id',              // A — unico (timestamp + random)
  'nome',            // B
  'formato',         // C — imagem | video | carrossel
  'gancho',          // D — dor | curiosidade | oferta | depoimento | provocacao | capacitante | historia | reframe
  'copy_principal',  // E — texto principal do anuncio
  'headline',        // F
  'cta',             // G — LEARN_MORE | SIGN_UP | INSTALL_NOW | SHOP_NOW | CONTACT_US | ...
  'asset_url',       // H — URL publica (https://...) ou Drive
  'asset_drive_id',  // I — opcional: id do Google Drive ja enviado
  'status',          // J — rascunho | ativo | pausado | arquivado
  'origem',          // K — novo | reciclado
  'origem_ad_id',    // L — id do anuncio no Meta Ads (reciclado)
  'criado_em',       // M
  'atualizado_por',  // N
  'campanha_meta_id',// O — preenchido depois de criar campanha
  'adset_meta_id',   // P
  'ad_meta_id',      // Q
  'adcreative_meta_id',// R
  'image_hash',      // S — preenchido apos upload de imagem
  'metricas_historico' // T — JSON: {ctr, cpa, gasto, leads} p/ reciclados
];

const CRIATIVO_GANCHOS_VALIDOS = ['dor', 'curiosidade', 'oferta', 'depoimento', 'provocacao', 'capacitante', 'historia', 'reframe'];
const CRIATIVO_FORMATOS_VALIDOS = ['imagem', 'video', 'carrossel'];
const CRIATIVO_CTAS_VALIDOS = ['LEARN_MORE', 'SIGN_UP', 'INSTALL_NOW', 'SHOP_NOW', 'CONTACT_US', 'SUBSCRIBE', 'GET_OFFER', 'BOOK_TRAVEL', 'GET_QUOTE'];

// Page Wagner Tavares (obrigatoria p/ ads com link para pagina Facebook)
const META_PAGE_ID = '2295179894146183';

// Landing page padrao (clica no anuncio vai pra ca)
const META_DEFAULT_LP = 'https://wpktavares.com.br/21-dias/';

// ══════════════════════════════════════════════════════════════
// SETUP / VALIDACAO
// ══════════════════════════════════════════════════════════════

// Salva token (validado) na aba config. Use apos validarMetaToken().
function setupMetaToken_(token, accountId) {
  if (!token || !accountId) return { ok: false, error: 'Token e Account ID obrigatorios.' };
  setConfig_('meta_access_token', token);
  setConfig_('meta_ad_account_id', String(accountId).replace(/^act_/, ''));
  return { ok: true, message: 'Credenciais salvas.' };
}

// Confere escopos + ident do usuario + acesso a ad account.
// NAO salva nada — devolve informacoes para o admin decidir.
function validarMetaToken(token, accountId) {
  if (!token) return { ok: false, error: 'Token nao fornecido.' };

  function call(method, path, params) {
    params = Object.assign({}, params || {}, { access_token: token });
    const qs = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
    const url = META_API_BASE + path + (path.indexOf('?') >= 0 ? '&' : '?') + qs;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    return { code: resp.getResponseCode(), body: JSON.parse(resp.getContentText()) };
  }

  try {
    // 1) escopos
    const perms = call('GET', '/me/permissions', {});
    if (perms.code !== 200) return { ok: false, error: 'Erro ao consultar permissions: ' + (perms.body.error && perms.body.error.message || perms.code) };
    const granted = (perms.body.data || []).filter(p => p.status === 'granted').map(p => p.permission);

    const REQUIRED = ['ads_management', 'business_management', 'pages_show_list'];
    const missing = REQUIRED.filter(r => granted.indexOf(r) === -1);
    if (missing.length > 0) {
      return { ok: false, error: 'Escopos faltando: ' + missing.join(', '), granted: granted };
    }

    // 2) identifica usuario
    const me = call('GET', '/me', { fields: 'id,name' });
    if (me.code !== 200) return { ok: false, error: 'Erro ao consultar /me: ' + (me.body.error && me.body.error.message || me.code), granted: granted };
    const ownerId   = String(me.body.id);
    const ownerName = me.body.name;

    // 3) valida acesso a ad account (se informado)
    let account = null;
    if (accountId) {
      const cleanId = String(accountId).replace(/^act_/, '');
      const acc = call('GET', '/act_' + cleanId, { fields: 'id,name,account_status,currency,timezone_name' });
      if (acc.code === 200) {
        account = acc.body;
      } else {
        return {
          ok: false,
          error: 'Token valido mas NAO tem acesso a ad account ' + accountId + ': ' + (acc.body.error && acc.body.error.message || acc.code),
          granted: granted,
          owner: { id: ownerId, name: ownerName }
        };
      }
    }

    return {
      ok: true,
      granted: granted,
      owner: { id: ownerId, name: ownerName },
      account: account,
      message: account
        ? 'Token OK. Acesso confirmado a ad account "' + account.name + '".'
        : 'Token OK. 9 escopos confirmados (forneca um account_id para validar acesso).'
    };
  } catch (err) {
    return { ok: false, error: 'Excecao: ' + err.message };
  }
}

// Helpers compartilhados
function _metaCreds_() {
  const token    = getConfig_('meta_access_token');
  const account  = getConfig_('meta_ad_account_id');
  if (!token)    return { error: 'Token Meta nao configurado (chame setupMetaToken_).' };
  if (!account)  return { error: 'Ad Account ID nao configurado.' };
  return {
    token: token,
    actId: String(account).replace(/^act_/, ''),
    account: account
  };
}

// POST application/x-www-form-urlencoded (padrao Marketing API p/ POST)
function _metaPost_(path, params, creds) {
  const qs = Object.keys(params || {}).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  const url = META_API_BASE + path + '&access_token=' + creds.token;
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    payload: qs,
    contentType: 'application/x-www-form-urlencoded',
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  const body = JSON.parse(resp.getContentText());
  return { code, body };
}

// ══════════════════════════════════════════════════════════════
// UPLOAD DE IMAGEM (multipart/form-data)
// ══════════════════════════════════════════════════════════════

// Upload de imagem para Meta Ad Image Library
// fileBase64: string base64 pura (sem prefixo "data:image/...")
function uploadAdImage(token, fileBase64, nome) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };

  const creds = _metaCreds_();
  if (creds.error) return { ok: false, error: creds.error };

  if (!fileBase64) return { ok: false, error: 'fileBase64 obrigatorio.' };
  if (!nome) nome = 'wpc_creative_' + Date.now();

  try {
    const blob = Utilities.newBlob(Utilities.base64Decode(fileBase64), 'image/png', nome);
    const boundary = '------FormBoundary' + Utilities.getUuid();
    const headers = { 'Content-Type': 'multipart/form-data; boundary=' + boundary };

    const payload =
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="filename"\r\n\r\n' + nome + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="access_token"\r\n\r\n' + creds.token + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="image"; filename="' + nome + '.png"\r\n' +
      'Content-Type: image/png\r\n\r\n' +
      Utilities.base64Decode(fileBase64) + '\r\n' +
      '--' + boundary + '--';

    // Nota: Utilities.base64Decode retorna bytes, mas o multipart espera string na composicao.
    // Solucao robusta: usar blob.toBytes().
    const blobBody = Utilities.newBlob(
      [
        '--' + boundary + '\r\n',
        'Content-Disposition: form-data; name="filename"\r\n\r\n', nome, '\r\n',
        '--' + boundary + '\r\n',
        'Content-Disposition: form-data; name="access_token"\r\n\r\n', creds.token, '\r\n',
        '--' + boundary + '\r\n',
        'Content-Disposition: form-data; name="image"; filename="', nome, '.png"\r\n',
        'Content-Type: image/png\r\n\r\n'
      ].join('') + '\r\n',
      'multipart/form-data; boundary=' + boundary
    );

    // Acrescenta os bytes do PNG
    const fullBody = blobBody.getBytes().concat(blob.getBytes()).concat(Utilities.newBlob('\r\n--' + boundary + '--', 'text/plain').getBytes());

    const url = META_API_BASE + '/act_' + creds.actId + '/adimages';
    const resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: headers['Content-Type'],
      payload: fullBody,
      muteHttpExceptions: true
    });
    const code = resp.getResponseCode();
    const body = JSON.parse(resp.getContentText());

    if (code === 200 && body.images) {
      const firstKey = Object.keys(body.images)[0];
      const hash = body.images[firstKey].hash;
      const urlImg = body.images[firstKey].url;
      logAction(user.email, 'META_IMAGE_UPLOAD', 'meta', nome, 'hash=' + hash);
      return { ok: true, hash: hash, url: urlImg, nome: nome, account_id: creds.actId };
    }
    logAction(user.email, 'META_IMAGE_UPLOAD_FAIL', 'meta', nome, (body.error && body.error.message) || ('HTTP ' + code));
    return { ok: false, error: (body.error && body.error.message) || ('HTTP ' + code), details: body };
  } catch (err) {
    logAction(user.email, 'META_IMAGE_UPLOAD_ERR', 'meta', nome, err.message);
    return { ok: false, error: err.message };
  }
}

// ══════════════════════════════════════════════════════════════
// CAMPANHA / AD SET / AD CREATIVE / AD
// ══════════════════════════════════════════════════════════════

// Cria campanha (objective OUTCOME_LEADS, status PAUSED por padrao).
// opts: { name, dailyBudgetBRL, objective? }
function criarCampanhaMeta(token, opts) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };

  const creds = _metaCreds_();
  if (creds.error) return { ok: false, error: creds.error };

  const name = (opts && opts.name) || ('WPK Tavares - Leads - ' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm'));
  const dailyBudgetCents = Math.round(((opts && opts.dailyBudgetBRL) || 50) * 100); // padrao R$50/dia

  try {
    const result = _metaPost_('/act_' + creds.actId + '/campaigns', {
      name: name,
      objective: (opts && opts.objective) || 'OUTCOME_LEADS',
      status: 'PAUSED',
      special_ad_categories: '[]',
      daily_budget: dailyBudgetCents
    }, creds);

    if (result.code === 200 && result.body.id) {
      logAction(user.email, 'META_CAMPANHA_CRIADA', 'meta', result.body.id, name);
      return { ok: true, campaign_id: result.body.id, name: name, daily_budget: dailyBudgetCents };
    }
    logAction(user.email, 'META_CAMPANHA_ERRO', 'meta', name, (result.body.error && result.body.error.message) || ('HTTP ' + result.code));
    return { ok: false, error: (result.body.error && result.body.error.message) || ('HTTP ' + result.code), details: result.body };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Cria ad set dentro de uma campanha.
// opts: { campaign_id, name?, dailyBudgetBRL?, geo?, minAge?, maxAge?, optimization? }
function criarAdSetMeta(token, opts) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };

  const creds = _metaCreds_();
  if (creds.error) return { ok: false, error: creds.error };

  if (!opts || !opts.campaign_id) return { ok: false, error: 'campaign_id obrigatorio.' };

  const name = opts.name || ('AdSet - ' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm'));
  const dailyBudgetCents = Math.round(((opts.dailyBudgetBRL) || 50) * 100);
  const geo = (opts.geo && opts.geo.length > 0) ? opts.geo : ['BR'];
  const minAge = opts.minAge || 18;
  const maxAge = opts.maxAge || 65;

  try {
    const result = _metaPost_('/act_' + creds.actId + '/adsets', {
      name: name,
      campaign_id: opts.campaign_id,
      daily_budget: dailyBudgetCents,
      billing_event: 'IMPRESSIONS',
      optimization_goal: (opts.optimization) || 'LEAD',
      bid_amount: '0',
      targeting: JSON.stringify({
        geo_locations: { countries: geo },
        age_min: minAge,
        age_max: maxAge,
        publisher_platforms: ['facebook', 'instagram']
      }),
      status: 'PAUSED',
      promoted_object: JSON.stringify({
        page_id: META_PAGE_ID
      })
    }, creds);

    if (result.code === 200 && result.body.id) {
      logAction(user.email, 'META_ADSET_CRIADO', 'meta', result.body.id, name + ' -> ' + opts.campaign_id);
      return { ok: true, adset_id: result.body.id, name: name };
    }
    logAction(user.email, 'META_ADSET_ERRO', 'meta', opts.campaign_id, (result.body.error && result.body.error.message) || ('HTTP ' + result.code));
    return { ok: false, error: (result.body.error && result.body.error.message) || ('HTTP ' + result.code), details: result.body };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Cria ad creative (vincula imagem+copy+CTA ao Facebook Page).
// opts: { name, imageHash, message, headline, cta?, link?, pageId?, description? }
function criarAdCreativeMeta(token, opts) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };

  const creds = _metaCreds_();
  if (creds.error) return { ok: false, error: creds.error };

  if (!opts || !opts.imageHash || !opts.message) return { ok: false, error: 'imageHash e message obrigatorios.' };

  const name = opts.name || ('Creative ' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm'));
  const cta     = (opts.cta && CRIATIVO_CTAS_VALIDOS.indexOf(opts.cta) >= 0) ? opts.cta : 'LEARN_MORE';
  const link    = opts.link || META_DEFAULT_LP;
  const pageId  = opts.pageId || META_PAGE_ID;
  const headline = opts.headline || 'Desafio 21 Dias';
  const description = opts.description || '';

  try {
    const result = _metaPost_('/act_' + creds.actId + '/adcreatives', {
      name: name,
      object_story_spec: JSON.stringify({
        page_id: pageId,
        link_data: {
          link: link,
          message: opts.message,
          name: headline,
          description: description,
          image_hash: opts.imageHash,
          call_to_action: {
            type: cta,
            value: { link: link }
          }
        }
      })
    }, creds);

    if (result.code === 200 && result.body.id) {
      logAction(user.email, 'META_CREATIVE_CRIADO', 'meta', result.body.id, name);
      return { ok: true, creative_id: result.body.id, name: name };
    }
    logAction(user.email, 'META_CREATIVE_ERRO', 'meta', name, (result.body.error && result.body.error.message) || ('HTTP ' + result.code));
    return { ok: false, error: (result.body.error && result.body.error.message) || ('HTTP ' + result.code), details: result.body };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Cria ad (creative + ad set), status PAUSED por padrao.
// opts: { adsetId, creativeId, name? }
function criarAdMeta(token, opts) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };

  const creds = _metaCreds_();
  if (creds.error) return { ok: false, error: creds.error };

  if (!opts || !opts.adsetId || !opts.creativeId) return { ok: false, error: 'adsetId e creativeId obrigatorios.' };

  const name = opts.name || ('Ad ' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm'));

  try {
    const result = _metaPost_('/act_' + creds.actId + '/ads', {
      name: name,
      adset_id: opts.adsetId,
      creative: JSON.stringify({ creative_id: opts.creativeId }),
      status: 'PAUSED'
    }, creds);

    if (result.code === 200 && result.body.id) {
      logAction(user.email, 'META_AD_CRIADO', 'meta', result.body.id, name + ' -> ' + opts.adsetId);
      return { ok: true, ad_id: result.body.id, name: name };
    }
    logAction(user.email, 'META_AD_ERRO', 'meta', opts.adsetId, (result.body.error && result.body.error.message) || ('HTTP ' + result.code));
    return { ok: false, error: (result.body.error && result.body.error.message) || ('HTTP ' + result.code), details: result.body };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Ativa (ou pausa) um ad. Use apos validar tudo no Ads Manager.
function setAdStatusMeta(token, adId, status) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };
  const creds = _metaCreds_();
  if (creds.error) return { ok: false, error: creds.error };
  const sts = ['ACTIVE', 'PAUSED', 'ARCHIVED'].indexOf(String(status).toUpperCase()) >= 0 ? String(status).toUpperCase() : 'PAUSED';
  const r = _metaPost_('/' + adId, { status: sts }, creds);
  if (r.code === 200 && r.body.success) return { ok: true, ad_id: adId, status: sts };
  return { ok: false, error: (r.body.error && r.body.error.message) || ('HTTP ' + r.code) };
}

// Orquestra o fluxo completo (1 chamada por criativo no frontend).
// Cria campanha + ad set + creative + ad. Retorna IDs do Meta p/ log.
// criativos: array de { criativoId (linha da aba criativos), imageHash, message, headline, cta?, link? }
//            se imageHash estiver vazio, tenta usar asset_url -> upload automatico.
function criarCampanhaCompletaMeta(token, opts) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };

  if (!opts || !opts.criativos || opts.criativos.length === 0) return { ok: false, error: 'Nenhum criativo enviado.' };

  const creds = _metaCreds_();
  if (creds.error) return { ok: false, error: creds.error };

  try {
    // 1) campanha (1 so)
    const camp = criarCampanhaMeta(token, {
      name: opts.name || ('WPK Tavares - ' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm')),
      dailyBudgetBRL: opts.dailyBudgetBRL || 50,
      objective: 'OUTCOME_LEADS'
    });
    if (!camp.ok) return { ok: false, error: 'Erro na campanha: ' + camp.error, step: 'campanha' };

    // 2) ad set (1 so, multi-ad)
    const adset = criarAdSetMeta(token, {
      campaign_id: camp.campaign_id,
      name: 'AdSet ' + camp.campaign_id,
      dailyBudgetBRL: opts.dailyBudgetBRL || 50
    });
    if (!adset.ok) return { ok: false, error: 'Erro no ad set: ' + adset.error, step: 'adset', campaign_id: camp.campaign_id };

    // 3) para cada criativo: creative + ad
    const ads = [];
    for (const c of opts.criativos) {
      let imageHash = c.imageHash;
      // Se asset_url mas sem hash, faz upload (a partir de URL publica)
      if (!imageHash && c.asset_url && /^https?:\/\//.test(c.asset_url)) {
        const up = _metaUploadFromUrl_(creds, c.asset_url, c.nome || 'criativo');
        if (up.ok) imageHash = up.hash;
      }
      if (!imageHash) {
        ads.push({ criativo_id: c.criativoId, ok: false, error: 'Sem imageHash e asset_url invalida.' });
        continue;
      }

      const creative = criarAdCreativeMeta(token, {
        name: 'Creative - ' + (c.nome || c.criativoId),
        imageHash: imageHash,
        message: c.message,
        headline: c.headline || 'Desafio 21 Dias',
        cta: c.cta || 'LEARN_MORE',
        link: c.link || META_DEFAULT_LP
      });
      if (!creative.ok) {
        ads.push({ criativo_id: c.criativoId, ok: false, error: 'Creative falhou: ' + creative.error });
        continue;
      }

      const ad = criarAdMeta(token, {
        adsetId: adset.adset_id,
        creativeId: creative.creative_id,
        name: 'Ad - ' + (c.nome || c.criativoId)
      });
      ads.push({
        criativo_id: c.criativoId,
        ok: ad.ok,
        ad_id: ad.ad_id,
        creative_id: creative.creative_id,
        error: ad.ok ? null : ad.error
      });

      // Atualiza aba criativos com IDs retornados
      if (ad.ok) {
        _updateCriativoMetaIds_(c.criativoId, {
          campanha_meta_id: camp.campaign_id,
          adset_meta_id: adset.adset_id,
          ad_meta_id: ad.ad_id,
          adcreative_meta_id: creative.creative_id,
          image_hash: imageHash,
          status: 'pausado'
        }, user.email);
      }
    }

    logAction(user.email, 'META_CAMPANHA_COMPLETA', 'meta', camp.campaign_id, 'criativos=' + opts.criativos.length);
    return {
      ok: true,
      campaign_id: camp.campaign_id,
      adset_id: adset.adset_id,
      ads: ads,
      message: 'Campanha criada em PAUSED. Ative manualmente no Ads Manager.'
    };
  } catch (err) {
    logAction(user.email, 'META_CAMPANHA_ERR', 'meta', '', err.message);
    return { ok: false, error: err.message };
  }
}

// Upload de imagem a partir de URL publica
function _metaUploadFromUrl_(creds, url, nome) {
  try {
    const r = _metaPost_('/act_' + creds.actId + '/adimages', {
      url: url,
      filename: (nome || 'criativo') + Date.now()
    }, creds);
    if (r.code === 200 && r.body.images) {
      const firstKey = Object.keys(r.body.images)[0];
      return { ok: true, hash: r.body.images[firstKey].hash, url: r.body.images[firstKey].url };
    }
    return { ok: false, error: (r.body.error && r.body.error.message) || ('HTTP ' + r.code) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ══════════════════════════════════════════════════════════════
// ABA CRIATIVOS — CRUD
// ══════════════════════════════════════════════════════════════

function initCriativosSheet_() {
  const ss = getSpreadsheet_();
  let aba = ss.getSheetByName(SHEET_CRIATIVOS);
  if (!aba) {
    aba = ss.insertSheet(SHEET_CRIATIVOS);
    aba.appendRow(CRIATIVO_HEADERS);
    aba.getRange(1, 1, 1, CRIATIVO_HEADERS.length)
      .setFontWeight('bold').setBackground('#4caf50').setFontColor('#ffffff');
    aba.setFrozenRows(1);
    // Auto-largura minima
    for (let i = 1; i <= CRIATIVO_HEADERS.length; i++) {
      aba.setColumnWidth(i, 180);
    }
  }
  return aba;
}

function listarCriativos(token) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };
  try {
    const aba = initCriativosSheet_();
    const data = aba.getDataRange().getValues();
    const items = [];
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      const row = {};
      for (let j = 0; j < CRIATIVO_HEADERS.length; j++) {
        row[CRIATIVO_HEADERS[j]] = data[i][j];
      }
      items.push(row);
    }
    return { ok: true, items: items };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function salvarCriativo(token, payload) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };
  if (!payload || !payload.nome) return { ok: false, error: 'Nome obrigatorio.' };
  const formato = (payload.formato || 'imagem').toLowerCase();
  const gancho = (payload.gancho || 'curiosidade').toLowerCase();
  if (CRIATIVO_FORMATOS_VALIDOS.indexOf(formato) < 0) return { ok: false, error: 'Formato invalido.' };
  if (CRIATIVO_GANCHOS_VALIDOS.indexOf(gancho) < 0) return { ok: false, error: 'Gancho invalido.' };
  try {
    const aba = initCriativosSheet_();
    const id = 'cr_' + Utilities.getUuid().slice(0, 8);
    const agora = nowISO();
    aba.appendRow([
      id,
      payload.nome,
      formato,
      gancho,
      payload.copy_principal || '',
      payload.headline || 'Desafio 21 Dias',
      payload.cta || 'LEARN_MORE',
      payload.asset_url || '',
      payload.asset_drive_id || '',
      'rascunho',
      payload.origem || 'novo',
      payload.origem_ad_id || '',
      agora,
      user.email,
      '', '', '', '', '', ''
    ]);
    logAction(user.email, 'CRIATIVO_SALVO', 'criativos', id, payload.nome);
    return { ok: true, id: id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Atualiza colunas de IDs do Meta apos criarCampanhaCompleta
function _updateCriativoMetaIds_(criativoId, ids, userEmail) {
  try {
    const aba = initCriativosSheet_();
    const data = aba.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(criativoId)) {
        if (ids.campanha_meta_id)    aba.getRange(i + 1, 15).setValue(ids.campanha_meta_id);
        if (ids.adset_meta_id)       aba.getRange(i + 1, 16).setValue(ids.adset_meta_id);
        if (ids.ad_meta_id)          aba.getRange(i + 1, 17).setValue(ids.ad_meta_id);
        if (ids.adcreative_meta_id)  aba.getRange(i + 1, 18).setValue(ids.adcreative_meta_id);
        if (ids.image_hash)          aba.getRange(i + 1, 19).setValue(ids.image_hash);
        if (ids.status)              aba.getRange(i + 1, 10).setValue(ids.status);
        aba.getRange(i + 1, 20).setValue(nowISO());
        return;
      }
    }
  } catch (e) {}
}

// Atualiza status (rascunho/ativo/pausado/arquivado) manualmente via UI
function setCriativoStatus(token, criativoId, status) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };
  try {
    const aba = initCriativosSheet_();
    const data = aba.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(criativoId)) {
        aba.getRange(i + 1, 10).setValue(status);
        aba.getRange(i + 1, 20).setValue(nowISO());
        return { ok: true };
      }
    }
    return { ok: false, error: 'Criativo nao encontrado.' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Endpoint de convenience para UI - retorna resumo de insights dos top 5 ads
// ATENCAO: este endpoint PULA a checagem de token (ja viu admin no caller) — mas
// exige role admin. Como roda via app.html, recebe o token do usuario logado.
function getTopCriativosHistoricos(token) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };

  // Reaproveita leitura do sheet trafego (ja populado pelo sync)
  try {
    const aba = SpreadsheetApp.getActive().getSheetByName('trafego');
    if (!aba) return { ok: false, error: 'Aba trafego nao existe. Rode sync primeiro.' };
    const data = aba.getDataRange().getValues();
    const map = {}; // anuncio_nome -> { gasto, leads, ctr, cpa }
    for (let i = 1; i < data.length; i++) {
      const nome = data[i][3];
      const gasto = Number(data[i][4]) || 0;
      const impr  = Number(data[i][6]) || 0;
      const ctr   = Number(data[i][13]) || 0;  // %
      const leads = Number(data[i][15]) || 0;
      const cpa   = Number(data[i][16]) || 0;
      if (!nome || gasto < 30 || impr < 500) continue;
      if (!map[nome]) map[nome] = { nome: nome, gasto: 0, leads: 0, impr: 0, ctrs: [], cpas: [] };
      map[nome].gasto += gasto;
      map[nome].leads += leads;
      map[nome].impr  += impr;
      if (ctr)   map[nome].ctrs.push(ctr);
      if (cpa)   map[nome].cpas.push(cpa);
    }
    const items = Object.values(map).map(m => ({
      nome: m.nome,
      gasto: m.gasto,
      leads: m.leads,
      ctr: m.ctrs.length ? m.ctrs.reduce((a,b)=>a+b,0)/m.ctrs.length : 0,
      cpa: m.cpas.length ? m.cpas.reduce((a,b)=>a+b,0)/m.cpas.length : (m.leads > 0 ? m.gasto / m.leads : 0),
      score: (m.ctrs.length ? m.ctrs.reduce((a,b)=>a+b,0)/m.ctrs.length : 0) * 10 + (m.leads > 0 ? 30 - m.gasto / m.leads : 0) * 2
    }));
    items.sort((a, b) => b.score - a.score);
    return { ok: true, items: items.slice(0, 10) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Mover criativo para a aba a partir de um topAd (reciclar)
function criarCriativoReciclado(token, topAdNome) {
  const user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };
  if (!topAdNome) return { ok: false, error: 'topAdNome obrigatorio.' };

  const top = getTopCriativosHistoricos(token);
  if (!top.ok || !top.items) return { ok: false, error: 'Sem dados de trafego.' };
  const found = top.items.find(t => t.nome === topAdNome);
  if (!found) return { ok: false, error: 'Ad nao encontrado no top.' };

  // Heuristica de gancho a partir do nome
  const nome = String(found.nome).toLowerCase();
  let gancho = 'curiosidade';
  if (nome.indexOf('goggins') >= 0)               gancho = 'historia';
  else if (nome.indexOf('vsl') >= 0)              gancho = 'historia';
  else if (nome.indexOf('pode mudar') >= 0)       gancho = 'capacitante';
  else if (nome.indexOf('p*rra') >= 0)            gancho = 'provocacao';
  else if (nome.match(/^\s*ad\s*\d+\s*$/i))       gancho = 'curiosidade';

  return salvarCriativo(token, {
    nome: '[RECICLADO] ' + found.nome,
    formato: 'imagem',
    gancho: gancho,
    copy_principal: '(copie do Ad original — ver Ads Manager)',
    headline: 'Desafio 21 Dias',
    cta: 'LEARN_MORE',
    asset_url: '',
    origem: 'reciclado',
    origem_ad_id: found.nome
  });
}