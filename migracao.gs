// ============================================================
// migracao.gs — Passar o sistema para a conta do Wagner
// Desafio 21 Dias — WPK Tavares
// ------------------------------------------------------------
// O web app roda com executeAs: USER_DEPLOYING — tudo acontece com
// a identidade de QUEM FEZ O DEPLOY. Isso decide a migração:
//
//   • Transferir a propriedade da planilha não move cota nenhuma.
//     A cota é de quem publicou o deployment.
//   • Depois da troca, o script procura as pastas NO DRIVE DO NOVO
//     DONO. Pasta que ele não enxerga não gera erro: o código cria
//     uma nova, vazia, e segue. Os PDFs dos alunos somem da
//     biblioteca e ninguém é avisado. Por isso tudo é compartilhado
//     ANTES da troca.
//   • Gatilhos pertencem a quem os criou e não se transferem. E a
//     API não devolve o agendamento de um gatilho ("a cada 15 min"),
//     então não dá para copiá-los: são recriados pelas mesmas
//     funções que os criaram da primeira vez.
//
// Ordem segura:
//   1. Inventário            (roda como você; só lê)
//   2. Compartilhar          (roda como você; o Wagner vira editor)
//   3. clasp login + deploy  (a partir daqui roda como o Wagner)
//   4. Recriar gatilhos      (roda como o Wagner)
//   5. migracaoApagarMeusGatilhos() no editor, logado como você
// ============================================================

var MIG_PASTAS_POR_NOME = ['Comunidade Media', 'Mural Declaracoes Media', 'avatars', 'capas'];
var MIG_PROP_SNAPSHOT   = 'MIG_GATILHOS_SNAPSHOT';
var MIG_PROP_DESTINO    = 'MIG_DESTINO';
var MIG_PROP_RECRIADOS  = 'MIG_GATILHOS_RECRIADOS';

// Como recriar cada gatilho. As funções de setup já apagam o gatilho
// antigo do MESMO usuário antes de criar — rodá-las de novo é seguro.
// As três que pedem token têm o agendamento copiado do próprio código
// delas, para ficar idêntico.
var MIG_RECRIAR = {
  rotinaManha:                   'setupAutomacaoTriggers',
  rotinaNight:                   'setupAutomacaoTriggers',
  followUpLeadsSemResposta:      'setupAutomacaoTriggers',
  processarAssinaturasdiarias_:  'setupAssinaturaTrigger',
  reconciliarAcessos_:           'setupReconciliacaoTrigger',
  enviarLembretesTrial:          'setupLembretesTrial',
  notificarTrialExpirando_:      'setupTrialNotifTrigger',
  syncLeadsFromSheet:            'setupTriggers',
  onLeadFormSubmit:              'setupTriggers',
  syncMetaDados_:                'setupMetaTrigger',
  stripeBuscarEventos:           { minutos: 5 },
  recuperarCheckoutsAbandonados: { minutos: 15 },
  pushRodarAgenda:               { minutos: 15 }
};

function _migAdmin_(token) {
  var user = getUserByToken(token);
  return (user && user.role === 'admin') ? user : null;
}

// Com USER_DEPLOYING, o usuário efetivo é o dono do deployment ativo.
// É ESSE e-mail que diz se a troca já aconteceu.
function _migRodandoComo_() {
  try { return String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); }
  catch (e) { return ''; }
}

function _migDono_(item) {
  try { var o = item.getOwner(); return o ? String(o.getEmail() || '').toLowerCase() : '(drive compartilhado)'; }
  catch (e) { return '?'; }
}

function _migEmailValido_(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
}

// Percorre uma pasta com teto de tempo e de itens — o Apps Script
// derruba a execução em 6 minutos, e a pasta dos PDFs cresce sozinha.
function _migMedirPasta_(pasta, limite) {
  var r = { arquivos: 0, bytes: 0, parcial: false };
  var pilha = [pasta];
  var t0 = Date.now();
  while (pilha.length) {
    if (r.arquivos >= limite || Date.now() - t0 > 40000) { r.parcial = true; break; }
    var p = pilha.pop();
    try {
      var fs = p.getFiles();
      while (fs.hasNext()) {
        var f = fs.next();
        r.arquivos++;
        try { r.bytes += f.getSize(); } catch (e) {}
        if (r.arquivos >= limite) { r.parcial = true; break; }
      }
      var ps = p.getFolders();
      while (ps.hasNext()) pilha.push(ps.next());
    } catch (e) {}
  }
  return r;
}

