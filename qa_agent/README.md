# QA Agent 1.0

O `qa_agent` e um agente local de QA Automation em Python para validar o App 21 Dias com Playwright, capturar evidencias tecnicas e gerar relatorios prontos para uso com uma IA Dev.

## O que ele faz

- Abre o navegador Chromium localmente.
- Acessa a URL configurada do app.
- Executa testes basicos e seguros de smoke, navegacao e login opcional.
- Continua autenticado apos o login para explorar telas internas visiveis com seguranca.
- Faz validacoes seguras de experiencia autenticada, incluindo audio e pre-visualizacao de meditacao quando existirem.
- Captura screenshots, logs de console, page errors, requests com falha e respostas HTTP com erro.
- Salva trace do Playwright e videos opcionais.
- Gera relatorio bruto em JSON.
- Gera relatorio tecnico em Markdown.
- Gera um prompt tecnico final para outra IA corrigir os problemas encontrados.

## Objetivo

O agente foi desenhado para apoiar um ciclo de desenvolvimento assistido por IA:

1. Uma nova versao do app e publicada no ambiente de teste.
2. O `qa_agent` executa os testes locais.
3. O agente gera evidencias e relatorios tecnicos.
4. O relatorio e usado como entrada para uma IA Dev corrigir os bugs.

## Instalacao

```powershell
cd qa_agent
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m playwright install chromium
```

## Configuracao

Crie um `.env` local a partir do exemplo:

```powershell
copy .env.example .env
```

Preencha pelo menos:

- `APP_URL`: URL principal que sera testada.
- `LOGIN_URL`: URL de login, se houver.
- `TEST_EMAIL` e `TEST_PASSWORD`: credenciais de teste, apenas se o fluxo de login for seguro.
- `HEADLESS`: `true` ou `false`.
- `RECORD_VIDEO`: `true` ou `false`.
- `SAVE_TRACE`: `true` ou `false`.
- `TIMEOUT_MS`: timeout base da execucao.
- `POST_LOGIN_EXPLORE`: habilita a exploracao segura das areas internas apos login.
- `SAFE_AUDIO_TEST`: tenta validar o player de audio sem acionar fluxos destrutivos.
- `SAFE_MEDITATION_PREVIEW`: abre a experiencia de meditacao apenas em modo de pre-visualizacao, sem iniciar a sessao completa.
- `MAX_NAV_ITEMS`: limite de telas internas a visitar por execucao.
- `AUDIO_PROBE_SECONDS`: quantos segundos o agente observa o player de audio antes de fechar.
- `INITIAL_WAIT_MS`: espera adicional logo apos abrir a aplicacao.
- `POST_LOGIN_WAIT_MS`: espera adicional depois do login para a home terminar de carregar.
- `ACTION_WAIT_MS`: espera adicional entre interacoes pesadas.
- `VIEW_LOAD_WAIT_MS`: espera adicional ao trocar de tela interna.
- `AUDIO_GALLERY_ITEMS`: quantidade de audios da galeria para testar em sequencia.
- `AUDIO_LISTEN_SECONDS`: tempo de reproducao por audio na galeria.

Voce tambem pode criar um `config.json` com a mesma estrutura do `config.example.json`. Quando presente, o `config.json` e lido antes das variaveis do `.env`, e o `.env` pode sobrescrever campos especificos.

## Execucao

```powershell
python run_qa.py
```

Para apps mais lentos, como um frontend apoiado em Google Sheets, uma configuracao pratica e:

```env
TIMEOUT_MS=60000
INITIAL_WAIT_MS=15000
POST_LOGIN_WAIT_MS=15000
ACTION_WAIT_MS=12000
VIEW_LOAD_WAIT_MS=12000
```

## Relatorios gerados

Os artefatos sao salvos em:

- `reports/raw/`: relatorio bruto em JSON.
- `reports/markdown/`: relatorio tecnico em Markdown.
- `reports/screenshots/`: capturas de tela.
- `reports/traces/`: traces do Playwright.
- `reports/videos/`: videos da sessao, quando habilitados.

## Como usar com uma IA Dev

1. Execute `python run_qa.py`.
2. Abra o relatorio `.md` em `reports/markdown/`.
3. Copie a secao `Prompt Tecnico Para IA Dev`.
4. Use esse material para pedir a correcao dos bugs sem alterar fluxos que ja funcionam.

## Limites da versao 1.0

- Nao controla o sistema operacional.
- Nao usa PyAutoGUI.
- Nao altera arquivos do projeto principal.
- Nao faz deploy.
- Nao envia dados reais.
- Nao executa automacoes destrutivas.
- O fluxo de login so roda quando URL e credenciais de teste estiverem configuradas.
- Os fluxos pos-login sao seguros e conservadores: o agente navega, abre experiencias e coleta evidencias, mas evita acoes como salvar, excluir, enviar, sincronizar ou disparar operacoes externas.
- Os seletores de navegacao sao heuristicas seguras; telas muito dinamicas podem exigir ajuste fino posterior.

## Roadmap 2.0

- Interpretacao visual de telas com IA.
- Geracao automatica de seletores com base no DOM.
- Comparacao entre requisito funcional e implementacao atual.
- Integracao com GitHub Issues.
- Execucao antes e depois de deploy.
- Suites de regressao com comparacao entre rodadas.
- Testes especificos para Apps Script.
- Testes especificos para Firebase Hosting.
- Coleta de metricas simples de performance.
- Sugestao de correcao por IA sem aplicar nada automaticamente.
