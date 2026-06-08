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

  function init(){
    ensureWrap();
    initObserver();
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