// Tudo que o sistema usa do Drive, com o objeto real para compartilhar.
function _migItens_() {
  var itens = [];

  try {
    var ss = getSpreadsheet_();
    var arq = DriveApp.getFileById(ss.getId());
    itens.push({ tipo: 'planilha', nome: arq.getName(), id: arq.getId(), obj: arq });
  } catch (e) {
    itens.push({ tipo: 'planilha', nome: 'Planilha principal', id: SPREADSHEET_ID, erro: e.message });
  }

  try {
    var sc = DriveApp.getFileById(ScriptApp.getScriptId());
    itens.push({ tipo: 'script', nome: sc.getName(), id: sc.getId(), obj: sc });
  } catch (e) {
    itens.push({ tipo: 'script', nome: 'Projeto Apps Script', id: ScriptApp.getScriptId(), erro: e.message });
  }

  MIG_PASTAS_POR_NOME.forEach(function (nome) {
    try {
      var it = DriveApp.getFoldersByName(nome);
      if (!it.hasNext()) { itens.push({ tipo: 'pasta', nome: nome, id: '', ausente: true }); return; }
      var p = it.next();
      itens.push({ tipo: 'pasta', nome: nome, id: p.getId(), obj: p });
    } catch (e) {
      itens.push({ tipo: 'pasta', nome: nome, id: '', erro: e.message });
    }
  });

  // A pasta dos PDFs dos alunos é achada por ID, não por nome. Se o
  // novo dono não a enxergar, user_content.gs cria outra e SOBRESCREVE
  // a propriedade — aí os arquivos antigos ficam órfãos de vez.
  var idUc = '';
  try { idUc = PropertiesService.getScriptProperties().getProperty('USER_CONTENT_ROOT_FOLDER_ID') || ''; } catch (e) {}
  if (idUc) {
    try {
      var uc = DriveApp.getFolderById(idUc);
      itens.push({ tipo: 'pasta', nome: uc.getName() + ' (PDFs dos alunos)', id: idUc, obj: uc });
    } catch (e) {
      itens.push({ tipo: 'pasta', nome: 'PDFs dos alunos', id: idUc, erro: e.message });
    }
  }
  return itens;
}

// ─────────────────────────────────────────────────────────────
// ROTA (admin): getMigracaoInventario — só leitura
// ─────────────────────────────────────────────────────────────
function getMigracaoInventario(token) {
  var user = _migAdmin_(token);
  if (!user) return { ok: false, error: 'Sem permissao.' };

  var props = PropertiesService.getScriptProperties();
  var rodando = _migRodandoComo_();
  var destino = String(props.getProperty(MIG_PROP_DESTINO) || '').toLowerCase();

  var itens = _migItens_().map(function (it) {
    var out = { tipo: it.tipo, nome: it.nome, id: it.id,
                ausente: !!it.ausente, erro: it.erro || '' };
    if (it.obj) {
      out.dono = _migDono_(it.obj);
      if (destino) {
        try {
          var eds = it.obj.getEditors().map(function (u) { return String(u.getEmail()).toLowerCase(); });
          out.destinoTemAcesso = out.dono === destino || eds.indexOf(destino) >= 0;
        } catch (e) { out.destinoTemAcesso = null; }
      }
      if (it.tipo === 'pasta') {
        var m = _migMedirPasta_(it.obj, 3000);
        out.arquivos = m.arquivos; out.bytes = m.bytes; out.parcial = m.parcial;
      } else {
        try { out.bytes = it.obj.getSize(); } catch (e) { out.bytes = 0; }
      }
    }
    return out;
  });

  var gatilhos = [];
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      gatilhos.push({ funcao: t.getHandlerFunction(), tipo: String(t.getEventType()) });
    });
  } catch (e) {}

  var snap = [];
  try { snap = JSON.parse(props.getProperty(MIG_PROP_SNAPSHOT) || '{}').funcoes || []; } catch (e) {}

  return { ok: true, data: {
    rodandoComo: rodando,
    destino: destino,
    // A troca aconteceu quando o sistema passa a rodar como o destino.
    trocaFeita: !!destino && rodando === destino,
    itens: itens,
    gatilhosDesteUsuario: gatilhos,
    snapshot: snap,
    recriadosEm: props.getProperty(MIG_PROP_RECRIADOS) || ''
  } };
}

