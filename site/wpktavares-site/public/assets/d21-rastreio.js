/* ============================================================
   d21-rastreio.js — de onde a pessoa veio (v166)
   ------------------------------------------------------------
   As landings não repassam a query para o checkout: quem chegava
   por /7-dias/?utm_campaign=roteiro-05 e clicava no botão caía em
   /checkout-trial/?dias=7 — e a campanha se perdia no clique.

   Este arquivo guarda o PRIMEIRO contato (nunca sobrescrito) e o
   último contato que trouxe origem (UTM ou site externo), no
   localStorage do domínio. Qualquer formulário de cadastro lê com
   D21Rastreio.dados() e manda junto.

   Android e computador: o app instalado divide o armazenamento com
   o navegador, então a campanha da página de instalação chega até o
   cadastro dentro do app. iPhone isola o app instalado: lá só vão a
   rota e o aparelho.
   ============================================================ */
(function (w) {
  var K_PRIMEIRO = 'd21_rastreio_1';
  var K_ULTIMO   = 'd21_rastreio_ult';
  var CAMPOS     = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

  function ler(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function gravar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function aparelho() {
    var ua = navigator.userAgent || '';
    var so = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'ios'
           : /Android/i.test(ua) ? 'android' : 'desktop';
    var instalado = false;
    try { instalado = (w.matchMedia && w.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; } catch (e) {}
    return so + (instalado ? '-app' : '');
  }

  var agora = new Date().toISOString();
  var toque = { pagina: location.pathname, quando: agora };
  var temOrigem = false;
  try {
    var q = new URLSearchParams(location.search);
    CAMPOS.forEach(function (k) {
      var v = q.get(k);
      if (v) { toque[k] = String(v).slice(0, 150); temOrigem = true; }
    });
  } catch (e) {}
  var ref = '';
  try {
    if (document.referrer && document.referrer.indexOf(location.origin) !== 0) ref = document.referrer.slice(0, 200);
  } catch (e) {}
  if (ref) { toque.referrer = ref; temOrigem = true; }

  if (!ler(K_PRIMEIRO)) gravar(K_PRIMEIRO, toque);
  if (temOrigem) gravar(K_ULTIMO, toque);

  w.D21Rastreio = {
    // Campanha do último contato com origem; página e data do primeiro.
    dados: function () {
      var p = ler(K_PRIMEIRO) || toque;
      var u = ler(K_ULTIMO) || p;
      return {
        utm_source:   u.utm_source   || '',
        utm_medium:   u.utm_medium   || '',
        utm_campaign: u.utm_campaign || '',
        utm_content:  u.utm_content  || '',
        utm_term:     u.utm_term     || '',
        referrer:     u.referrer || p.referrer || '',
        landing:      p.pagina || '',
        primeira_visita: p.quando || '',
        pagina:       location.pathname,
        dispositivo:  aparelho()
      };
    },
    aparelho: aparelho
  };
})(window);
