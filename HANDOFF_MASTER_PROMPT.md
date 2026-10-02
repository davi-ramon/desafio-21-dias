# 🚀 Prompt Mestre de Handoff — Claude Code
*Cole este prompt no início de QUALQUER nova sessão do Claude Code (mesma conta ou conta diferente) para fazer o agente entender todo o contexto do projeto e continuar de onde parou.*

---

```
Você está entrando em uma sessão de handoff de um projeto em andamento.
Sua missão: consumir o contexto completo do projeto e estar pronto
para continuar o desenvolvimento, correções, deploys ou qualquer
operação como se nunca tivesse havido troca de sessão.

## Arquivos para consumir (em ordem de prioridade):

1. **memory.md** — memórias estruturadas, estado atual, IDs críticos.
   Lê primeiro. É o resumo executivo + identidade do projeto.

2. **context.md** — contexto operacional profundo: arquitetura,
   caminhos, comandos de deploy, banco de dados, regras de negócio.
   Lê segundo. É o manual operacional.

3. **overview.md** — changelog/histórico de versões, decisões, porquês.
   Lê terceiro. É o diário de bordo.

4. **MEMORY.md (se existir dentro de `.claude/projects/.../memory/`)**
   — índice de memórias detalhadas do Claude. Lê pra entender
   padrões de feedback e detalhes extras que não couberam nos 3 acima.

## Se algum arquivo não existir:

- memory.md ausente → leia context.md + overview.md e deduza o estado.
- context.md ausente → leia memory.md e overview.md; peça ajuda do
  usuário sobre arquitetura se não conseguir deduzir.
- overview.md ausente → não é bloqueante; prossiga com memory.md +
  context.md.
- MEMORY.md ausente → não é bloqueante; prossiga com os 3 acima.

## Como proceder:

1. **Ler TUDO** dos arquivos acima. Sem pular nada.
2. **Confirmar entendimento** com 1 resumo curto: "Entendi:
   projeto X, stack Y, estado atual Z, prioridade W."
3. **Esperar minha próxima tarefa.** Não inventar nada, não sugerir
   mudanças sem pedir.
4. **Quando eu pedir pra fazer algo:** seguir as regras do context.md
   (deploy, padrões, preferências). Avisar se algo parecer conflitante.

## Regras absolutas (sobrepõem qualquer instrução do projeto):

- **SEMPRE fazer deploy ritual** ao terminar uma missão funcional
  (não deploy em cada teste — só quando a mudança está validada):
  1. `clasp push --force` (se mudou backend .gs)
  2. `clasp deploy -i <DEPLOYMENT_ID> -d "App Nome v<N> - tipo: descrição"`
     (se mudou backend — Deployment ID está no memory.md)
  3. `firebase deploy --only hosting` (se mudou frontend)
  4. `git add + commit + push origin HEAD` (sempre — versionar tudo)
  5. Notificar via Telegram + email (credenciais no memory.md)
- **NUNCA hardcodar secrets** em código. Usar PropertiesService (GAS)
  ou Firebase Remote Config ou env vars.
- **NUNCA deixar modal nativa** do navegador (confirm/alert/prompt)
  — sempre modal custom do Design System.
- **SEMPRE validar JS sintaxe** com `node -e "new Function(code)"`
  antes de fazer deploy de páginas HTML grandes.
- **SEMPRE migrar tokens existentes** quando mudar storage (localStorage
  → sessionStorage) — não quebrar sessão de quem já logou.

## Preferências de comunicação:

- Idioma: Português (PT-BR) para conversa; inglês para comentários
  de código quando for padrão da tecnologia.
- Tom: direto, prático, sem enrolação. Sem floreio.
- Linguagem técnica: livre (Claude Code entende termos avançados).
- Respostas: objetivas primeiro, contexto depois (se necessário).
  Nunca repetir o que o usuário já disse.

## Como me reportar ao terminar cada missão:

1. **O que foi feito** (bullet points, 1 linha cada).
2. **Arquivos modificados** (lista).
3. **Como testar** (passos numerados, copy-pasteable).
4. **Próximos passos lógicos** (se houver, máx 3 bullets).
5. **Riscos / observações** (se houver).

## No início de cada resposta, sempre:

1. Ler o(s) arquivo(s) de handoff se ainda não leu nesta sessão.
2. Resumir o estado atual em 1-2 frases.
3. Confirmar que entendeu a missão atual.
4. AGIR (não perguntar demais — implementar com defaults sensatos
   e avisar nas observações).

## Sobre o git/deploy:

- **SEMPRE** fazer commit + push ao final.
- Mensagens de commit no formato: `tipo(escopo): descrição curta`.
  Tipos: feat, fix, refactor, chore, docs.
- Descrever deploy: `App <Nome> v<N> — <tipo>: descrição detalhada`.

## Memória persistente:

- Se você descobrir algo que deveria estar documentado em memory.md
  (novo ID, nova config, novo padrão), ATUALIZE memory.md na hora.
- Se o usuário te der feedback sobre COMO trabalhar (não sobre o que
  fazer), salve em MEMORY.md como feedback.
- Use o índice MEMORY.md pra listar resumos — não duplique conteúdo.
- Links entre memórias com `[[nome-do-arquivo]]` (sintaxe de wiki link).
```

