# -*- coding: utf-8 -*-
"""
Deploy notification script - Desafio 21 Dias
Envia Telegram (curto, sem emojis) + Email (detalhado, formatado).
SEM problemas de encoding (Python gerencia UTF-8 nativamente).

Uso:
    python deploy-notify.py
    python deploy-notify.py v89 "fix: ..."
"""
import json
import sys
import urllib.request
import urllib.error

# ==== CREDENCIAIS ====
TG_TOKEN = "8904390057:AAGoxFSqpvqwk8xZ7PnifZgRrd2w2VZkIeE"
TG_CHAT  = "-5169638006"

RE_KEY   = "re_AJhDfpmn_ECEgZLfG6y7wzAR4GuUBdQ1R"
RE_FROM  = "Claude Code - Desafio 21 Dias <claudecode@lazylabs.com.br>"
RE_TO    = ["ads.deyvid@gmail.com", "waguinhofire@gmail.com", "wpktavares@gmail.com"]

# Argumentos opcionais: <versao> <commit> <linhas> <titulo curto>
VERSION = sys.argv[1] if len(sys.argv) > 1 else "v88"
COMMIT  = sys.argv[2] if len(sys.argv) > 2 else "a5a592b"
LINES   = sys.argv[3] if len(sys.argv) > 3 else "+682"
TITLE   = sys.argv[4] if len(sys.argv) > 4 else "Meditacao auto-save + Sala de Leitura"

def post_json(url, payload, headers=None):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    h = {
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    }
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=body, headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")
    except Exception as e:
        return 0, str(e)

# ==== TELEGRAM (curto, sem emojis) ====
tg_msg = (
    f"Deploy {VERSION} (GAS + Firebase) - Desafio 21 Dias\n\n"
    f"O que mudou: {TITLE}\n"
    f"- Frontend/Backend deployados.\n"
    f"- GitHub: commit {COMMIT} pushed.\n\n"
    f"Dev: Deyvid Ramon\n"
    f"Implementado por: Claude Code"
)

status, body = post_json(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                         {"chat_id": TG_CHAT, "text": tg_msg})
if status == 200:
    print(f"[OK] Telegram enviado (HTTP {status})")
else:
    print(f"[FAIL] Telegram HTTP {status}: {body[:200]}")

