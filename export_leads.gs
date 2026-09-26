// ============================================================
// export_leads.gs — Lista e exportação de leads do trial (v166)
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// Junta num lugar só tudo que se sabe de cada pessoa que entrou
// no funil — com ou sem cartão — para filtrar na tela e baixar
// em CSV/XLSX, pronto para subir numa ferramenta de disparo.
//
// SOBRE O TELEFONE: o cliente pediu o formato sem o dígito 9
// (55 + DDD + 8 dígitos). Exportamos ESSE e também o E.164
// completo, em colunas separadas, porque as duas formas circulam
// e mandar no formato errado é mensagem que não chega. Qual usar
// depende da ferramenta — ter as duas evita refazer a lista.
// ============================================================

function _exNorm_(e) { return String(e || '').toLowerCase().trim(); }
function _exDig_(t)  { return String(t || '').replace(/\D/g, ''); }

// ─────────────────────────────────────────────────────────────
// Telefone
// ------------------------------------------------------------
// Entra qualquer coisa: (94) 99123-4567, +5594991234567, 0055...
// Sai sempre normalizado, em duas colunas.
// ─────────────────────────────────────────────────────────────
function _exTelefone_(bruto) {
  var d = _exDig_(bruto);
  if (!d) return { e164: '', sem9: '', ddd: '', valido: false };

  if (d.indexOf('00') === 0) d = d.slice(2);      // 0055...
  if (d.indexOf('55') !== 0) {
    // Sem código de país: 10 ou 11 dígitos é número brasileiro.
    if (d.length === 10 || d.length === 11) d = '55' + d;
    else return { e164: '', sem9: '', ddd: '', valido: false };
  }

  var ddd = d.slice(2, 4);
  var resto = d.slice(4);

  // Celular com o nono dígito: 9 + 8 dígitos.
  var sem9 = resto;
  if (resto.length === 9 && resto.charAt(0) === '9') sem9 = resto.slice(1);

  // Fixo (8 dígitos começando com 2-5) não recebe WhatsApp.
  var ehCelular = (resto.length === 9 && resto.charAt(0) === '9') ||
                  (resto.length === 8 && '6789'.indexOf(resto.charAt(0)) >= 0);

  return {
    e164: '55' + ddd + resto,
    sem9: '55' + ddd + sem9,
    ddd: ddd,
    valido: ehCelular && ddd.length === 2 && resto.length >= 8
  };
}

