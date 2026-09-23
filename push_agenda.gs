// ============================================================
// push_agenda.gs — O coach do dia — v167
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// Roda a cada 15 minutos e decide, para cada aluno, se existe
// algo que valha um toque no ombro AGORA.
//
// TRÊS REGRAS QUE VALEM MAIS QUE QUALQUER MENSAGEM:
//
// 1. Nunca lembrar do que já foi feito. Cobrar meditação de quem
//    meditou às 6h é o jeito mais rápido de a pessoa desligar
//    tudo — e quem desliga não volta a ligar.
//
// 2. Teto diário. O cliente pediu insistência; insistência sem
//    teto vira desinstalação. O padrão é 5 avisos, ajustável.
//
// 3. Silêncio noturno. Fora da janela do aluno, nada sai —
//    exceto o próprio aviso de dormir, que É a janela da noite.
//
// O horário de cada pessoa manda. Quem acorda às 5h recebe às
// 5h; quem acorda às 8h não é acordado às 5h por causa dela.
// ============================================================

var PA_TZ = 'America/Sao_Paulo';

var PA_PADRAO = {
  acordar:   '05:30',
  dormir:    '21:30',
  tetoDia:   5,
  aguaMetaMl: 2000,
  aguaDe:    '08:00',
  aguaAte:   '20:00',
  aguaCada:  3      // horas entre lembretes de água
};

function _paCfg_() {
  var c = {};
  Object.keys(PA_PADRAO).forEach(function (k) {
    var v = '';
    try { v = String(getConfig_('push_' + k) || ''); } catch (e) {}
    if (!v) { c[k] = PA_PADRAO[k]; return; }
    c[k] = (typeof PA_PADRAO[k] === 'number') ? (parseInt(v, 10) || PA_PADRAO[k]) : v;
  });
  return c;
}

function _paAgora_() {
  var d = new Date();
  return {
    hhmm: Utilities.formatDate(d, PA_TZ, 'HH:mm'),
    minutos: parseInt(Utilities.formatDate(d, PA_TZ, 'HH'), 10) * 60 +
             parseInt(Utilities.formatDate(d, PA_TZ, 'mm'), 10),
    dia: Utilities.formatDate(d, PA_TZ, 'yyyy-MM-dd'),
    diaSemana: Number(Utilities.formatDate(d, PA_TZ, 'u'))   // 1=seg ... 7=dom
  };
}

function _paMin_(hhmm) {
  var p = String(hhmm || '').split(':');
  var h = parseInt(p[0], 10), m = parseInt(p[1], 10);
  if (isNaN(h) || isNaN(m)) return -1;
  return h * 60 + m;
}

// Já mandamos este aviso para esta pessoa hoje?
function _paJaFoi_(email, regra, dia) {
  try {
    return !!CacheService.getScriptCache().get('pa_' + dia + '_' + regra + '_' +
             Utilities.base64EncodeWebSafe(email).slice(0, 24));
  } catch (e) { return false; }
}

function _paMarcar_(email, regra, dia) {
  try {
    CacheService.getScriptCache().put('pa_' + dia + '_' + regra + '_' +
      Utilities.base64EncodeWebSafe(email).slice(0, 24), '1', 22 * 3600);
  } catch (e) {}
}

function _paContadorDia_(email, dia, somar) {
  var chave = 'pacnt_' + dia + '_' + Utilities.base64EncodeWebSafe(email).slice(0, 24);
  try {
    var c = CacheService.getScriptCache();
    var n = parseInt(c.get(chave), 10) || 0;
    if (somar) { n++; c.put(chave, String(n), 22 * 3600); }
    return n;
  } catch (e) { return 0; }
}

// Preferências de horário do aluno, com o padrão global por trás.
function _paPrefsDe_(email, cfg, linha, cabecalho) {
  var p = { acordar: cfg.acordar, dormir: cfg.dormir, ligado: true, categorias: {} };
  try {
    if (!linha) return p;
    var prefs = _prefsLer_(linha, cabecalho);
    var n = prefs && prefs.notificacoes;
    if (n) {
      if (n.acordar) p.acordar = String(n.acordar);
      if (n.dormir)  p.dormir  = String(n.dormir);
      if (n.ligado === false) p.ligado = false;
      p.categorias = n.categorias || {};
    }
  } catch (e) {}
  return p;
}