// ─────────────────────────────────────────────────────────────
// ROTA (admin): migracaoCompartilhar — passo 2
// ------------------------------------------------------------
// Só ACRESCENTA acesso. Nada muda de dono, nada sai do lugar, o
// sistema segue rodando como hoje. Pode ser repetido à vontade.
// ─────────────────────────────────────────────────────────────
function migracaoCompartilhar(token, data) {
  var user = _migAdmin_(token);
  if (!user) return { ok: false, error: 'Sem permissao.' };

  var email = String((data || {}).email || '').trim().toLowerCase();
  if (!_migEmailValido_(email)) return { ok: false, error: 'Informe um e-mail valido.' };

  var rodando = _migRodandoComo_();
  if (email === rodando) {
    return { ok: false, error: 'Esse e o e-mail que ja roda o sistema. Informe a conta NOVA.' };
  }

  var props = PropertiesService.getScriptProperties();
  var resultado = [];

  _migItens_().forEach(function (it) {
    if (!it.obj) {
      resultado.push({ nome: it.nome, ok: false, msg: it.ausente ? 'nao existe (sera criada vazia na troca)' : it.erro });
      return;
    }
    try {
      var dono = _migDono_(it.obj);
      var eds = it.obj.getEditors().map(function (u) { return String(u.getEmail()).toLowerCase(); });
      if (dono === email || eds.indexOf(email) >= 0) {
        resultado.push({ nome: it.nome, ok: true, msg: 'ja tinha acesso' });
        return;
      }
      it.obj.addEditor(email);
      resultado.push({ nome: it.nome, ok: true, msg: 'editor adicionado' });
    } catch (e) {
      resultado.push({ nome: it.nome, ok: false, msg: e.message });
    }
  });

  // Fotografa QUAIS gatilhos estão ativos hoje. Depois da troca, é esta
  // lista que diz o que recriar — gatilho desligado continua desligado.
  var funcoes = {};
  try { ScriptApp.getProjectTriggers().forEach(function (t) { funcoes[t.getHandlerFunction()] = true; }); } catch (e) {}
  props.setProperty(MIG_PROP_SNAPSHOT, JSON.stringify({
    de: rodando, em: nowISO(), funcoes: Object.keys(funcoes)
  }));
  props.setProperty(MIG_PROP_DESTINO, email);

  logAction(user.email, 'MIGRACAO_COMPARTILHAR', 'migracao', email,
            resultado.filter(function (r) { return r.ok; }).length + '/' + resultado.length);

  return { ok: true, data: { itens: resultado, gatilhos: Object.keys(funcoes), rodandoComo: rodando } };
}

