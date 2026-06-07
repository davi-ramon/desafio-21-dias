/* ============================================================
   vsl-player.js — Player VSL high-conversion (Desafio 21 Dias)
   Monta-se sobre: <div class="vsl-player" data-vsl-src="...">
   - autoplay mutado, sem loop, sem seek
   - 1º clique: ativa áudio + reinicia + centraliza
   - barra de progresso psicológica (3 fases)
   - tracking VSL_STARTED / 25 / 50 / 75 / 95 / COMPLETED
   - PiP custom ao rolar
   - modal de pausa + exit-intent + beforeunload
   ============================================================ */
(function(){
  'use strict';

  function track(name, params){
    try{ if(typeof fbq === 'function') fbq('trackCustom', name, params || {}); }catch(e){}
  }

  function buildPlayer(mount){
    var src = mount.getAttribute('data-vsl-src');
    if(!src) return;

    mount.classList.add('vslp');

    // ── estrutura interna ──
    mount.innerHTML =
      '<video playsinline muted preload="auto" webkit-playsinline></video>' +
      '<div class="vslp-progress"><div class="vslp-progress-fill"></div></div>' +
      '<div class="vslp-playpause">' +
        '<svg class="vslp-ic-pause" width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>' +
        '<svg class="vslp-ic-play" width="26" height="26" viewBox="0 0 24 24" fill="currentColor" style="display:none;margin-left:3px"><path d="M8 5v14l11-7z"/></svg>' +
      '</div>' +
      '<div class="vslp-pausemodal">' +
        '<div class="vslp-pausemodal-title">⚠ Esta oferta pode não permanecer disponível para sempre.</div>' +
        '<div class="vslp-pausemodal-sub">Continue assistindo até o final para entender tudo antes de tomar sua decisão.</div>' +
        '<button class="vslp-pausemodal-btn" type="button">Continuar assistindo</button>' +
      '</div>' +
      '<div class="vslp-unmute">' +
        '<div class="vslp-unmute-icon"><svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>' +
        '<div class="vslp-unmute-text">▶ O vídeo já começou.<br>Clique para ativar o áudio.</div>' +
        '<div class="vslp-unmute-sub">Toque em qualquer lugar do vídeo</div>' +
      '</div>' +
      '<button class="vslp-pip-close" type="button" aria-label="Fechar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
      '<span class="vslp-pip-label">● Assistindo</span>';

    var video      = mount.querySelector('video');
    var unmute     = mount.querySelector('.vslp-unmute');
    var pauseModal = mount.querySelector('.vslp-pausemodal');
    var fill       = mount.querySelector('.vslp-progress-fill');
    var icPlay     = mount.querySelector('.vslp-ic-play');
    var icPause    = mount.querySelector('.vslp-ic-pause');
    var pipClose   = mount.querySelector('.vslp-pip-close');

    // placeholder p/ segurar layout no PiP
    var placeholder = document.createElement('div');
    placeholder.className = 'vslp-placeholder';
    mount.parentNode.insertBefore(placeholder, mount.nextSibling);

    video.src = src;
    video.muted = true;
    video.loop = false;

    var started   = false;   // áudio ativado (1º clique dado)
    var fired      = {};      // marcos de tracking
    var pipOn     = false;
    var pipClosed = false;

    // autoplay mudo
    video.play().catch(function(){ /* alguns browsers exigem gesto; overlay cobre isso */ });

    // ── barra psicológica: real → visual ──
    function visualPct(r){
      if(r <= 0.25) return (r/0.25)*50;             // rápido
      if(r <= 0.55) return 50 + ((r-0.25)/0.30)*30; // normal
      return Math.min(100, 80 + ((r-0.55)/0.45)*20);// lento
    }

    function setIcon(paused){
      icPlay.style.display  = paused ? '' : 'none';
      icPause.style.display = paused ? 'none' : '';
      mount.classList.toggle('paused', paused);
    }

    // ── 1º clique: ativa áudio, reinicia, centraliza ──
    function activate(){
      if(started) return;
      started = true;
      unmute.classList.add('hidden');
      video.currentTime = 0;
      video.muted = false;
      video.volume = 1;
      video.play().catch(function(){});
      setIcon(false);
      track('VSL_STARTED');
      // centraliza a VSL na viewport
      try{ mount.scrollIntoView({behavior:'smooth', block:'center'}); }catch(e){}
      // ativa proteção de saída só depois que engajou
      enableBeforeUnload();
    }

    // ── play/pause (após ativado) ──
    function togglePlay(){
      if(video.paused){
        video.play().catch(function(){});
        pauseModal.classList.remove('show');
        setIcon(false);
      } else {
        video.pause();
        setIcon(true);
        pauseModal.classList.add('show');  // modal de pausa
      }
    }

    // clique no container
    mount.addEventListener('click', function(e){
      if(e.target === pipClose || pipClose.contains(e.target)) return;
      if(pauseModal.contains(e.target)) return;
      if(!started){ activate(); return; }
      togglePlay();
    });

    pauseModal.querySelector('.vslp-pausemodal-btn').addEventListener('click', function(e){
      e.stopPropagation();
      video.play().catch(function(){});
      pauseModal.classList.remove('show');
      setIcon(false);
    });

    // ── progresso + marcos ──
    video.addEventListener('timeupdate', function(){
      if(!video.duration) return;
      var r = video.currentTime / video.duration;
      fill.style.width = visualPct(r).toFixed(1) + '%';

      [['VSL_25',0.25],['VSL_50',0.50],['VSL_75',0.75],['VSL_95',0.95]].forEach(function(m){
        if(!fired[m[0]] && r >= m[1]){ fired[m[0]] = true; track(m[0]); }
      });
    });
    video.addEventListener('ended', function(){
      if(!fired.done){ fired.done = true; track('VSL_COMPLETED'); }
      setIcon(true);
    });

    // ── PiP custom ao rolar ──
    function enterPip(){
      if(pipOn || pipClosed) return;
      pipOn = true;
      placeholder.style.height = mount.offsetHeight + 'px';
      placeholder.classList.add('active');
      mount.classList.add('vslp-pip');
    }
    function exitPip(){
      if(!pipOn) return;
      pipOn = false;
      mount.classList.remove('vslp-pip');
      placeholder.classList.remove('active');
      placeholder.style.height = '';
    }
    function checkPip(){
      if(!started || pipClosed) return;
      var ref = pipOn ? placeholder : mount;
      var rect = ref.getBoundingClientRect();
      if(!pipOn && rect.bottom < 60){ enterPip(); }
      else if(pipOn && rect.top > -40 && rect.top < window.innerHeight){ exitPip(); }
    }
    window.addEventListener('scroll', checkPip, {passive:true});
    window.addEventListener('resize', checkPip, {passive:true});

    pipClose.addEventListener('click', function(e){
      e.stopPropagation();
      pipClosed = true;
      exitPip();
      video.pause();
      setIcon(true);
    });

    // ── beforeunload (proteção de saída) ──
    var beforeUnloadOn = false;
    function enableBeforeUnload(){
      if(beforeUnloadOn) return;
      beforeUnloadOn = true;
      window.addEventListener('beforeunload', function(e){
        if(fired.done) return;            // já viu tudo, não atrapalha
        e.preventDefault();
        e.returnValue = '';
        return '';
      });
    }
  }

  // ── EXIT-INTENT da landing (modal) ──
  function initExitIntent(){
    if(window.matchMedia('(max-width:1100px)').matches) return; // desktop only
    var overlay = document.createElement('div');
    overlay.className = 'vslp-exit-overlay';
    overlay.innerHTML =
      '<div class="vslp-exit-modal">' +
        '<div class="vslp-exit-icon"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>' +
        '<div class="vslp-exit-title">Espere. Você realmente quer sair antes de entender como funciona o Desafio 21 Dias?</div>' +
        '<div class="vslp-exit-sub">Seu acesso gratuito continua disponível.</div>' +
        '<button class="vslp-exit-primary" type="button">Continuar assistindo</button>' +
        '<button class="vslp-exit-secondary" type="button">Sair mesmo assim</button>' +
      '</div>';
    document.body.appendChild(overlay);

    var shown = false;
    function open(){
      if(shown || sessionStorage.getItem('vslpExitShown')) return;
      shown = true; sessionStorage.setItem('vslpExitShown','1');
      overlay.classList.add('show');
      track('LandingExitIntent');
    }
    function close(){ overlay.classList.remove('show'); }

    document.addEventListener('mouseout', function(e){
      if(e.clientY <= 0 && !e.relatedTarget && !e.toElement){ open(); }
    });
    overlay.querySelector('.vslp-exit-primary').addEventListener('click', function(){
      close();
      var v = document.querySelector('.vslp'); if(v) v.scrollIntoView({behavior:'smooth',block:'center'});
    });
    overlay.querySelector('.vslp-exit-secondary').addEventListener('click', close);
    overlay.addEventListener('click', function(e){ if(e.target === overlay) close(); });
  }

  function init(){
    var mounts = document.querySelectorAll('.vsl-player[data-vsl-src]');
    if(!mounts.length) return;
    mounts.forEach(buildPlayer);
    initExitIntent();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
