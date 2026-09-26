# OVERVIEW — Histórico de Evolução

## v167 — 2026-09-09 — Entrada robusta no `doPost`

- O roteador deixou de executar `JSON.parse` diretamente sobre qualquer corpo recebido.
- Adicionado parser de borda para JSON estrito, BOM, formulário URL-encoded, payload encapsulado e objetos não estritos com aspas simples ou chaves sem aspas, sem uso de `eval`.
- Corpos realmente malformados agora retornam `INVALID_POST_BODY` e são registrados como entrada rejeitada, sem gerar falso alerta de erro interno no Telegram.
- Token, segredo da Cakto, autenticação do Stripe e rate-limit continuam sendo aplicados depois da normalização.
- Incluído teste de regressão local com 11 formatos válidos e inválidos.

**Deploy:** backend publicado em 2026-09-09 no mesmo deployment GAS fixo `AKfycbx9...aKxi`, versão `@145`. Smoke tests públicos confirmaram JSON, aspas simples, formulário, payload encapsulado e rejeição segura de corpo malformado.

## v166 — 2026-09-09 — Players compactos, móveis e sem retomada fantasma

- O player do YouTube em áudios agora pode ser minimizado, restaurado, fechado e reposicionado, com controles externos de −10 s, pausar/retomar e +10 s.
- O YouTube da meditação abre compacto por padrão e pode ser movido para um canto, preservando o timer e as mensagens como foco principal.
- O mini player dos áudios oficiais ganhou −10 s, +10 s e restauração de posição; o arraste livre voltou a funcionar porque as coordenadas deixaram de ser anuladas pelo CSS.
- A posição escolhida fica salva no navegador e é limitada à área visível da tela.
- Fechar um áudio durante o carregamento agora invalida a resposta pendente, impedindo que ele volte a tocar invisivelmente; iniciar a meditação também encerra o player de áudio anterior.
- O quadro do YouTube permanece visível no tamanho mínimo permitido pela plataforma; o app não oculta nem extrai a faixa de áudio.

**Deploy:** frontend publicado em 2026-09-09 no Firebase Hosting `wpktavares-88993`. O backend GAS permaneceu no mesmo deployment fixo (`@143`), pois esta versão não alterou rotas ou dados do servidor.

## v165 — 2026-09-09 — Personalização privada de meditação, leitura e áudio

- Criada a camada genérica `user_content`, vinculada ao `userId`, com visibilidade privada por padrão.
- Adicionados links públicos do YouTube à meditação e aos áudios, usando player incorporado visível e metadados oficiais.
- Adicionado upload privado de PDF/EPUB (máximo real de 5 MB), capa opcional e leitor com retomada por usuário.
- Implementados favoritos, ativação, participação no sorteio, ordenação e exclusão pelo dono.
- Criado fluxo administrativo `private → approved → global`, protegido no servidor.
- Incluídas validações de URL, MIME/assinatura do arquivo, conteúdo ativo em PDF, estrutura EPUB, rate limit e checagem de propriedade em toda leitura/escrita.

**Por quê:** permitir que cada aluno personalize as três experiências sem expor seus arquivos ou alterar o catálogo oficial.

**Deploy:** publicado em 2026-09-09 no deployment GAS fixo `AKfycbx9...aKxi` (`@143`) e no Firebase Hosting `wpktavares-88993`. Smoke tests públicos confirmaram backend, App e Admin v165.

## Histórico recente

- **v164 — 2026-09-08:** leads do trial no CRM e recuperação por WhatsApp de quem parou no cartão.
- **v163 — 2026-09-08:** correções de layout, som, arrastar no desktop e aviso de checkout iniciado.
- **v162 — 2026-09-06:** ajuste da cadência da pesquisa de satisfação.
- **v161 — 2026-09-06:** correções no link de presente, contagem e números do painel.
- **v160 — 2026-09-06:** pesquisa de satisfação (NPS) e painel de indicações.
- **v159 — 2026-09-06:** compartilhamento com rastreio, atribuição e painel.
- **v158 — 2026-09-06:** processamento de eventos Stripe por consulta periódica.
- **v157 — 2026-09-06:** detecção de divergência e avisos transitórios.
- **v156 — 2026-09-06:** sincronização de assinatura com o provedor.
- **v155 — 2026-09-05:** novo layout de e-mail e preferências de comunicação.
- **v154 — 2026-09-05:** correções no pós-checkout do trial com cartão.
- **v153 — 2026-09-05:** foco visual no formulário, CTA e lote mensal.
- **v152 — 2026-09-05:** ativos de conversão no checkout e lote real.
- **v151 — 2026-09-05:** paridade de conversão no checkout com dados reais.
- **v150 — 2026-09-05:** billing unificado Stripe/Cakto e tela redesenhada.