// Origem crua vira domínio + caminho legíveis.
// No fluxo sem cartão vem a URL inteira; no com cartão, 'trial-cartao-14d'.
function _exOrigem_(bruto) {
  var s = String(bruto || '').trim();
  if (!s) return { dominio: '', caminho: '', campanha: '', rotulo: '' };

  if (s.indexOf('http') === 0) {
    try {
      var u = s.split('?')[0];
      var semProto = u.replace(/^https?:\/\//, '');
      var barra = semProto.indexOf('/');
      var dominio = barra >= 0 ? semProto.slice(0, barra) : semProto;
      var caminho = barra >= 0 ? semProto.slice(barra) : '/';
      var campanha = '';
      var q = s.split('?')[1] || '';
      q.split('&').forEach(function (par) {
        var kv = par.split('=');
        if (kv[0] === 'utm_campaign') campanha = decodeURIComponent(kv[1] || '');
      });
      return { dominio: dominio, caminho: caminho, campanha: campanha,
               rotulo: dominio + caminho };
    } catch (e) {}
  }
  return { dominio: 'wpktavares.com.br', caminho: '/checkout-trial-cartao/',
           campanha: '', rotulo: s };
}

// Onde a pessoa parou, em português.
function _exEtapa_(estagio, convertido) {
  if (String(convertido).toLowerCase() === 'sim') return 'Convertido';
  var m = {
    'nome':               'Parou no nome',
    'email':              'Parou no e-mail',
    'whatsapp':           'Parou no WhatsApp',
    'beforeunload':       'Saiu antes de enviar',
    'cartao_iniciado':    'Parou na tela do cartao',
    'cartao_confirmado':  'Convertido',
    'cadastrado':         'Cadastrado sem cartao'
  };
  return m[String(estagio)] || (estagio ? String(estagio) : 'Sem etapa');
}

function _exDataHora_(iso) {
  if (!iso) return { data: '', hora: '', iso: '' };
  try {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return { data: '', hora: '', iso: String(iso) };
    return {
      data: Utilities.formatDate(d, 'America/Sao_Paulo', 'dd/MM/yyyy'),
      hora: Utilities.formatDate(d, 'America/Sao_Paulo', 'HH:mm:ss'),
      iso:  d.toISOString()
    };
  } catch (e) { return { data: '', hora: '', iso: String(iso) }; }
}

// ─────────────────────────────────────────────────────────────
// Monta as linhas, cruzando trial_leads com assinaturas,
// compradores e consentimentos.
// ─────────────────────────────────────────────────────────────
function _exMontarLinhas_() {
  var ss = getSpreadsheet_();
  var linhas = [];

  // Índices auxiliares, lidos uma vez só
  var assinaturaPor = {}, acessoPor = {}, consentPor = {};
  try {
    var sa = ss.getSheetByName(SHEET_ASSINATURAS);
    if (sa && sa.getLastRow() > 1) {
      var da = sa.getDataRange().getValues();
      for (var a = 1; a < da.length; a++) {
        assinaturaPor[_exNorm_(da[a][_ASS_.EMAIL])] = {
          status: String(da[a][_ASS_.APP_STATUS] || ''),
          plano:  String(da[a][_ASS_.PLAN] || ''),
          valor:  String(da[a][_ASS_.AMOUNT] || ''),
          proxima: String(da[a][_ASS_.NEXT_BILLING] || '')
        };
      }
    }
  } catch (e) {}

  try {
    var sc = ss.getSheetByName(SHEET_COMPRADORES);
    if (sc && sc.getLastRow() > 1) {
      var dc = sc.getDataRange().getValues();
      var hc = dc[0].map(function (h) { return String(h || ''); });
      var iE = hc.indexOf('Email'), iA = hc.indexOf('Ativo'), iD = hc.indexOf('DiaAtual');
      for (var c = 1; c < dc.length; c++) {
        acessoPor[_exNorm_(dc[c][iE])] = {
          ativo: dc[c][iA] === true,
          dia: iD >= 0 ? (dc[c][iD] || 0) : ''
        };
      }
    }
  } catch (e) {}

  try {
    var sn = ss.getSheetByName('consentimentos');
    if (sn && sn.getLastRow() > 1) {
      var dn = sn.getDataRange().getValues();
      var hn = dn[0].map(function (h) { return String(h || ''); });
      var jE = hn.indexOf('email'), jC = hn.indexOf('campanha'),
          jO = hn.indexOf('origem'), jA = hn.indexOf('aceito_em');
      for (var n = 1; n < dn.length; n++) {
        consentPor[_exNorm_(dn[n][jE])] = {
          campanha: jC >= 0 ? String(dn[n][jC] || '') : '',
          origem:   jO >= 0 ? String(dn[n][jO] || '') : '',
          aceitoEm: jA >= 0 ? String(dn[n][jA] || '') : ''
        };
      }
    }
  } catch (e) {}

  var sl = ss.getSheetByName(SHEET_TRIAL_LEADS);
  if (!sl || sl.getLastRow() < 2) return linhas;

  var dl = sl.getDataRange().getValues();
  var hl = dl[0].map(function (h) { return String(h || ''); });
  var iContato = hl.indexOf('ContatadoEm');

  for (var i = 1; i < dl.length; i++) {
    var email = _exNorm_(dl[i][2]);
    var tel   = _exTelefone_(dl[i][3]);
    if (!email && !tel.valido) continue;

    var convertido = String(dl[i][8] || 'nao').toLowerCase();
    var estagio    = String(dl[i][5] || '');
    var origem     = _exOrigem_(dl[i][6]);
    var criado     = _exDataHora_(dl[i][0]);
    var atualizado = _exDataHora_(dl[i][9]);
    var cons       = consentPor[email] || {};
    var ass        = assinaturaPor[email] || {};
    var acc        = acessoPor[email] || {};
    var comCartao  = String(dl[i][6] || '').indexOf('cartao') >= 0 ||
                     estagio.indexOf('cartao') >= 0;

    linhas.push({
      nome:            String(dl[i][1] || ''),
      email:           email,
      whatsapp_e164:   tel.e164,
      whatsapp_sem9:   tel.sem9,
      ddd:             tel.ddd,
      telefone_valido: tel.valido ? 'sim' : 'nao',
      fluxo:           comCartao ? 'Com cartao' : 'Sem cartao',
      oferta_dias:     dl[i][4] || '',
      etapa:           _exEtapa_(estagio, convertido),
      etapa_bruta:     estagio,
      convertido:      convertido === 'sim' ? 'sim' : 'nao',
      status_lead:     String(dl[i][7] || ''),
      assinatura:      ass.status || '',
      plano:           ass.plano || '',
      valor:           ass.valor || '',
      proxima_cobranca: ass.proxima ? _exDataHora_(ass.proxima).data : '',
      acesso_liberado: acc.ativo === true ? 'sim' : (acc.ativo === false ? 'nao' : ''),
      dia_desafio:     acc.dia === '' ? '' : acc.dia,
      dominio:         origem.dominio,
      caminho:         origem.caminho,
      origem_bruta:    String(dl[i][6] || ''),
      campanha:        origem.campanha || cons.campanha || '',
      consentimento:   cons.aceitoEm ? _exDataHora_(cons.aceitoEm).data : '',
      contatado_whats: (iContato >= 0 && dl[i][iContato]) ? 'sim' : 'nao',
      criado_data:     criado.data,
      criado_hora:     criado.hora,
      criado_iso:      criado.iso,
      atualizado_data: atualizado.data,
      atualizado_hora: atualizado.hora
    });
  }

  // Mais recentes primeiro
  linhas.sort(function (a, b) { return String(b.criado_iso).localeCompare(String(a.criado_iso)); });
  return linhas;
}

// Ordem e rótulo das colunas na planilha exportada.
var EX_COLUNAS = [
  ['nome', 'Nome'], ['email', 'E-mail'],
  ['whatsapp_sem9', 'WhatsApp (sem 9)'], ['whatsapp_e164', 'WhatsApp (E.164)'],
  ['ddd', 'DDD'], ['telefone_valido', 'Telefone valido'],
  ['fluxo', 'Fluxo'], ['oferta_dias', 'Dias ofertados'],
  ['etapa', 'Onde parou'], ['etapa_bruta', 'Etapa (bruta)'],
  ['convertido', 'Convertido'], ['status_lead', 'Status do lead'],
  ['assinatura', 'Assinatura'], ['plano', 'Plano'], ['valor', 'Valor'],
  ['proxima_cobranca', 'Proxima cobranca'],
  ['acesso_liberado', 'Acesso liberado'], ['dia_desafio', 'Dia do desafio'],
  ['dominio', 'Dominio'], ['caminho', 'Caminho'], ['origem_bruta', 'Origem (bruta)'],
  ['campanha', 'Campanha'], ['consentimento', 'Consentimento em'],
  ['contatado_whats', 'Ja contatado'],
  ['criado_data', 'Data'], ['criado_hora', 'Hora'],
  ['atualizado_data', 'Atualizado em'], ['atualizado_hora', 'Atualizado hora']
];

function _exFiltrar_(linhas, f) {
  f = f || {};
  var busca = _exNorm_(f.busca);
  return linhas.filter(function (l) {
    if (f.fluxo && f.fluxo !== 'todos') {
      var querCartao = f.fluxo === 'cartao';
      if ((l.fluxo === 'Com cartao') !== querCartao) return false;
    }
    if (f.convertido && f.convertido !== 'todos' && l.convertido !== f.convertido) return false;
    if (f.etapa && f.etapa !== 'todas' && l.etapa_bruta !== f.etapa) return false;
    if (f.soValidos && l.telefone_valido !== 'sim') return false;
    if (f.naoContatados && l.contatado_whats !== 'nao') return false;
    if (f.desde && String(l.criado_iso).slice(0, 10) < String(f.desde)) return false;
    if (f.ate   && String(l.criado_iso).slice(0, 10) > String(f.ate))   return false;
    if (busca) {
      var alvo = (l.nome + ' ' + l.email + ' ' + l.whatsapp_e164 + ' ' + l.campanha).toLowerCase();
      if (alvo.indexOf(busca) < 0) return false;
    }
    return true;
  });
}

// ─────────────────────────────────────────────────────────────
// ROTA ADMIN: getLeadsExport — alimenta a tela
// ─────────────────────────────────────────────────────────────
function getLeadsExport(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  try {
    var todas = _exMontarLinhas_();
    var filtradas = _exFiltrar_(todas, data || {});

    var resumo = { total: todas.length, filtrados: filtradas.length,
                   convertidos: 0, comCartao: 0, semCartao: 0,
                   telefonesValidos: 0, naoContatados: 0 };
    filtradas.forEach(function (l) {
      if (l.convertido === 'sim') resumo.convertidos++;
      if (l.fluxo === 'Com cartao') resumo.comCartao++; else resumo.semCartao++;
      if (l.telefone_valido === 'sim') resumo.telefonesValidos++;
      if (l.contatado_whats === 'nao') resumo.naoContatados++;
    });

    // Etapas presentes, para montar o filtro sem chutar valores
    var etapas = {};
    todas.forEach(function (l) { if (l.etapa_bruta) etapas[l.etapa_bruta] = _exEtapa_(l.etapa_bruta, l.convertido); });

    return { ok: true, data: {
      resumo: resumo,
      colunas: EX_COLUNAS,
      etapas: Object.keys(etapas).map(function (k) { return { valor: k, rotulo: etapas[k] }; }),
      // A tela mostra uma prévia; o arquivo leva tudo.
      linhas: filtradas.slice(0, 400)
    } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
// ROTA ADMIN: baixarLeadsExport — devolve o arquivo em base64
//
// XLSX de verdade: escrevemos numa planilha temporária, pegamos
// os bytes pelo export do Drive e jogamos a planilha fora. Não
// fica lixo na conta, e o arquivo abre no Excel sem conversão.
// ─────────────────────────────────────────────────────────────
function baixarLeadsExport(token, data) {
  var user = getUserByToken(token);
  if (!user) return { ok: false, error: 'Não autorizado.' };

  var d = data || {};
  var formato = String(d.formato || 'csv').toLowerCase();

  try {
    var linhas = _exFiltrar_(_exMontarLinhas_(), d);
    if (!linhas.length) return { ok: false, error: 'Nenhum lead com esses filtros.' };

    var cabecalho = EX_COLUNAS.map(function (c) { return c[1]; });
    var matriz = [cabecalho].concat(linhas.map(function (l) {
      return EX_COLUNAS.map(function (c) {
        var v = l[c[0]];
        return (v === null || v === undefined) ? '' : v;
      });
    }));

    var nome = 'leads-desafio21-' +
      Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd-HHmm');

    if (formato === 'xlsx') {
      var ss = SpreadsheetApp.create(nome);
      var id = ss.getId();
      try {
        var aba = ss.getSheets()[0];
        aba.setName('Leads');
        aba.getRange(1, 1, matriz.length, cabecalho.length).setValues(matriz);
        aba.getRange(1, 1, 1, cabecalho.length).setFontWeight('bold');
        SpreadsheetApp.flush();

        var url = 'https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx';
        var resp = UrlFetchApp.fetch(url, {
          headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
          muteHttpExceptions: true
        });
        if (resp.getResponseCode() !== 200) throw new Error('Falha ao gerar o XLSX.');
        var b64 = Utilities.base64Encode(resp.getBlob().getBytes());

        logAction(user.email, 'EXPORT_LEADS', 'export', 'xlsx', String(linhas.length));
        return { ok: true, formato: 'xlsx', nome: nome + '.xlsx',
                 linhas: linhas.length, base64: b64,
                 mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
      } finally {
        // Some com a planilha temporária mesmo se o export falhar.
        try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {}
      }
    }

    // CSV com ponto-e-vírgula: é o que o Excel em português abre em colunas
    // sem pedir importação. E BOM na frente, senão acento vira símbolo.
    var csv = matriz.map(function (linha) {
      return linha.map(function (v) {
        var s = String(v);
        return (s.indexOf(';') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0)
          ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(';');
    }).join('\r\n');

    logAction(user.email, 'EXPORT_LEADS', 'export', 'csv', String(linhas.length));
    return { ok: true, formato: 'csv', nome: nome + '.csv', linhas: linhas.length,
             base64: Utilities.base64Encode('﻿' + csv, Utilities.Charset.UTF_8),
             mime: 'text/csv;charset=utf-8' };

  } catch (e) {
    return { ok: false, error: e.message };
  }
}
