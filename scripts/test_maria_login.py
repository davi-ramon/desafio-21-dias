# -*- coding: utf-8 -*-
"""
Reproduz o bug da Maria: login que falha mesmo após pagar.
Testa 3 cenarios:
1. Email exato (mariaantonialimadourado2077@gmail.com)
2. Email com whitespace (maria...@gmail.com   )
3. Email em maiuscula (MARIA...@GMAIL.COM)

Apos o fix v102 (login normaliza), TODOS devem funcionar.
"""
import json
import urllib.request
import urllib.error

GAS = "https://script.google.com/macros/s/AKfycbx9ypaZFGLIFkCVbV2LmvSv-dZIUZvMGvhJDnG2unhCwlaVTnBMU1anbbLa15h0aKxi/exec"

# IMPORTANTE: este e um teste de pressuncao, NAO temos a senha real.
# Vamos simular com uma senha qualquer pra ver se o backend
# pelo menos ENCONTRA o usuario (mesmo que a senha nao bata).
# O user existe na planilha se Maria pagou.

TEST_CASES = [
    ("email exato", "mariaantonialimadourado2077@gmail.com", "qualquer-senha-teste"),
    ("email whitespace", "mariaantonialimadourado2077@gmail.com   ", "qualquer-senha-teste"),
    ("email maiuscula", "MARIAANTONIALIMADOURADO2077@GMAIL.COM", "qualquer-senha-teste"),
    ("email com tab", "mariaantonialimadourado2077@gmail.com\t", "qualquer-senha-teste"),
]

for label, email, senha in TEST_CASES:
    payload = {"action": "login", "data": {"email": email, "password": senha}}
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(GAS, data=body, method="POST", headers={
        "Content-Type": "text/plain; charset=utf-8",
        "User-Agent": "Mozilla/5.0"
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            res = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        res = {"error": "HTTP " + str(e.code)}
    except Exception as e:
        res = {"error": str(e)}
    print(f"[{label:18}] email='{email[:30]}...' -> {res.get('error') or res.get('ok')}")