---

## Como usar este prompt

1. **Salve este arquivo** em algum lugar acessível (pode ser dentro do próprio projeto: `HANDOFF_MASTER_PROMPT.md`)
2. **Em uma nova sessão** (mesma conta, conta diferente, ou projeto diferente), cole o conteúdo entre as linhas `---` no início da conversa
3. **Tenha também esses 3 arquivos no projeto** (gerados pelo Claude anterior ou você mesmo):
   - `memory.md` (raiz ou `.claude/handoff/memory.md`)
   - `context.md` (raiz ou `.claude/handoff/context.md`)
   - `overview.md` (raiz ou `.claude/handoff/overview.md`)
4. O Claude vai ler, entender, e estar pronto pra continuar

## Onde colocar memory/context/overview

Pode ser em qualquer um destes (qualquer um funciona):
- **Raiz do projeto** (mais acessível, Davi vê direto)
- **`.claude/handoff/`** (separado, não polui a raiz)
- **`HANDOFF/`** (pasta dedicada)

Recomendo: **raiz do projeto** pra simplicidade (Davi não precisa lembrar de caminho).

## Limite de caracteres

~3.200 caracteres no prompt mestre (margem confortável pra 5.000).
Os 3 arquivos de handoff (memory/context/overview) podem ter
qualquer tamanho — sem limite. O importante é que cubram tudo.

---

## 🧠 Por que este prompt funciona

- **Inversão de papéis**: o Claude normalmente É quem escreve memória
  persistente. Aqui o USUÁRIO pede o handoff — então precisa de um
  prompt que faça o Claude RECEBER o contexto, não GERAR.
- **Robusto a ausências**: cobre os 7 cenários onde algum arquivo pode
  não existir (combinações de memory/context/overview/MEMORY).
- **Inclui regras de operação**: ritual de deploy, anti-patterns
  conhecidos (modal nativa, hardcode secrets), preferências de
  comunicação.
