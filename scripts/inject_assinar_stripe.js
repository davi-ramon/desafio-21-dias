// Injeta o helper assinarStripe() antes do </script> final de uma pagina HTML
const fs = require('fs');
const FILE = process.argv[2];
if (!FILE) { console.error('uso: node scripts/inject_assinar_stripe.js <file>'); process.exit(1); }

let s = fs.readFileSync(FILE, 'utf8');
if (s.indexOf('window.assinarStripe') >= 0) {
  console.log('[skip] helper ja existe em ' + FILE);
  process.exit(0);
}

const HELPER = `
})();

// v100: Stripe checkout inline (substitui Cakto nos CTAs da landing)
(function() {
  var GAS_URL = 'https://script.google.com/macros/s/AKfycbx9ypaZFGLIFkCVbV2LmvSv-dZIUZvMGvhJDnG2unhCwlaVTnBMU1anbbLa15h0aKxi/exec';
  function getToken() {
    try {
      return JSON.parse(sessionStorage.getItem('crm_token_admin') || 'null')
        || JSON.parse(sessionStorage.getItem('app_token') || 'null')
        || '';
    } catch (e) { return ''; }
  }
  window.assinarStripe = function(ev, plan, planName, value) {
    try { if (ev && ev.preventDefault) ev.preventDefault(); } catch (e) {}
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px';
    ov.innerHTML =
      '<div style="background:#0e1a14;border:1px solid rgba(76,175,80,0.32);border-radius:22px;padding:28px 32px;max-width:380px;width:100%;box-shadow:0 30px 60px rgba(0,0,0,0.6);text-align:center;color:#dde8dd">' +
        '<div style="width:34px;height:34px;border:3px solid rgba(76,175,80,0.16);border-top-color:#4caf50;border-radius:50%;animation:assSpin 1s linear infinite;margin:0 auto 14px"></div>' +
        '<div style="font-weight:800;margin-bottom:6px">Abrindo checkout Stripe...</div>' +
        '<div style="font-size:12px;color:#7a8f80">Voce sera redirecionado em instantes.</div>' +
        '<div id="assErrMsg" style="margin-top:14px;font-size:12px;color:#ef5358;display:none"></div>' +
      '</div>' +
      '<style>@keyframes assSpin{to{transform:rotate(360deg)}}</style>';
    document.body.appendChild(ov);
    var errEl = ov.querySelector('#assErrMsg');
    fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: JSON.stringify({ action: 'criarCheckoutStripe', token: getToken(), data: { plan: plan, origin: 'planos', intent: 'new' } }),
      redirect: 'follow'
    })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (!res || !res.ok || !res.url) {
        var msg = (res && res.error) || 'Erro ao abrir checkout.';
        if (/nao configurado|indispon/i.test(msg)) msg = 'Stripe ainda nao configurado.';
        if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
        setTimeout(function() { try { ov.remove(); } catch (e) {} }, 4500);
        return;
      }
      try { window.location.href = res.url; } catch (e) { var w = window.open(res.url, '_blank'); }
    })
    .catch(function(err) {
      if (errEl) { errEl.textContent = 'Erro: ' + (err && err.message ? err.message : err); errEl.style.display = 'block'; }
      setTimeout(function() { try { ov.remove(); } catch (e) {} }, 5000);
    });
  };
})();
</script>`;

// Pega a ultima ocorrencia de </script> e troca pelo nosso bloco
const idx = s.lastIndexOf('</script>');
if (idx < 0) { console.error('sem </script> em ' + FILE); process.exit(1); }

// Toma tudo ate o </script> (exclusive)
const before = s.slice(0, idx);
// Verifica se termina com "})();" pra garantir que estamos fechando o ultimo IIFE
const trimmed = before.replace(/\s+$/, '');
s = trimmed + HELPER + '\n\n</body>\n</html>';
fs.writeFileSync(FILE, s);
console.log('[ok] helper injetado em ' + FILE);