function _paQuer_(prefs, categoria) {
  if (!prefs.ligado) return false;
  return prefs.categorias[categoria] !== false;   // ausente = quer
}

// ─────────────────────────────────────────────────────────────
// O que a pessoa já fez hoje. Sem isto o coach vira cobrador —
// e cobrar quem já cumpriu é o caminho mais curto para a pessoa
// desligar tudo.
//
// Lê da MESMA fonte que a tela do aluno (o JSON de pilares em
// compradores), para o aviso nunca discordar do que ela vê.
// ─────────────────────────────────────────────────────────────
var PA_PILARES = ['meditacao', 'leitura', 'exercicio', 'audio'];

function _paFeitoHoje_(linha, cabecalho) {
  var out = { pilares: 0, meditou: false, leu: false, treinou: false,
              ouviu: false, aguaMl: 0, checkin: false };
  try {
    if (!linha) return out;
    var json = _getPilaresJson_(linha, cabecalho);
    var info = _calcDiaAtualFromInicio_(json, linha);
    var hoje = json[String(info.dia)] || {};

    out.meditou = hoje.meditacao === true;
    out.leu     = hoje.leitura   === true;
    out.treinou = hoje.exercicio === true;
    out.ouviu   = hoje.audio     === true;
    out.checkin = hoje.checkin   === true;
    out.pilares = PA_PILARES.filter(function (k) { return hoje[k] === true; }).length;
    out.aguaMl  = Number(hoje.aguaMl) || 0;
  } catch (e) {}
  return out;
}

// ─────────────────────────────────────────────────────────────
// AS REGRAS DO DIA
// Cada uma diz: quando vale, se ainda faz sentido, e o que falar.
// ─────────────────────────────────────────────────────────────
function _paRegras_(ctx) {
  var cfg = ctx.cfg, pr = ctx.prefs, fez = ctx.fez, agora = ctx.agora;
  var acordar = _paMin_(pr.acordar), dormir = _paMin_(pr.dormir);
  var nome = ctx.nome ? (', ' + ctx.nome) : '';
  var regras = [];

  // ── Manhã ──
  regras.push({
    id: 'manha', categoria: 'rotina',
    vale: agora.minutos >= acordar && agora.minutos < acordar + 45,
    faz: fez.pilares === 0,
    titulo: 'Bom dia' + nome + '!',
    corpo: 'Seu Milagre da Manhã começa agora. Comece pela meditação — são só alguns minutos.',
    url: '/app?atalho=meditacao', grupo: 'rotina', urgente: true
  });

  // Cutucada, não sermão: só para quem não começou.
  regras.push({
    id: 'manha2', categoria: 'rotina',
    vale: agora.minutos >= acordar + 120 && agora.minutos < acordar + 180,
    faz: fez.pilares === 0,
    titulo: 'Ainda dá tempo',
    corpo: 'O dia mal começou. Um pilar agora já muda a sua sequência.',
    url: '/app', grupo: 'rotina'
  });

  regras.push({
    id: 'meiodia', categoria: 'rotina',
    vale: agora.minutos >= 12 * 60 && agora.minutos < 13 * 60,
    faz: fez.pilares > 0 && fez.pilares < 3,
    titulo: 'Faltam ' + (3 - fez.pilares) + ' para fechar o dia',
    corpo: 'Você já fez ' + fez.pilares + '. Com 3 pilares o dia conta na sua sequência.',
    url: '/app', grupo: 'rotina'
  });

  // ── Água ──
  // Espalhada pela janela, e some assim que a meta é batida.
  //
  // Só entra quando a experiência de água EXISTIR no app. Mandar a
  // pessoa tocar num aviso que abre uma tela inexistente destrói a
  // confiança em todas as outras notificações.
  if (ctx.temAgua) {
    var aDe = _paMin_(cfg.aguaDe), aAte = _paMin_(cfg.aguaAte);
    var passo = Math.max(1, cfg.aguaCada) * 60;
    for (var t = aDe, n = 1; t <= aAte; t += passo, n++) {
      (function (hora, idx) {
        regras.push({
          id: 'agua' + idx, categoria: 'agua',
          vale: agora.minutos >= hora && agora.minutos < hora + 30,
          faz: fez.aguaMl < cfg.aguaMetaMl,
          titulo: 'Hora de beber água',
          corpo: fez.aguaMl > 0
            ? 'Você já bebeu ' + fez.aguaMl + 'ml de ' + cfg.aguaMetaMl + 'ml hoje.'
            : 'Meta de hoje: ' + cfg.aguaMetaMl + 'ml. Comece com um copo.',
          url: '/app?atalho=agua', grupo: 'agua'
        });
      })(t, n);
    }
  }

  // ── Tarde: sonhos ──
  regras.push({
    id: 'sonhos', categoria: 'sonhos',
    vale: agora.minutos >= 16 * 60 && agora.minutos < 16 * 60 + 30,
    faz: true,
    titulo: 'Um minuto com seus sonhos',
    corpo: 'Abra o Mural e leia suas declarações em voz alta. Um minuto basta.',
    url: '/app?atalho=mural', grupo: 'sonhos'
  });

  // ── Noite ──
  regras.push({
    id: 'ultimachance', categoria: 'rotina',
    vale: agora.minutos >= dormir - 150 && agora.minutos < dormir - 120,
    faz: fez.pilares < 3,
    titulo: 'Seu dia ainda pode contar',
    corpo: fez.pilares === 0
      ? 'Nenhum pilar hoje. Um áudio de 5 minutos já quebra o zero.'
      : 'Você fez ' + fez.pilares + '. Falta pouco para fechar.',
    url: '/app', grupo: 'rotina'
  });

  // v172: a tela do sono existe, entao o aviso pode prometer o que
  // cumpre. A trava ctx.temSono saiu daqui junto com o motivo dela.
  regras.push({
    id: 'dormir', categoria: 'sono',
    vale: agora.minutos >= dormir - 30 && agora.minutos < dormir + 15,
    faz: true,
    titulo: 'Hora de desacelerar',
    corpo: 'Comece a desligar as telas. Toque aqui e escolha um som para dormir.',
    url: '/app?atalho=sono', grupo: 'sono'
  });

  return regras;
}

