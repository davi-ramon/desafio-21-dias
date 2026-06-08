/* ============================================================
   app-enhance.js — Fase 1 (UX premium) — Desafio 21 Dias
   Camada aditiva, não-invasiva. Tilt 3D + som + toast.
   Expõe window.appToast(msg,tipo) e window.appFx p/ uso futuro.
   ============================================================ */
(function(){
  'use strict';

  var reduced  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isDesktop = function(){ return window.innerWidth >= 1024; };

  /* ───────── SOM (Web Audio, leve) ───────── */
  var SOM_OFF = false;
  try { SOM_OFF = localStorage.getItem('app_fx_mute') === '1'; } catch(e){}
  var _ctx = null;
  function ctx(){ try { if(!_ctx) _ctx = new (window.AudioContext||window.webkitAudioContext)(); return _ctx; } catch(e){ return null; } }
  function beep(freqStart, freqEnd, dur, vol){
    if(SOM_OFF) return;
    var c = ctx(); if(!c) return;
    try {
      var o = c.createOscillator(), g = c.createGain();
      o.connect(g); g.connect(c.destination);
      o.type = 'sine';
      o.frequency.setValueAtTime(freqStart, c.currentTime);
      o.frequency.exponentialRampToValueAtTime(freqEnd, c.currentTime + dur);
      g.gain.setValueAtTime(vol || 0.06, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.start(c.currentTime); o.stop(c.currentTime + dur);
    } catch(e){}
  }
  function fxClick(){ beep(620, 480, 0.08, 0.05); }
  function fxSuccess(){ beep(660, 880, 0.12, 0.07); setTimeout(function(){ beep(880, 1100, 0.14, 0.06); }, 90); }

  /* ───────── TOAST ───────── */
  var wrap;
  function ensureWrap(){
    if(wrap) return wrap;
    wrap = document.createElement('div'); wrap.id = 'appToastWrap';
    document.body.appendChild(wrap);
    return wrap;
  }
  var ICONES = { success:'✓', info:'ℹ', warning:'⚠', error:'✕' };
  function appToast(msg, tipo){
    tipo = tipo || 'success';
    ensureWrap();
    var t = document.createElement('div');
    t.className = 'app-toast t-' + tipo;
    t.innerHTML = '<span class="at-ico">' + (ICONES[tipo]||'✓') + '</span><span>' + String(msg) + '</span>';
    wrap.appendChild(t);
    requestAnimationFrame(function(){ t.classList.add('show'); });
    setTimeout(function(){
      t.classList.remove('show');
      setTimeout(function(){ if(t.parentNode) t.parentNode.removeChild(t); }, 350);
    }, 3200);
  }

  /* expõe pro app usar nos pontos certos (futuro) */
  window.appToast = appToast;
  window.appFx = {
    click: fxClick,
    success: function(msg){ fxSuccess(); if(msg) appToast(msg, 'success'); },
    toast: appToast,
    setMute: function(v){ SOM_OFF = !!v; try{ localStorage.setItem('app_fx_mute', v?'1':'0'); }catch(e){} },
    isMuted: function(){ return SOM_OFF; }
  };

  /* ───────── TILT 3D ───────── */
  var TILT_SEL = '.card, .audio-card, .hero, .msg-dinamica';
  function aplicarTilt(){
    if(reduced || !isDesktop() || !window.VanillaTilt) return;
    var els = document.querySelectorAll(TILT_SEL);
    var novos = [];
    els.forEach(function(el){
      if(el.getAttribute('data-tilt-init')) return;
      // não aplica em cards muito largos (hero ocupa linha toda) → tilt menor
      el.setAttribute('data-tilt-init','1');
      novos.push(el);
    });
    if(novos.length && window.VanillaTilt){
      window.VanillaTilt.init(novos, {
        max: 6, speed: 400, glare: true, 'max-glare': 0.12,
        scale: 1.012, gyroscope: false, perspective: 1200
      });
    }
  }

  /* ───────── DELEGATION (som de clique tátil) ───────── */
  document.addEventListener('click', function(e){
    var alvo = e.target.closest('.pilar-item:not(.locked), .card[onclick], .audio-card, .nav-btn, button, .btn, [role="button"]');
    if(!alvo) return;
    fxClick();
  }, true);

  /* ───────── OBSERVER: reaplica tilt após re-render ───────── */
  function initObserver(){
    var alvo = document.getElementById('mainScroll') || document.body;
    var deb;
    var mo = new MutationObserver(function(){
      clearTimeout(deb);
      deb = setTimeout(aplicarTilt, 180);
    });
    mo.observe(alvo, { childList: true, subtree: true });
    aplicarTilt();
  }

  /* ───────── FASE 2: Notification ticker ───────── */
  var tickerEl, tickerInner, fila = [], filaIdx = 0, tickerTimer;
  function tipoDoBanner(cls){
    cls = cls || '';
    if(/sub-red|sub-blocked/.test(cls)) return 'urgent';
    if(/sub-warning|sub-yellow/.test(cls)) return 'warning';
    if(/sub-success|sub-green/.test(cls)) return 'success';
    return 'info';
  }
  var TICK_ICO = { info:'ℹ️', success:'✅', warning:'⚠️', urgent:'🔴' };
  function buildTicker(){
    var bar = document.querySelector('.topbar'); if(!bar || tickerEl) return;
    var right = bar.querySelector('.topbar-right');
    tickerEl = document.createElement('div');
    tickerEl.className = 'notif-ticker t-info';
    tickerInner = document.createElement('div');
    tickerInner.className = 'notif-ticker-item';
    tickerEl.appendChild(tickerInner);
    bar.insertBefore(tickerEl, right || null);

    // lê o subBanner (status assinatura) e observa mudanças
    var sb = document.getElementById('subBanner');
    function syncFromBanner(){
      if(!sb) return;
      var txt = (sb.textContent || '').trim();
      // remove notif de banner antiga da fila
      fila = fila.filter(function(f){ return f.src !== 'banner'; });
      if(txt) fila.unshift({ src:'banner', tipo:tipoDoBanner(sb.className), txt:txt });
      if(filaIdx >= fila.length) filaIdx = 0;
      renderTick();
    }
    if(sb){
      var mo = new MutationObserver(syncFromBanner);
      mo.observe(sb, { childList:true, characterData:true, subtree:true, attributes:true });
    }
    // mensagem de boas-vindas padrão caso não haja banner
    setTimeout(function(){
      syncFromBanner();
      if(!fila.length){ fila.push({ src:'sys', tipo:'success', txt:'Bem-vindo de volta! 🎯 Complete seus pilares de hoje.' }); }
      renderTick();
    }, 600);

    // rotação
    tickerTimer = setInterval(function(){
      if(fila.length <= 1) return;
      filaIdx = (filaIdx + 1) % fila.length;
      renderTick();
    }, 5000);
  }
  function renderTick(){
    if(!tickerInner || !fila.length) return;
    var item = fila[filaIdx % fila.length];
    tickerInner.classList.remove('show');
    setTimeout(function(){
      tickerEl.className = 'notif-ticker t-' + item.tipo;
      tickerInner.innerHTML = '<span class="notif-ticker-ico">' + (TICK_ICO[item.tipo]||'ℹ️') + '</span><span class="notif-ticker-txt">' + item.txt + '</span>';
      tickerInner.classList.add('show');
    }, 200);
  }
  // API pública p/ adicionar notificações ao ticker
  window.appNotify = function(txt, tipo){
    fila.push({ src:'sys', tipo: tipo||'info', txt: txt });
    renderTick();
  };

  /* ───────── FASE 2: Configurações (⚙ + drawer) ───────── */
  function buildConfig(){
    // injeta botão ⚙ no rodapé da sidebar
    var nav = document.querySelector('.bottom-nav');
    if(nav && !document.getElementById('navConfig')){
      var btn = document.createElement('button');
      btn.className = 'nav-btn nav-config'; btn.id = 'navConfig'; btn.type = 'button';
      btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg><span>Configurações</span>';
      btn.addEventListener('click', openConfig);
      nav.appendChild(btn);
    }
    // overlay/drawer
    if(document.getElementById('cfgOverlay')) return;
    var ov = document.createElement('div');
    ov.className = 'cfg-overlay'; ov.id = 'cfgOverlay';
    ov.innerHTML =
      '<div class="cfg-drawer">' +
        '<div class="cfg-head"><h2>⚙ Configurações</h2><button class="cfg-close" id="cfgClose">✕</button></div>' +
        '<div class="cfg-body" id="cfgBody"></div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function(e){ if(e.target === ov) closeConfig(); });
    document.getElementById('cfgClose').addEventListener('click', closeConfig);
  }
  function _appUser(){
    try { if(window.APP) return { nome: APP.userName||APP.nome||'', email: APP.userEmail||APP.email||'' }; } catch(e){}
    var av = document.getElementById('avatarEl');
    return { nome: (av && av.textContent) || '', email: '' };
  }
  function openConfig(){
    var u = _appUser();
    var muted = window.appFx ? window.appFx.isMuted() : false;
    var body = document.getElementById('cfgBody');
    body.innerHTML =
      '<div class="cfg-sec"><div class="cfg-sec-title">Perfil</div>' +
        '<div class="cfg-row"><div><div class="cfg-row-label">' + (u.nome||'Aluno') + '</div>' + (u.email?'<div class="cfg-row-sub">'+u.email+'</div>':'') + '</div></div>' +
      '</div>' +
      '<div class="cfg-sec"><div class="cfg-sec-title">Preferências</div>' +
        '<div class="cfg-row"><div><div class="cfg-row-label">Som do app</div><div class="cfg-row-sub">Cliques e confirmações</div></div>' +
          '<label class="cfg-switch"><input type="checkbox" id="cfgSom" ' + (muted?'':'checked') + '><span class="cfg-slider"></span></label></div>' +
        '<div class="cfg-row"><div><div class="cfg-row-label">Tema</div><div class="cfg-row-sub">Escuro (padrão)</div></div><span class="cfg-soon">em breve</span></div>' +
        '<div class="cfg-row"><div><div class="cfg-row-label">Organização dos cards</div><div class="cfg-row-sub">Arrastar e reordenar</div></div><span class="cfg-soon">Fase 3</span></div>' +
      '</div>' +
      '<div class="cfg-sec"><div class="cfg-sec-title">Notificações</div>' +
        '<div class="cfg-row"><div class="cfg-row-label">E-mail</div><span class="cfg-soon">em breve</span></div>' +
        '<div class="cfg-row"><div class="cfg-row-label">Telegram</div><span class="cfg-soon">em breve</span></div>' +
        '<div class="cfg-row"><div class="cfg-row-label">Push (celular)</div><span class="cfg-soon">em breve</span></div>' +
      '</div>' +
      '<div class="cfg-sec"><div class="cfg-sec-title">Sistema</div>' +
        '<div class="cfg-row"><div class="cfg-row-label">Versão</div><span class="cfg-val">Desafio 21 Dias · 2026.06</span></div>' +
      '</div>';
    var som = document.getElementById('cfgSom');
    if(som) som.addEventListener('change', function(){
      if(window.appFx){ window.appFx.setMute(!som.checked); if(som.checked) fxClick(); }
      appToast(som.checked?'Som ativado':'Som desativado', 'info');
    });
    document.getElementById('cfgOverlay').classList.add('show');
  }
  function closeConfig(){ var o=document.getElementById('cfgOverlay'); if(o) o.classList.remove('show'); }
  window.openConfig = openConfig;

  function init(){
    ensureWrap();
    initObserver();
    buildTicker();
    buildConfig();
    // reaplica/limpa tilt ao cruzar o breakpoint desktop/mobile
    window.addEventListener('resize', function(){
      if(!isDesktop()){
        document.querySelectorAll('[data-tilt-init]').forEach(function(el){
          if(el.vanillaTilt){ try{ el.vanillaTilt.destroy(); }catch(e){} }
          el.removeAttribute('data-tilt-init');
        });
      } else { aplicarTilt(); }
    });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
