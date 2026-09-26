#!/usr/bin/env node
// scripts/build_admin.js
// Copia C:/dev/desafio-21-dias/index.html (raiz, admin atual servido pelo GAS)
// para public/admin/index.html, reescrevendo:
//   - rpc() pra usar fetch (POST JSON) direto pro GAS, em vez de google.script.run
//   - remove o fallback de login com google.script.run (não funciona fora do sandbox GAS)
//   - injeta tela de login minimalista que valida no GAS via fetch e persiste token
//   - ajusta fontes para caminhos relativos (mantém comportamento)
//   - remove referências a _SERVER_USER (só existe no contexto GAS)

const fs = require('fs');
const path = require('path');

const SRC = 'C:/dev/desafio-21-dias/index.html';
const DEST = 'C:/dev/desafio-21-dias/site/wpktavares-site/public/admin/index.html';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbx9ypaZFGLIFkCVbV2LmvSv-dZIUZvMGvhJDnG2unhCwlaVTnBMU1anbbLa15h0aKxi/exec';

let src = fs.readFileSync(SRC, 'utf8');

// 1) Substitui rpc() — google.script.run vira fetch (regex tolerante a whitespace)
const RPC_RE = /function rpc\(action, data\)\s*\{[\s\S]*?\.handleRequest\(\{[\s\S]*?\}\);?\s*\}\);?\s*\}/;
const RPC_NEW = `// RPC reescrito para Firebase Hosting — POST JSON direto pro GAS (cross-origin OK).
var _GAS_URL = ${JSON.stringify(GAS_URL)};
function rpc(action, data) {
  var body = JSON.stringify({ action: action, token: (CRM && CRM.token) || '', data: data || {} });
  return fetch(_GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: body,
    redirect: 'follow'
  })
  .then(function(resp) { return resp.json(); })
  .then(function(r) { if (r && !r.ok) console.warn('[rpc]', action, '→ nok:', r.error); return r; })
  .catch(function(e) { console.error('[rpc]', action, '→ falha:', e && e.message); throw e; });
}`;
if (!RPC_RE.test(src)) { console.error('ERRO: rpc() original nao encontrado'); process.exit(1); }
src = src.replace(RPC_RE, RPC_NEW);

// 2) Remove o fallback com google.script.run (linhas ~907-915) — não funciona fora do GAS
const FALLBACK_RE = /\/\/ fallback: tenta via google\.script\.run[\s\S]*?getScriptUrl\(\);/;
const FALLBACK_NEW = `// fallback: volta pro app (sem URL do GAS disponível fora do sandbox)
      window.location.assign('/app/');`;
if (FALLBACK_RE.test(src)) {
  src = src.replace(FALLBACK_RE, FALLBACK_NEW);
}

// 3) Remove referência a _SERVER_USER (só existe no template GAS)
src = src.replace(/if \(!u \|\| !u\.role\) u = \(_SERVER_USER && _SERVER_USER\.role\) \? _SERVER_USER : \{ name: 'Usuário', email: '', role: 'user' \};/,
  `if (!u || !u.role) u = { name: 'Usuário', email: '', role: 'user' };`);