// ─────────────────────────────────────────────────────────────
// ROTINA — gatilho de tempo a cada 15 minutos
// ─────────────────────────────────────────────────────────────
function pushRodarAgenda() {
  if (!pushConfigurado_()) return { ok: false, error: 'push nao configurado' };
  if (String(getConfig_('push_agenda_ativa') || '') !== '1') return { ok: false, error: 'desligada' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { ok: false, error: 'ja rodando' }; }

  var res = { avaliados: 0, enviados: 0, pulados: 0, erros: 0 };
  try {
    var cfg = _paCfg_();
    var agora = _paAgora_();

    // As experiências que ainda não existem não geram aviso. Cada uma
    // liga aqui quando for construída.
    var modulos = {
      agua: String(getConfig_('push_mod_agua') || '') === '1',
      sono: String(getConfig_('push_mod_sono') || '') === '1'
    };

    // Uma leitura só de compradores: a rotina roda a cada 15 minutos e
    // reler a aba por aluno estouraria a cota rapidinho.
    var compradores = {}, cabComp = [];
    try {
      var abaC = getSpreadsheet_().getSheetByName(SHEET_COMPRADORES);
      if (abaC && abaC.getLastRow() > 1) {
        var dc = abaC.getDataRange().getValues();
        cabComp = dc[0].map(function (h) { return String(h || ''); });
        var iMail = cabComp.indexOf('Email'), iNome = cabComp.indexOf('Nome');
        for (var c = 1; c < dc.length; c++) {
          var em = _puNorm_(dc[c][iMail]);
          if (em) compradores[em] = { linha: dc[c], nome: dc[c][iNome] };
        }
      }
    } catch (e) {}

    // Só quem tem aparelho registrado entra na conta. Varrer a base
    // inteira a cada 15 min gastaria cota para nada.
    var emails = {};
    var sh = _puAba_();
    if (sh.getLastRow() < 2) return { ok: true, data: res };
    var d = sh.getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      if (d[i][7] === false) continue;
      emails[_puNorm_(d[i][0])] = true;
    }

    Object.keys(emails).forEach(function (email) {
      if (!email) return;
      res.avaliados++;

      if (_paContadorDia_(email, agora.dia, false) >= cfg.tetoDia) { res.pulados++; return; }

      var prefs = _paPrefsDe_(email, cfg, (compradores[email] || {}).linha, cabComp);
      if (!prefs.ligado) { res.pulados++; return; }

      // Fora da janela da pessoa não sai nada — nem o aviso mais
      // importante. Notificação às 3h da manhã não é coach, é praga.
      var acordar = _paMin_(prefs.acordar), dormir = _paMin_(prefs.dormir);
      var dentro = agora.minutos >= acordar - 15 && agora.minutos <= dormir + 20;
      if (!dentro) { res.pulados++; return; }

      var reg = compradores[email] || null;
      var nome = reg ? String(reg.nome || '').split(' ')[0] : '';
      var fez = _paFeitoHoje_(reg && reg.linha, cabComp);
      var regras = _paRegras_({
        cfg: cfg, prefs: prefs, fez: fez, agora: agora, nome: nome,
        temAgua: modulos.agua, temSono: modulos.sono
      });

      for (var r = 0; r < regras.length; r++) {
        var g = regras[r];
        if (!g.vale || !g.faz) continue;
        if (!_paQuer_(prefs, g.categoria)) continue;
        if (_paJaFoi_(email, g.id, agora.dia)) continue;

        var envio = pushEnviar_(email, g);
        _paMarcar_(email, g.id, agora.dia);
        if (envio && envio.ok) {
          res.enviados++;
          _paContadorDia_(email, agora.dia, true);
        } else {
          res.erros++;
        }
        break;   // um aviso por rodada, no máximo
      }
    });

    if (res.enviados || res.erros) {
      logAction('system', 'PUSH_AGENDA', 'push', agora.hhmm, JSON.stringify(res));
    }
    return { ok: true, data: res };

  } catch (e) {
    logAction('system', 'PUSH_AGENDA_ERRO', 'push', '', e.message);
    return { ok: false, error: e.message };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ─────────────────────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────────────────────
function pushAgendaStatus(token) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };
  var cfg = _paCfg_();
  cfg.ativa = String(getConfig_('push_agenda_ativa') || '') === '1';
  return { ok: true, data: cfg };
}

