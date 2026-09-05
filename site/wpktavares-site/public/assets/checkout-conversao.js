/* ════════════════════════════════════════════════════════════
   checkout-conversao.js — componentes de conversão compartilhados
   Desafio 21 Dias — WPK Tavares (v151)
   ------------------------------------------------------------
   Extraído de /checkout-trial/ para o /checkout-trial-cartao/.

   DIFERENÇA IMPORTANTE em relação ao código de origem:
   o feed antigo sorteava nomes de uma lista fixa, o evento de
   outra e a hora de uma terceira ("Marcela Cunha comprou há 1
   hora"), e o contador de visitantes era randInt(50,150).
   Nada disso tinha acontecido.

   Aqui todo evento vem da rota getAtividadeReal, que lê a aba
   `compradores`. Se não houver nada recente, o bloco some — não
   existe caminho neste arquivo que invente um evento.
   ════════════════════════════════════════════════════════════ */
(function (raiz) {
  'use strict';

  var CKConv = {};

  // ── util ──────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  var ehMobile = function () { return window.matchMedia('(max-width:1100px)').matches; };
  var reduzMovimento = function () {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  var CORES = ['#4caf50','#66bb6a','#43a047','#388e3c','#2e7d32',
               '#81c784','#558b2f','#33691e','#1b5e20','#a5d6a7'];

  var ICO_CARRINHO = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ckv-ico"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>';
  var ICO_ESTRELA  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ckv-ico"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';

  function som() {
    if (reduzMovimento()) return;
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator(), g = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12);
      g.gain.setValueAtTime(0.12, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.35);
    } catch (e) {}
  }

  // ══════════════════════════════════════════════════════════
  // ATIVIDADE — só o que aconteceu de verdade
  // ══════════════════════════════════════════════════════════
  CKConv.atividade = (function () {
    var cfg = null, eventos = [], idx = 0, contador = 0, timerToast = null;

    function cartao(ev) {
      var cor = CORES[contador % CORES.length];
      var av = '<div class="ckv-av" style="background:' + cor + '">' +
                 esc(ev.nome.charAt(0)) + '</div>';
      var ico = ev.tipo === 'trial' ? ICO_ESTRELA : ICO_CARRINHO;

      var el = document.createElement('div');
      el.className = 'ckv-card' + (ev.tipo === 'trial' ? ' ckv-trial' : '');
      el.innerHTML = av +
        '<div class="ckv-body">' +
          '<div class="ckv-nome">' + esc(ev.nome) + '</div>' +
          '<div class="ckv-evento">' + esc(ev.evento) + '</div>' +
          '<div class="ckv-quando">' + esc(ev.quando) + '</div>' +
        '</div>' + ico;
      return el;
    }

    function remover(el) {
      if (!el || !el.parentNode) return;
      el.classList.add('saindo');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 500);
    }

    function toast(ev) {
      var t = cfg.toast; if (!t) return;
      var av = t.querySelector('.ckv-toast-av');
      if (av) {
        av.style.background = CORES[contador % CORES.length];
        av.textContent = ev.nome.charAt(0);
      }
      var q = function (c) { return t.querySelector(c); };
      if (q('.ckv-toast-t')) q('.ckv-toast-t').textContent = ev.nome;
      if (q('.ckv-toast-e')) q('.ckv-toast-e').textContent = ev.evento;
      if (q('.ckv-toast-q')) q('.ckv-toast-q').textContent = ev.quando;

      t.classList.remove('hide'); t.classList.add('show');
      clearTimeout(timerToast);
      timerToast = setTimeout(function () {
        t.classList.remove('show'); t.classList.add('hide');
      }, 5000);
    }

    function mostrar(ev) {
      if (cfg.som !== false) som();
      if (ehMobile()) { toast(ev); contador++; return; }

      var feed = cfg.feed; if (!feed) return;
      var atuais = feed.querySelectorAll('.ckv-card');
      if (atuais.length >= 5) remover(atuais[atuais.length - 1]);

      var el = cartao(ev);
      feed.insertBefore(el, feed.firstChild);
      contador++;
      setTimeout(function () { remover(el); }, 9000);
    }

    // Percorre os eventos reais em ritmo pausado. Cada cartão carrega o
    // horário verdadeiro do próprio evento ("ontem", "há 3 dias"), então
    // nada aqui sugere que a compra está acontecendo neste instante.
    function rodar() {
      if (!eventos.length) return;
      mostrar(eventos[idx % eventos.length]);
      idx++;
      setTimeout(rodar, 22000 + Math.random() * 10000);
    }

    function init(opcoes) {
      cfg = opcoes || {};
      cfg.feed  = cfg.feed  || $('ckvFeed');
      cfg.toast = cfg.toast || $('ckvToast');

      return CKConv.dados(cfg.endpoint).then(function (d) {
        eventos = (d && d.eventos) || [];
        if (!eventos.length) {
          // Sem movimento real para mostrar: esconde a coluna inteira em
          // vez de preencher com gente que não existe.
          var col = cfg.coluna || (cfg.feed && cfg.feed.closest('.ckv-feed-col'));
          if (col) col.style.display = 'none';
          return d;
        }
        setTimeout(rodar, 2500);
        return d;
      })['catch'](function () {
        var col = cfg.coluna || (cfg.feed && cfg.feed.closest('.ckv-feed-col'));
        if (col) col.style.display = 'none';
      });
    }

    return { init: init };
  })();

  // ══════════════════════════════════════════════════════════
  // PROVA SOCIAL — número real de quem entrou
  // ══════════════════════════════════════════════════════════
  CKConv.provaSocial = {
    init: function (opcoes) {
      var o = opcoes || {};
      var el = o.el || $('ckvProva');
      if (!el) return Promise.resolve();

      return CKConv.dados(o.endpoint).then(function (d) {
        if (!d || !d.resumo) { el.style.display = 'none'; return; }
        var t = el.querySelector('.ckv-prova-t');
        if (t) t.innerHTML = '<strong>' + esc(d.resumo) + '</strong>';
        var s = el.querySelector('.ckv-prova-s');
        if (s && d.totalAlunos) {
          // "entraram", não "fizeram": a planilha registra a adesão paga,
          // não a conclusão dos 21 dias.
          s.textContent = d.totalAlunos + ' pessoas já entraram no desafio';
        }
        el.style.display = 'flex';
      })['catch'](function () { el.style.display = 'none'; });
    }
  };

  // ── Uma requisição só, compartilhada pelos dois blocos ────
  var _promessa = null;
  CKConv.dados = function (endpoint) {
    if (_promessa) return _promessa;
    _promessa = fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'getAtividadeReal', data: { limite: 8 } })
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) throw new Error('sem dados');
        return j.data;
      });
    return _promessa;
  };

  // ══════════════════════════════════════════════════════════
  // DEPOIMENTOS — coverflow 3D com os vídeos REAIS das alunas
  // ══════════════════════════════════════════════════════════
  CKConv.DEPOIMENTOS = [
    { src:'https://i.imgur.com/N9UhM0w.mp4', foto:'https://i.imgur.com/W1OHWzg.jpeg', nome:'Apolyanara',    quote:'"O Milagre da Manhã tem mudado minha vida de forma incrível..."' },
    { src:'https://i.imgur.com/1nrH1Z5.mp4', foto:'https://i.imgur.com/34VBNg8.jpeg', nome:'Ireuza Cazuza', quote:'"Com esse sistema aprendi a aproveitar bem o meu tempo..."' },
    { src:'https://i.imgur.com/5XcREqO.mp4', foto:'https://i.imgur.com/inzje19.jpeg', nome:'Alice Lima',    quote:'"Incrível! Equipe comprometida e totalmente treinada..."' },
    { src:'https://i.imgur.com/utJiZZi.mp4', foto:'https://i.imgur.com/l863Cu2.jpeg', nome:'Ademilton',     quote:'"Agora levantamos todos os dias às 5 da manhã..."' },
    { src:'https://i.imgur.com/wN5ysgI.mp4', foto:'https://i.imgur.com/yjuuIAA.jpeg', nome:'Leide Danhane', quote:'"A experiência tem sido incrível! Tinha inconstância..."' }
  ];

  CKConv.depoimentos = (function () {
    var SOM_OFF = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
    var SOM_ON  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';

    var palco, dots, itens, videos, dotEls;
    var atual = 0, total = 0, timer = null, pausado = false, ROT_MS = 10000;

    function render() {
      for (var i = 0; i < itens.length; i++) {
        var off = i - atual;
        if (off >  total / 2) off -= total;
        if (off < -total / 2) off += total;
        itens[i].setAttribute('data-pos', Math.abs(off) <= 2 ? String(off) : 'hidden');
      }
      for (var d = 0; d < dotEls.length; d++) {
        dotEls[d].classList.toggle('active', d === atual);
      }
      for (var v = 0; v < videos.length; v++) {
        if (v === atual) {
          videos[v].play()['catch'](function () {});
        } else {
          videos[v].pause();
          videos[v].muted = true;
          var s = $('ckvSom' + v); if (s) s.innerHTML = SOM_OFF;
        }
      }
    }

    function irPara(i, manual) {
      if (pausado) {
        if (videos[atual]) videos[atual].muted = true;
        var ps = $('ckvSom' + atual); if (ps) ps.innerHTML = SOM_OFF;
        pausado = false;
      }
      atual = (i + total) % total;
      render();
      if (manual) reiniciarTimer();
    }
    function proximo(m) { irPara(atual + 1, m); }
    function anterior(m) { irPara(atual - 1, m); }

    function clicar(i) {
      if (i !== atual) { irPara(i, true); return; }
      var v = videos[i], s = $('ckvSom' + i);
      if (v.muted) {
        v.muted = false; v.play()['catch'](function () {});
        if (s) s.innerHTML = SOM_ON;
        pausado = true; pararTimer();
      } else {
        v.muted = true;
        if (s) s.innerHTML = SOM_OFF;
        pausado = false; reiniciarTimer();
      }
    }

    function iniciarTimer() {
      pararTimer();
      if (pausado || reduzMovimento()) return;
      timer = setInterval(function () { if (!pausado) proximo(false); }, ROT_MS);
    }
    function pararTimer() { if (timer) { clearInterval(timer); timer = null; } }
    function reiniciarTimer() { iniciarTimer(); }

    function init(opcoes) {
      var o = opcoes || {};
      palco = o.palco || $('ckvCfStage');
      dots  = o.dots  || $('ckvCfDots');
      if (!palco || !dots) return;

      var lista = o.lista || CKConv.DEPOIMENTOS;
      total = lista.length;

      lista.forEach(function (t, i) {
        var item = document.createElement('div');
        item.className = 'ckv-cf-item';
        item.setAttribute('data-i', i);
        item.innerHTML =
          '<div class="ckv-cf-som" id="ckvSom' + i + '">' + SOM_OFF + '</div>' +
          '<video src="' + esc(t.src) + '" muted loop playsinline preload="metadata" poster="' + esc(t.foto) + '"></video>' +
          '<div class="ckv-cf-legenda">' +
            '<div class="ckv-cf-pessoa"><img src="' + esc(t.foto) + '" alt="">' +
              '<span class="ckv-cf-pessoa-nome">' + esc(t.nome) + '</span></div>' +
            '<div class="ckv-cf-quote">' + esc(t.quote) + '</div>' +
          '</div>';
        item.addEventListener('click', function () { clicar(i); });
        palco.appendChild(item);

        var dot = document.createElement('div');
        dot.className = 'ckv-cf-dot';
        dot.addEventListener('click', function () { irPara(i, true); });
        dots.appendChild(dot);
      });

      itens  = palco.querySelectorAll('.ckv-cf-item');
      videos = palco.querySelectorAll('video');
      dotEls = dots.querySelectorAll('.ckv-cf-dot');

      var bPrev = o.prev || $('ckvCfPrev');
      var bNext = o.next || $('ckvCfNext');
      if (bPrev) bPrev.addEventListener('click', function () { anterior(true); });
      if (bNext) bNext.addEventListener('click', function () { proximo(true); });

      var tX = null;
      palco.addEventListener('touchstart', function (e) { tX = e.touches[0].clientX; }, { passive: true });
      palco.addEventListener('touchend', function (e) {
        if (tX === null) return;
        var dx = e.changedTouches[0].clientX - tX;
        if (Math.abs(dx) > 40) { dx < 0 ? proximo(true) : anterior(true); }
        tX = null;
      });

      render();
      iniciarTimer();
    }

    return { init: init, proximo: proximo, anterior: anterior };
  })();

  // ══════════════════════════════════════════════════════════
  // MODAL — o projeto não usa alert()/confirm() nativos
  // ══════════════════════════════════════════════════════════
  CKConv.modal = (function () {
    var fundo = null, resolver = null;

    function montar() {
      if (fundo) return;
      fundo = document.createElement('div');
      fundo.className = 'ckv-modal-fundo';
      fundo.innerHTML =
        '<div class="ckv-modal" role="dialog" aria-modal="true">' +
          '<div class="ckv-modal-t"></div>' +
          '<div class="ckv-modal-c"></div>' +
          '<div class="ckv-modal-acoes"></div>' +
        '</div>';
      document.body.appendChild(fundo);
      fundo.addEventListener('click', function (e) {
        if (e.target === fundo) fechar(false);
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && fundo.classList.contains('aberto')) fechar(false);
      });
    }

    function fechar(v) {
      if (!fundo) return;
      fundo.classList.remove('aberto');
      var r = resolver; resolver = null;
      if (r) r(v);
    }

    function abrir(titulo, corpo, opcoes) {
      montar();
      var o = opcoes || {};
      fundo.querySelector('.ckv-modal-t').textContent = titulo;
      fundo.querySelector('.ckv-modal-c').textContent = corpo;

      var acoes = fundo.querySelector('.ckv-modal-acoes');
      acoes.innerHTML = '';
      if (o.cancelar) {
        var bc = document.createElement('button');
        bc.className = 'ckv-modal-btn secundario';
        bc.textContent = o.cancelar;
        bc.addEventListener('click', function () { fechar(false); });
        acoes.appendChild(bc);
      }
      var bo = document.createElement('button');
      bo.className = 'ckv-modal-btn';
      bo.textContent = o.confirmar || 'Entendi';
      bo.addEventListener('click', function () { fechar(true); });
      acoes.appendChild(bo);

      fundo.classList.add('aberto');
      setTimeout(function () { bo.focus(); }, 60);
      return new Promise(function (res) { resolver = res; });
    }

    return {
      avisar:    function (t, c, b) { return abrir(t, c, { confirmar: b || 'Entendi' }); },
      confirmar: function (t, c, b, x) { return abrir(t, c, { confirmar: b || 'Confirmar', cancelar: x || 'Cancelar' }); }
    };
  })();

  // ── FAQ (acordeão) ────────────────────────────────────────
  CKConv.faq = {
    init: function (seletor) {
      var itens = document.querySelectorAll((seletor || '.ckv-faq') + ' .ckv-faq-item');
      Array.prototype.forEach.call(itens, function (item) {
        var q = item.querySelector('.ckv-faq-q');
        if (!q) return;
        q.setAttribute('aria-expanded', 'false');
        q.addEventListener('click', function () {
          var abre = !item.classList.contains('aberto');
          Array.prototype.forEach.call(itens, function (o) {
            o.classList.remove('aberto');
            var oq = o.querySelector('.ckv-faq-q');
            if (oq) oq.setAttribute('aria-expanded', 'false');
          });
          if (abre) { item.classList.add('aberto'); q.setAttribute('aria-expanded', 'true'); }
        });
      });
    }
  };

  // ══════════════════════════════════════════════════════════
  // LOTE / TURMA — escassez REAL (v152)
  // ----------------------------------------------------------
  // O checkout sem cartão derivava "vagas restantes" do dia da
  // semana: o número caía sozinho sem ninguém comprar. Aqui o
  // backend devolve total do lote menos quem entrou depois da
  // abertura. Sem lote configurado, `lote` vem null e o bloco
  // nem aparece.
  // ══════════════════════════════════════════════════════════
  CKConv.lote = {
    init: function (opcoes) {
      var o = opcoes || {};
      var el = o.el || $('ckvLote');
      if (!el) return Promise.resolve();

      return CKConv.dados(o.endpoint).then(function (d) {
        var l = d && d.lote;
        if (!l) { el.style.display = 'none'; return; }

        var t = el.querySelector('.ckv-lote-t');
        if (l.esgotado) {
          el.classList.add('esgotado');
          if (t) t.innerHTML = '<strong>Lote esgotado.</strong> Entre agora para a lista do próximo.';
        } else {
          if (t) {
            t.innerHTML = '<strong>' + l.restantes +
              (l.restantes === 1 ? ' vaga restante' : ' vagas restantes') + '</strong> ' +
              esc(l.nome ? ('na ' + l.nome) : 'neste lote');
          }
        }
        var fill = el.querySelector('.ckv-lote-fill');
        if (fill) setTimeout(function () { fill.style.width = l.ocupacao + '%'; }, 250);
        el.style.display = 'flex';
      })['catch'](function () { el.style.display = 'none'; });
    }
  };

  // ══════════════════════════════════════════════════════════
  // BARRA DE ALUNOS — fotos reais das alunas + contagem real
  // ══════════════════════════════════════════════════════════
  CKConv.alunos = {
    init: function (opcoes) {
      var o = opcoes || {};
      var el = o.el || $('ckvAlunos');
      if (!el) return Promise.resolve();

      return CKConv.dados(o.endpoint).then(function (d) {
        var total = (d && d.totalAlunos) || 0;
        if (!total) { el.style.display = 'none'; return; }

        // As fotos são das alunas que gravaram depoimento — gente real,
        // com o rosto já publicado por elas nos vídeos desta página.
        var fotos = (o.fotos || CKConv.DEPOIMENTOS.map(function (t) { return t.foto; })).slice(0, 7);
        var restante = Math.max(0, total - fotos.length);

        var pilha = el.querySelector('.ckv-alunos-fotos');
        if (pilha) {
          pilha.innerHTML = fotos.map(function (f) {
            return '<img src="' + esc(f) + '" alt="" loading="lazy">';
          }).join('') + (restante ? '<div class="ckv-alunos-mais">+' + restante + '</div>' : '');
        }
        var txt = el.querySelector('.ckv-alunos-txt');
        if (txt) {
          txt.innerHTML = '<strong>' + total + ' alunos</strong> já entraram no Desafio 21 Dias' +
            (d.ultimos30 ? '<br><span>' + d.ultimos30 + ' nos últimos 30 dias</span>' : '');
        }
        el.style.display = 'flex';
      })['catch'](function () { el.style.display = 'none'; });
    }
  };

  // ══════════════════════════════════════════════════════════
  // EXIT INTENT — uma vez por sessão
  // ══════════════════════════════════════════════════════════
  CKConv.exitIntent = {
    init: function (opcoes) {
      var o = opcoes || {};
      var el = o.el || $('ckvExit');
      if (!el) return;

      var jaMostrou = false;
      try { jaMostrou = sessionStorage.getItem('ckv_exit') === '1'; } catch (e) {}

      function abrir() {
        if (jaMostrou) return;
        if (typeof o.podeAbrir === 'function' && !o.podeAbrir()) return;
        jaMostrou = true;
        try { sessionStorage.setItem('ckv_exit', '1'); } catch (e) {}
        el.classList.add('show');
      }
      function fechar() { el.classList.remove('show'); }

      // Desktop: mouse saindo pelo topo (indo para a barra de endereço)
      document.addEventListener('mouseout', function (e) {
        if (e.clientY <= 0 && !e.relatedTarget && !e.toElement) abrir();
      });

      // Mobile: não existe "sair pelo topo". O gatilho é o botão
      // voltar — empurramos um estado no histórico e interceptamos.
      if (ehMobile()) {
        try {
          history.pushState({ ckv: 1 }, '');
          window.addEventListener('popstate', function () {
            if (!jaMostrou) { abrir(); history.pushState({ ckv: 1 }, ''); }
          });
        } catch (e) {}
      }

      var btn = el.querySelector('.ckv-exit-btn');
      var fec = el.querySelector('.ckv-exit-fechar');
      if (btn) btn.addEventListener('click', function () {
        fechar();
        if (typeof o.aoContinuar === 'function') o.aoContinuar();
      });
      if (fec) fec.addEventListener('click', fechar);
      el.addEventListener('click', function (e) { if (e.target === el) fechar(); });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && el.classList.contains('show')) fechar();
      });
    }
  };

  raiz.CKConv = CKConv;
})(window);
