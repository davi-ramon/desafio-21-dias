/* ============================================================
   vsl-player.js — Player VSL high-conversion (Desafio 21 Dias)
   <div class="vsl-player" data-vsl-src="..." [data-dias="7"]>
   - vídeo vertical 9:16, autoplay mutado, sem loop, sem seek
   - 1º clique: ativa áudio + reinicia + centraliza
   - barra de progresso psicológica (3 fases)
   - PiP custom: FLIP animado, drag & drop, snap nos 4 cantos
   - tracking VSL_* + PIP_* via Pixel E CAPI (GAS) c/ dedup
   ============================================================ */
(function(){
  'use strict';

  var GAS = 'https://script.google.com/macros/s/AKfycbx9ypaZFGLIFkCVbV2LmvSv-dZIUZvMGvhJDnG2unhCwlaVTnBMU1anbbLa15h0aKxi/exec';

  // ── Whitelist de navegação do funil ──
  // Clique em qualquer link/CTA real libera o beforeunload (avanço intencional).
  // Fechar aba / F5 / voltar / digitar URL continuam protegidos.
  var allowNav = false;
  function armNavWhitelist(){
    document.addEventListener('click', function(e){
      var a = e.target.closest ? e.target.closest('a[href], button[type="submit"], .cta-btn, [data-cta]') : null;
      if(!a) return;
      if(a.tagName === 'A'){
        var href = (a.getAttribute('href')||'').toLowerCase();
        var tgt  = (a.getAttribute('target')||'');
        if(tgt === '_blank') return;                 // nova aba não dispara beforeunload
        if(!href || href.charAt(0)==='#' || href.indexOf('javascript:')===0) return;
      }
      allowNav = true;
      setTimeout(function(){ allowNav = false; }, 2000); // reset se a navegação não ocorrer
    }, true);
  }

  function getCookie(n){ var m=document.cookie.match('(^|;)\\s*'+n+'\\s*=\\s*([^;]+)'); return m?m.pop():''; }
  function diasFromUrl(){ var d=parseInt(new URLSearchParams(location.search).get('dias'))||7; return [7,14,21].indexOf(d)<0?7:d; }

  // dispara para Pixel (com eventID) E CAPI (servidor) usando o MESMO id → dedup
  function trackEvent(name){
    var id = name + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
    try{ if(typeof fbq==='function') fbq('trackCustom', name, {}, {eventID:id}); }catch(e){}
    try{
      fetch(GAS,{
        method:'POST', headers:{'Content-Type':'text/plain'}, keepalive:true,
        body: JSON.stringify({ action:'trackVsl', data:{
          event_name:name, event_id:id, dias:diasFromUrl(),
          fbp:getCookie('_fbp'), fbc:getCookie('_fbc'),
          client_ua:navigator.userAgent, url:location.href
        }})
      }).catch(function(){});
    }catch(e){}
  }

  function buildPlayer(mount){
    var src = mount.getAttribute('data-vsl-src');
    if(!src) return;
    mount.classList.add('vslp');

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

    var originalParent = mount.parentNode;
    var placeholder = document.createElement('div');
    placeholder.className = 'vslp-placeholder';
    originalParent.insertBefore(placeholder, mount.nextSibling);

    video.src = src; video.muted = true; video.loop = false;

    var started=false, fired={}, pipOn=false, pipClosed=false;
    var pipCorner='br', dragging=false, dragMoved=false, dragDX=0, dragDY=0;
    var PIP_MARGIN=16;

    video.play().catch(function(){});

    function visualPct(r){
      if(r<=0.25) return (r/0.25)*50;
      if(r<=0.55) return 50+((r-0.25)/0.30)*30;
      return Math.min(100, 80+((r-0.55)/0.45)*20);
    }
    function setIcon(paused){
      icPlay.style.display=paused?'':'none';
      icPause.style.display=paused?'none':'';
      mount.classList.toggle('paused',paused);
    }

    function activate(){
      if(started) return;
      started=true;
      unmute.classList.add('hidden');
      video.currentTime=0; video.muted=false; video.volume=1;
      video.play().catch(function(){});
      setIcon(false);
      trackEvent('VSL_STARTED');
      try{ mount.scrollIntoView({behavior:'smooth',block:'center'}); }catch(e){}
      enableBeforeUnload();
    }
    function togglePlay(){
      if(video.paused){ video.play().catch(function(){}); pauseModal.classList.remove('show'); setIcon(false); }
      else { video.pause(); setIcon(true); pauseModal.classList.add('show'); }
    }

    mount.addEventListener('click', function(e){
      if(dragMoved) return;                        // ignora clique que foi drag
      if(pipClose.contains(e.target)) return;
      if(pauseModal.contains(e.target)) return;
      if(!started){ activate(); return; }
      togglePlay();
    });
    pauseModal.querySelector('.vslp-pausemodal-btn').addEventListener('click', function(e){
      e.stopPropagation(); video.play().catch(function(){}); pauseModal.classList.remove('show'); setIcon(false);
    });

    video.addEventListener('timeupdate', function(){
      if(!video.duration) return;
      var r=video.currentTime/video.duration;
      fill.style.width=visualPct(r).toFixed(1)+'%';
      [['VSL_25',0.25],['VSL_50',0.50],['VSL_75',0.75],['VSL_95',0.95]].forEach(function(m){
        if(!fired[m[0]] && r>=m[1]){ fired[m[0]]=true; trackEvent(m[0]); }
      });
    });
    video.addEventListener('ended', function(){
      if(!fired.done){ fired.done=true; trackEvent('VSL_COMPLETED'); }
      setIcon(true);
    });

    // ── PIP corner positions ──
    function cornerPos(corner){
      var w=mount.offsetWidth || 150, h=mount.offsetHeight || 267;
      var vw=window.innerWidth, vh=window.innerHeight;
      var L = (corner.indexOf('l')>=0) ? PIP_MARGIN : (vw - w - PIP_MARGIN);
      var T = (corner.indexOf('t')>=0) ? PIP_MARGIN : (vh - h - PIP_MARGIN);
      return {left:L, top:T};
    }
    function applyCorner(corner, animate){
      pipCorner=corner;
      var p=cornerPos(corner);
      if(!animate) mount.classList.add('vslp-flip');
      mount.style.left=p.left+'px';
      mount.style.top =p.top +'px';
      if(!animate){ mount.offsetHeight; mount.classList.remove('vslp-flip'); }
    }

    // FLIP: anima do lugar original → canto (entrada) e vice-versa (saída)
    function enterPip(){
      if(pipOn||pipClosed||!started) return;
      pipOn=true;
      var rect0=mount.getBoundingClientRect();
      placeholder.style.height=rect0.height+'px';
      placeholder.style.width=rect0.width+'px';
      placeholder.classList.add('active');

      // PORTAL: move pro <body> p/ escapar de stacking contexts
      // (ancestrais com transform/overflow prendiam o position:fixed)
      document.body.appendChild(mount);

      mount.classList.add('vslp-pip','vslp-flip');
      var p=cornerPos(pipCorner);
      mount.style.left=p.left+'px'; mount.style.top=p.top+'px';
      var destW=mount.offsetWidth;
      // transform inverso → parece estar na posição original
      var dx=rect0.left-p.left, dy=rect0.top-p.top, sc=rect0.width/destW;
      mount.style.transformOrigin='top left';
      mount.style.transform='translate('+dx+'px,'+dy+'px) scale('+sc+')';
      mount.offsetHeight; // reflow
      mount.classList.remove('vslp-flip');
      mount.style.transform='';   // anima até o canto
      trackEvent('PIP_ENTER');
    }
    function exitPip(){
      if(!pipOn) return;
      pipOn=false;
      var rect0=placeholder.getBoundingClientRect();
      var cur=mount.getBoundingClientRect();
      var dx=rect0.left-cur.left, dy=rect0.top-cur.top, sc=rect0.width/cur.width;
      mount.style.transformOrigin='top left';
      mount.style.transform='translate('+dx+'px,'+dy+'px) scale('+sc+')';
      var done=function(){
        mount.removeEventListener('transitionend',done);
        mount.classList.remove('vslp-pip');
        mount.style.left=''; mount.style.top=''; mount.style.transform='';
        // PORTAL: devolve ao lugar original (antes do placeholder)
        originalParent.insertBefore(mount, placeholder);
        placeholder.classList.remove('active'); placeholder.style.height=''; placeholder.style.width='';
      };
      mount.addEventListener('transitionend',done);
      setTimeout(done,520); // fallback
      trackEvent('PIP_EXIT');
    }

    // visibilidade por scroll (threshold ~50%)
    function visRatio(el){
      var r=el.getBoundingClientRect(), vh=window.innerHeight;
      var vis=Math.max(0, Math.min(r.bottom,vh)-Math.max(r.top,0));
      return r.height>0 ? vis/r.height : 0;
    }
    function checkPip(){
      if(!started||pipClosed||dragging) return;
      if(!pipOn){ if(visRatio(mount) < 0.5) enterPip(); }
      else { if(visRatio(placeholder) >= 0.6) exitPip(); }
    }
    window.addEventListener('scroll', checkPip, {passive:true});
    window.addEventListener('resize', function(){ if(pipOn) applyCorner(pipCorner,false); checkPip(); }, {passive:true});

    // ── DRAG & DROP + SNAP ──
    function onDown(e){
      if(!pipOn) return;
      if(pipClose.contains(e.target)) return;
      dragging=true; dragMoved=false;
      mount.classList.add('vslp-dragging');
      var pt=e.touches?e.touches[0]:e;
      var r=mount.getBoundingClientRect();
      dragDX=pt.clientX-r.left; dragDY=pt.clientY-r.top;
      e.preventDefault();
    }
    function onMove(e){
      if(!dragging) return;
      var pt=e.touches?e.touches[0]:e;
      var L=pt.clientX-dragDX, T=pt.clientY-dragDY;
      // limita à viewport
      var w=mount.offsetWidth, h=mount.offsetHeight;
      L=Math.max(4, Math.min(L, window.innerWidth-w-4));
      T=Math.max(4, Math.min(T, window.innerHeight-h-4));
      mount.style.left=L+'px'; mount.style.top=T+'px';
      dragMoved=true;
    }
    function onUp(){
      if(!dragging) return;
      dragging=false;
      mount.classList.remove('vslp-dragging');
      // snap pro canto mais próximo
      var r=mount.getBoundingClientRect();
      var cx=r.left+r.width/2, cy=r.top+r.height/2;
      var corner=(cy<window.innerHeight/2?'t':'b')+(cx<window.innerWidth/2?'l':'r');
      applyCorner(corner, true);
      setTimeout(function(){ dragMoved=false; }, 50);
    }
    mount.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    mount.addEventListener('touchstart', onDown, {passive:false});
    window.addEventListener('touchmove', onMove, {passive:false});
    window.addEventListener('touchend', onUp);

    pipClose.addEventListener('click', function(e){
      e.stopPropagation(); pipClosed=true; exitPip(); video.pause(); setIcon(true);
    });

    var beforeUnloadOn=false;
    function enableBeforeUnload(){
      if(beforeUnloadOn) return; beforeUnloadOn=true;
      window.addEventListener('beforeunload', function(e){
        if(fired.done) return;     // já viu a VSL toda
        if(allowNav) return;       // clicou num CTA/link do funil → não atrapalha
        e.preventDefault(); e.returnValue=''; return '';
      });
    }
  }

  function initExitIntent(){
    if(window.matchMedia('(max-width:1100px)').matches) return;
    var overlay=document.createElement('div');
    overlay.className='vslp-exit-overlay';
    overlay.innerHTML=
      '<div class="vslp-exit-modal">' +
        '<div class="vslp-exit-icon"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>' +
        '<div class="vslp-exit-title">Espere. Você realmente quer sair antes de entender como funciona o Desafio 21 Dias?</div>' +
        '<div class="vslp-exit-sub">Seu acesso gratuito continua disponível.</div>' +
        '<button class="vslp-exit-primary" type="button">Continuar assistindo</button>' +
        '<button class="vslp-exit-secondary" type="button">Sair mesmo assim</button>' +
      '</div>';
    document.body.appendChild(overlay);
    var shown=false;
    function open(){ if(shown||sessionStorage.getItem('vslpExitShown'))return; shown=true; sessionStorage.setItem('vslpExitShown','1'); overlay.classList.add('show'); trackEvent('LandingExitIntent'); }
    function close(){ overlay.classList.remove('show'); }
    document.addEventListener('mouseout', function(e){ if(e.clientY<=0 && !e.relatedTarget && !e.toElement) open(); });
    overlay.querySelector('.vslp-exit-primary').addEventListener('click', function(){ close(); var v=document.querySelector('.vslp'); if(v) v.scrollIntoView({behavior:'smooth',block:'center'}); });
    overlay.querySelector('.vslp-exit-secondary').addEventListener('click', close);
    overlay.addEventListener('click', function(e){ if(e.target===overlay) close(); });
  }

  function init(){
    var mounts=document.querySelectorAll('.vsl-player[data-vsl-src]');
    if(!mounts.length) return;
    armNavWhitelist();
    mounts.forEach(buildPlayer);
    initExitIntent();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