function pushAgendaSalvar(token, data) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };
  var d = data || {};

  ['acordar', 'dormir', 'aguaDe', 'aguaAte'].forEach(function (k) {
    if (d[k] && _paMin_(d[k]) >= 0) setConfig_('push_' + k, String(d[k]));
  });
  ['tetoDia', 'aguaMetaMl', 'aguaCada'].forEach(function (k) {
    var n = parseInt(d[k], 10);
    if (n > 0) setConfig_('push_' + k, String(n));
  });
  setConfig_('push_agenda_ativa', d.ativa ? '1' : '');

  try {
    var existe = false;
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() !== 'pushRodarAgenda') return;
      if (d.ativa) { existe = true; return; }
      ScriptApp.deleteTrigger(t);   // desligou, o gatilho sai junto
    });
    if (d.ativa && !existe) {
      ScriptApp.newTrigger('pushRodarAgenda').timeBased().everyMinutes(15).create();
    }
  } catch (e) {}

  logAction(user.email, 'PUSH_AGENDA_CONFIG', 'push', '', d.ativa ? 'ativa' : 'desligada');
  return { ok: true, message: d.ativa
    ? 'Agenda ativa. O app passa a avisar durante o dia.'
    : 'Agenda desligada.', data: _paCfg_() };
}

function pushAgendaRodarAgora(token) {
  var user = getUserByToken(token);
  if (!user || user.role !== 'admin') return { ok: false, error: 'Sem permissao.' };
  var antes = String(getConfig_('push_agenda_ativa') || '');
  if (antes !== '1') setConfig_('push_agenda_ativa', '1');
  var r = pushRodarAgenda();
  if (antes !== '1') setConfig_('push_agenda_ativa', antes);
  return r;
}