# ==== EMAIL (detalhado, formatado) ====
email_html = f"""<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Deploy {VERSION}</title></head>
<body style="margin:0;padding:0;background:#0d1410;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e8efe9">
<div style="max-width:640px;margin:24px auto;background:#14201a;border:1px solid #2a4a36;border-radius:18px;overflow:hidden">

  <div style="padding:28px 24px;background:linear-gradient(135deg,#1a2e23,#0f1a14);border-bottom:1px solid #2a4a36;text-align:center">
    <img src="https://i.imgur.com/HMIOBju.png" width="68" height="68" alt="Claude Code" style="border-radius:50%;display:block;margin:0 auto 14px;border:2px solid #4caf50">
    <div style="font-size:12px;color:#7a8f80;letter-spacing:1.5px;text-transform:uppercase">Claude Code - Desafio 21 Dias</div>
    <div style="font-size:26px;font-weight:800;margin-top:6px;color:#fff">Deploy {VERSION}</div>
    <div style="font-size:13px;color:#9bb09f;margin-top:6px">{TITLE}</div>
  </div>

  <div style="padding:26px 28px">
    <h2 style="font-size:15px;color:#4caf50;margin:0 0 14px;letter-spacing:.5px;text-transform:uppercase">Resumo das alteracoes</h2>

    <div style="background:#0f1a14;border-left:3px solid #4caf50;padding:14px 16px;border-radius:8px;margin-bottom:14px">
      <div style="font-weight:700;color:#c8e6c9;margin-bottom:6px;font-size:15px">Meditacao: auto-save com resume</div>
      <div style="font-size:13.5px;line-height:1.6;color:#a8c0af">
        O aluno meditava, a tela bloqueou, voltou: agora retoma de onde parou. O progresso
        e salvo a cada 60 segundos no localStorage (com backup no GAS via CacheService, TTL 6h),
        tambem ao pausar e ao sair sem concluir. Na tela inicial aparece um banner verde
        "Voce parou em X:XX - Continuar?" com botao para retomar a sessao direto, pulando
        o onboarding. Conclusao automatica limpa o save para nao acumular lixo.
      </div>
    </div>

    <div style="background:#0f1a14;border-left:3px solid #4caf50;padding:14px 16px;border-radius:8px;margin-bottom:14px">
      <div style="font-weight:700;color:#c8e6c9;margin-bottom:6px;font-size:15px">Sala de Leitura (nova feature)</div>
      <div style="font-size:13.5px;line-height:1.6;color:#a8c0af">
        Botao verde "Entrar na Sala de Leitura" no topo da biblioteca de livros. Redireciona
        para o link configurado no admin (Zoom) ou usa o fallback Jitsi Meet. Abre em nova
        aba, nao bloqueia o app. Pop-up animado slide-up pergunta 1 vez por dia se o aluno
        ja participou da sala ao vivo. Se ele responde SIM, o pilar de leitura do dia e
        marcado automaticamente como concluido. Nao aparece se a leitura ja foi marcada hoje.
      </div>
    </div>

    <div style="background:#0f1a14;border-left:3px solid #4caf50;padding:14px 16px;border-radius:8px;margin-bottom:20px">
      <div style="font-weight:700;color:#c8e6c9;margin-bottom:6px;font-size:15px">Detalhes tecnicos</div>
      <div style="font-size:13px;line-height:1.65;color:#a8c0af">
        Backend GAS {VERSION}: 2 funcoes novas em <code style="background:#0a1410;padding:1px 5px;border-radius:3px;color:#c8e6c9">aluno_routes.gs</code>
        (<code style="background:#0a1410;padding:1px 5px;border-radius:3px;color:#c8e6c9">saveMedProgress</code> /
        <code style="background:#0a1410;padding:1px 5px;border-radius:3px;color:#c8e6c9">getMedProgress</code>) usando
        <code style="background:#0a1410;padding:1px 5px;border-radius:3px;color:#c8e6c9">CacheService</code> com
        expiracao automatica em 12h. Rotas novas em <code style="background:#0a1410;padding:1px 5px;border-radius:3px;color:#c8e6c9">modules.gs</code>.
        Frontend: HTML + CSS + JS adicionados em <code style="background:#0a1410;padding:1px 5px;border-radius:3px;color:#c8e6c9">app.html</code>.
        Popup animado usa CSS puro (slide-up no mobile, scale-in no desktop).
      </div>
    </div>

    <div style="display:flex;gap:10px;margin-top:18px;font-size:12px">
      <div style="flex:1;background:#0a1410;padding:12px 8px;border-radius:8px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:#4caf50">{LINES}</div>
        <div style="color:#7a8f80;margin-top:2px">linhas adicionadas</div>
      </div>
      <div style="flex:1;background:#0a1410;padding:12px 8px;border-radius:8px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:#4caf50">{VERSION}</div>
        <div style="color:#7a8f80;margin-top:2px">GAS deploy</div>
      </div>
      <div style="flex:1;background:#0a1410;padding:12px 8px;border-radius:8px;text-align:center">
        <div style="font-size:14px;font-weight:800;color:#4caf50;font-family:monospace">{COMMIT}</div>
        <div style="color:#7a8f80;margin-top:2px">commit GitHub</div>
      </div>
    </div>
  </div>

  <div style="padding:18px 28px;background:#0a1410;border-top:1px solid #2a4a36;text-align:center;font-size:12px;color:#6a7f70">
    <div>Dev: Deyvid Ramon</div>
    <div>Implementado por: Claude Code - Desenvolvedor &middot; sob comando de David Ramon</div>
  </div>

</div>
</body></html>"""

email_payload = {
    "from": RE_FROM,
    "to": RE_TO,
    "subject": f"Deploy {VERSION} - {TITLE}",
    "html": email_html,
}

status, body = post_json("https://api.resend.com/emails", email_payload,
                         headers={"Authorization": f"Bearer {RE_KEY}"})
if status in (200, 201):
    print(f"[OK] Email enviado (HTTP {status})")
else:
    print(f"[FAIL] Email HTTP {status}: {body[:300]}")