// ─────────────────────────────────────────────────────────────
// ROTA (admin): migracaoRecriarGatilhos — passo 4, JÁ como o Wagner
// ─────────────────────────────────────────────────────────────
function migracaoRecriarGatilhos(token) {
  var user = _migAdmin_(token);
  if (!user) return { ok: false, error: 'Sem permissao.' };

  var props = PropertiesService.getScriptProperties();
  var snap = {};
  try { snap = JSON.parse(props.getProperty(MIG_PROP_SNAPSHOT) || '{}'); } catch (e) {}
  if (!snap.funcoes || !snap.funcoes.length) {
    return { ok: false, error: 'Sem a lista de gatilhos. Rode o passo 2 (compartilhar) antes da troca.' };
  }

  // Ainda como a conta antiga? Recriar agora so duplicaria os gatilhos
  // dela — e o aluno receberia cada aviso duas vezes.
  var rodando = _migRodandoComo_();
  if (rodando === String(snap.de || '').toLowerCase()) {
    return { ok: false, error: 'O sistema ainda roda como ' + rodando +
             '. Faca o deploy pela conta nova antes de recriar os gatilhos.' };
  }

  var feitos = {}, resultado = [];
  snap.funcoes.forEach(function (fn) {
    var como = MIG_RECRIAR[fn];
    if (!como) { resultado.push({ funcao: fn, ok: false, msg: 'sem receita — recrie a mao' }); return; }
    try {
      if (typeof como === 'string') {
        if (!feitos[como]) {
          var f = globalThis[como];
          if (typeof f !== 'function') throw new Error(como + ' nao existe');
          f();
          feitos[como] = true;
        }
        resultado.push({ funcao: fn, ok: true, msg: 'via ' + como });
      } else {
        ScriptApp.getProjectTriggers().forEach(function (t) {
          if (t.getHandlerFunction() === fn) ScriptApp.deleteTrigger(t);
        });
        ScriptApp.newTrigger(fn).timeBased().everyMinutes(como.minutos).create();
        resultado.push({ funcao: fn, ok: true, msg: 'a cada ' + como.minutos + ' min' });
      }
    } catch (e) {
      resultado.push({ funcao: fn, ok: false, msg: e.message });
    }
  });

  // Algumas funcoes de setup criam varios gatilhos de uma vez —
  // setupAutomacaoTriggers cria tres. Se so dois estavam ativos, o
  // terceiro nasceria agora e ligaria uma automacao que estava
  // DESLIGADA (o follow-up de leads, por exemplo: mensagens saindo sem
  // ninguem ter pedido). O que nao estava na fotografia sai de novo.
  var antes = {};
  snap.funcoes.forEach(function (fn) { antes[fn] = true; });
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (MIG_RECRIAR[fn] && !antes[fn]) {
      ScriptApp.deleteTrigger(t);
      resultado.push({ funcao: fn, ok: true, msg: 'removido: estava desligado antes da troca' });
    }
  });

  props.setProperty(MIG_PROP_RECRIADOS, nowISO());
  logAction(user.email, 'MIGRACAO_GATILHOS', 'migracao', rodando,
            resultado.filter(function (r) { return r.ok; }).length + '/' + resultado.length);

  var agora = [];
  try { ScriptApp.getProjectTriggers().forEach(function (t) { agora.push(t.getHandlerFunction()); }); } catch (e) {}
  return { ok: true, data: { itens: resultado, gatilhosAgora: agora, rodandoComo: rodando } };
}

// ─────────────────────────────────────────────────────────────
// PASSO 5 — rodar pelo EDITOR do Apps Script, logado como a conta
// ANTIGA (Executar → migracaoApagarMeusGatilhos).
//
// Não é rota: pelo admin ela rodaria como o dono do deployment, que a
// esta altura é a conta NOVA — e apagaria justamente os gatilhos bons.
// getProjectTriggers() só devolve os gatilhos de quem está rodando,
// então pelo editor ela só alcança os da conta antiga.
// ─────────────────────────────────────────────────────────────
function migracaoApagarMeusGatilhos() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty(MIG_PROP_RECRIADOS)) {
    throw new Error('Os gatilhos ainda nao foram recriados na conta nova. ' +
                    'Apagar agora deixaria o sistema sem nenhuma rotina.');
  }
  var eu = '';
  try { eu = String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) {}
  var destino = String(props.getProperty(MIG_PROP_DESTINO) || '').toLowerCase();
  if (eu && eu === destino) {
    throw new Error('Voce esta logado como ' + eu + ', a conta NOVA. ' +
                    'Rode isto logado na conta antiga.');
  }

  var apagados = [];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    apagados.push(t.getHandlerFunction());
    ScriptApp.deleteTrigger(t);
  });
  Logger.log('Apagados ' + apagados.length + ' gatilhos de ' + (eu || 'conta atual') + ': ' + apagados.join(', '));
  return apagados;
}