// 4) Injeta tela de login no topo do <body> (antes do sidebar)
const LOGIN_OVERLAY = `
<!-- Login overlay (admin Firebase-hosted) -->
<div id="loginOverlay" style="position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 30%, #0a1410 0%, #050a08 100%);font-family:inherit">
  <div style="background:#0e1a14;border:1px solid #1f3a2a;border-radius:18px;padding:34px 36px;width:min(420px,90vw);box-shadow:0 30px 60px rgba(0,0,0,.6)">
    <div style="text-align:center;margin-bottom:22px">
      <div style="font-size:11px;color:#7a8f80;letter-spacing:2px;text-transform:uppercase">WPK TAVARES</div>
      <div style="font-size:20px;font-weight:800;color:#e8efe9;margin-top:6px">Desafio 21 Dias</div>
      <div style="font-size:12px;color:#7a8f80;margin-top:6px">Painel Administrativo</div>
    </div>
    <div style="margin-bottom:14px">
      <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#7a8f80;display:block;margin-bottom:6px">E-mail</label>
      <input type="email" id="loginEmail" autocomplete="username" style="width:100%;padding:11px 13px;background:#0a1410;border:1px solid #1f3a2a;border-radius:10px;color:#e8efe9;font-size:14px;font-family:inherit" placeholder="admin@wpktavares.com">
    </div>
    <div style="margin-bottom:18px">
      <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#7a8f80;display:block;margin-bottom:6px">Senha</label>
      <input type="password" id="loginPass" autocomplete="current-password" style="width:100%;padding:11px 13px;background:#0a1410;border:1px solid #1f3a2a;border-radius:10px;color:#e8efe9;font-size:14px;font-family:inherit" placeholder="••••••••">
    </div>
    <button id="loginBtn" style="width:100%;padding:13px;background:linear-gradient(135deg,#4caf50,#2e7d32);color:#fff;border:none;border-radius:10px;font-weight:800;font-size:14px;cursor:pointer;font-family:inherit;letter-spacing:.5px">Entrar</button>
    <div id="loginMsg" style="margin-top:12px;font-size:12.5px;text-align:center;color:#7a8f80;min-height:18px"></div>
    <div style="margin-top:18px;text-align:center;font-size:11px;color:#4a5f50">Acesso restrito · WPK Tavares</div>
  </div>
</div>
<script>
(function(){
  // Auth bootstrap — roda antes do restante pra esconder login se já tiver token
  function doLogin(email, pass) {
    var msg = document.getElementById('loginMsg');
    if (msg) { msg.textContent = 'Validando...'; msg.style.color = '#7a8f80'; }
    fetch(${JSON.stringify(GAS_URL)}, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: JSON.stringify({ action: 'login', data: { email: email, password: pass } }),
      redirect: 'follow'
    }).then(function(r){ return r.json(); }).then(function(res){
      if (res && res.ok && res.token) {
        try { localStorage.setItem('crm_token_admin', res.token); } catch(e){}
        try { localStorage.setItem('crm_user_admin', JSON.stringify(res.user || { email: email, role: 'admin' })); } catch(e){}
        if (msg) { msg.textContent = '✓ Login realizado. Carregando painel...'; msg.style.color = '#4caf50'; }
        setTimeout(function(){ hideLoginAndInit(); }, 400);
      } else {
        if (msg) { msg.textContent = (res && res.error) || 'Falha no login.'; msg.style.color = '#e53935'; }
        var b = document.getElementById('loginBtn'); if (b) { b.disabled = false; b.textContent = 'Entrar'; }
      }
    }).catch(function(e){
      if (msg) { msg.textContent = 'Erro de conexão: ' + (e.message || e); msg.style.color = '#e53935'; }
      var b = document.getElementById('loginBtn'); if (b) { b.disabled = false; b.textContent = 'Entrar'; }
    });
  }
  function hideLoginAndInit() {
    var ov = document.getElementById('loginOverlay');
    if (ov) ov.style.display = 'none';
    CRM.token = localStorage.getItem('crm_token_admin') || '';
    try { CRM.user = JSON.parse(localStorage.getItem('crm_user_admin') || 'null') || {}; } catch(e) { CRM.user = {}; }
    if (typeof loadUserInfo === 'function') loadUserInfo();
    if (typeof renderAutomacoes === 'function') renderAutomacoes();
  }
  function attach() {
    var b = document.getElementById('loginBtn');
    var e = document.getElementById('loginEmail');
    var p = document.getElementById('loginPass');
    if (!b) { setTimeout(attach, 50); return; }
    b.addEventListener('click', function() {
      var em = (e.value || '').trim();
      var ps = (p.value || '').trim();
      if (!em || !ps) { document.getElementById('loginMsg').textContent = 'Preencha e-mail e senha.'; document.getElementById('loginMsg').style.color = '#e53935'; return; }
      b.disabled = true; b.textContent = '...';
      doLogin(em, ps);
    });
    [e, p].forEach(function(inp){ inp && inp.addEventListener('keydown', function(ev){ if (ev.key === 'Enter') b.click(); }); });
    // Auto-login se já tiver token
    var existing = localStorage.getItem('crm_token_admin');
    if (existing) { hideLoginAndInit(); return; }
    // Se vier com ?token=... na URL (vindo do app), usar direto
    var qp = new URLSearchParams(location.search);
    var urlTok = qp.get('token');
    if (urlTok) { localStorage.setItem('crm_token_admin', urlTok); hideLoginAndInit(); return; }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else attach();
})();
</script>
`;
// Insere logo após <body>
src = src.replace(/<body([^>]*)>/, '<body$1>' + LOGIN_OVERLAY);

// 5) Escreve
fs.mkdirSync(path.dirname(DEST), { recursive: true });
fs.writeFileSync(DEST, src);
console.log('[OK] admin/index.html criado: ' + DEST);
console.log('  Tamanho: ' + (src.length / 1024).toFixed(1) + ' KB');
console.log('  Linhas: ' + src.split('\n').length);