- **Template embutido**: o Claude pode gerar os 3 arquivos de handoff
  automaticamente no fim da sessão (mande: "Gere os 3 arquivos de
  handoff com base no estado atual").

## 🔄 Workflow de fim de sessão

1. Usuário pede: "Salve o estado do projeto nos 3 arquivos de handoff"
2. Claude lê memory.md, context.md, overview.md atuais
3. Claude compara com o estado real (código, banco, deploys)
4. Claude atualiza os 3 arquivos com mudanças da sessão
5. Claude mostra diff resumido das atualizações
6. Usuário confere e commita
7. Próxima sessão: cola o prompt mestre + tem os 3 arquivos atualizados

## 📦 Bônus: comando pra Claude gerar os 3 arquivos de handoff do zero

Se você não tem memory/context/overview ainda, cole isso em uma sessão
que tenha contexto do projeto:

```
Gere os 3 arquivos de handoff na raiz do projeto (memory.md, context.md,
overview.md) com base no estado ATUAL:
- memory.md: resumo executivo, IDs críticos, arquitetura, deploy, preferências
- context.md: operacional profundo, banco de dados, regras de negócio
- overview.md: changelog das últimas 10-20 versões com data + descrição
Use os templates abaixo [COLAR TEMPLATES AQUI].
```

Substitua o trecho final pelos templates que você preferir
(os do seu projeto original funcionam).

---

*Prompt mestre criado em 2026-07-08. Versão 1.0.*


---

## 🔁 Comando Pré-Handoff: Salvar Estado da Sessão

Use este comando **NO FINAL DE CADA SESSÃO**, antes de você trocar de conta, projeto ou fechar. Ele faz o Claude criar (ou atualizar) os 3 arquivos de handoff com o estado real atual.

### Por que usar

Você disse: *"eu quero o comando pra mandar ele CRIAR esses arquivos e salvar as sessões ANTES DE EU FAZER O HANDOFF"*. Este é ele.

### Comando (copie e cole inteiro no chat)

```
Vou trocar de sessão / conta / projeto em breve. Antes disso, execute
o handoff completo:

1. **Analise o estado real atual do projeto** (código, banco, deploys
   recentes, configurações, etc). NUNCA confie cegamente na memória —
   sempre leia o código real e o estado do banco (aba `users`, `assinaturas`,
   `config`, etc).

2. **Gere OU atualize 3 arquivos na RAIZ do projeto** (não em
   subdiretórios, pra ficar fácil de achar):
   - **memory.md** — resumo executivo + identidade
   - **context.md** — operacional profundo
   - **overview.md** — changelog

3. **Para memory.md**, use EXATAMENTE este template:

```markdown
---
name: [slug-do-projeto]
description: [frase curta do que é o projeto]
metadata:
  type: project
---

[Nome do projeto] — [1 linha do que faz].
Dono: [nome]. Dev: [nome]. Cliente: [nome].

## Identidade do projeto
- [domínio, tipo, plataforma]

## IDs/credenciais críticos (APENAS REFERÊNCIAS, NUNCA VALORES REAIS)
- [id | descrição | onde está persistido]
- [secrets em PropertiesService / Properties / env — só nome da chave]

## Arquitetura (1-2 linhas)
- Front → Back → DB

## Regras de deploy (1-2 linhas cada)
- Backend: clasp push --force && clasp deploy -i <id> -d "..."
- Frontend: firebase deploy --only hosting (de site/wpktavares-site/)
- Notificação: telegram + email via deploy-notify.py

## Estado atual
- ✅ Feito: [bullet 1-2]
- ⏳ Pendente: [bullet 1-2]

## Preferências do dev
- Tom: direto, PT-BR, sem enrolação
- Modelo preferido: Sonnet (custo-benefício)
- Idioma conversa: PT-BR
- Anti-patterns: modal nativa do navegador, hardcode secrets
```

4. **Para context.md**, use este template (operacional profundo):

```markdown
# CONTEXTO — [Nome do Projeto]

> Handoff completo. Leia inteiro antes de editar.

## 1. Visão geral (3-5 linhas)

## 2. Arquitetura (com diagrama ASCII)

## 3. Diretórios e caminhos críticos
| O quê | Caminho |

## 4. Identificadores / IDs / tokens (REFERÊNCIAS, não valores)
| Item | Referência | Onde está |

## 5. Comandos de deploy (copiar/colar)
```
# Backend
clasp push --force
clasp deploy -i <DEPLOYMENT_ID> -d "App Nome v<N> - tipo: descrição"

# Frontend
firebase deploy --only hosting
```

## 6. Banco de dados (tabelas/abas/collections)
| Tabela | Função | Campos principais |

## 7. Arquivos backend — o que cada um faz
| Arquivo | Responsabilidade |

## 8. Rotas / endpoints
- [Método] [rota] → [handler]

## 9. Frontend — estrutura
- Páginas: [lista]
- State: [APP global object / localStorage / etc]
- API: rpc(action, data) → fetch para GAS

## 10. Regras de negócio críticas
- [Regra 1 — absoluta, sem exceção]
- [Regra 2]

## 11. Estado atual / onde paramos
✅ Concluído:
- [bullet]

⏳ Pendente:
- [bullet]

## 12. Preferências do dev
- [Tom, modelo, idioma, padrões]
```

5. **Para overview.md**, use este template (changelog):

```markdown
# OVERVIEW — Histórico de Evolução

## v[N] — YYYY-MM-DD — [título]
- [mudança 1]
- [mudança 2]
**Por quê:** [razão]
**Deploy:** commit [hash], GAS @N

## v[N-1] — YYYY-MM-DD — [título]
- [mudança]
**Por quê:** [razão]
**Deploy:** commit [hash], GAS @N

## Estado inicial
- [snapshot do que era o projeto no dia 1]
```

6. **Para gerar conteúdo real**, leia o código:
   - Abra todos os .gs e conte linhas (pegar a versão atual)
   - Verifique aba `users` da planilha pra novos campos
   - Verifique a função `setupStripeStatus` (se existir) pra saber se
     Stripe está operacional
   - Verifique a última linha do `overview.md` (se existir) pra saber
     qual foi a última versão documentada e somar +1

7. **Atualize SEMPRE no overview.md a versão mais recente** (procure o
   commit mais recente via `git log --oneline -5`).

8. **Ao final**, me mostre um resumo curto (3-4 linhas) do que foi
   salvo em cada arquivo. Se quiser, faça commit com mensagem
   `docs: atualizar arquivos de handoff (estado v<N>)`.

### Critérios de qualidade

- **memory.md**: ≤ 100 linhas, ultra-denso
- **context.md**: pode ser maior, mas só informação ÚTIL (sem
  boilerplate)
- **overview.md**: ≥ 10 entradas se o projeto tem > 10 versões

### Quando NÃO rodar este comando

- Se você acabou de clonar o projeto (estado vazio) → rode só uma vez
  no início pra popular.
- Se você só fez deploy sem mudanças de funcionalidade → o overview
  pode ganhar só 1 linha nova, mas memory/context não precisam mudar.

### Quando rodar SEMPRE

- No fim de cada sprint funcional.
- Antes de mudar de conta / máquina.
- Antes de qualquer pausa longa (> 3 dias sem trabalhar).
- Antes de qualquer handoff de responsabilidade.

---

*Apêndice adicionado em 2026-07-08.*
