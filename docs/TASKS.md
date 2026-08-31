# TASKS — Quadro de trabalho da equipe OSHER

> **Como usar (leia antes de começar qualquer coisa):**
> 1. `git pull` na `main` para pegar a versão mais recente.
> 2. Leia este arquivo + o `CLAUDE.md`.
> 3. Ao **pegar** uma task: mova-a para **🔴 Em andamento**, ponha seu nome, a data e o nome da branch.
> 4. Trabalhe em uma **branch própria** (`feat/...`, `fix/...`), nunca direto na `main`.
> 5. Ao terminar: abra um **PR**, peça revisão do outro, faça merge. Mova a task para **🟢 Concluídas**.
> 6. **Commite este arquivo junto** com seu trabalho — ele é o nosso "quadro" compartilhado.

---

## 👥 Pessoas
- **Juan** — @projetoslibra (juan.carneiro@libracapital.com.br)
- **João** — @[handle do GitHub] ([email]) · _preencher handle/email_

---

## 🔴 Em andamento
> 1 dono por linha. Se o seu nome está aqui, ninguém mais mexe nesses arquivos/área.

| Task | Responsável | Branch | Início | Notas |
|------|-------------|--------|--------|-------|
| Validar DRE/Variação contra cálculos manuais | João | `chore/validacao-dre` | 2026-08-19 | Conferir valores da aba DRE/Variação com a planilha/cálculo manual antes de mexer em metodologia |
| Previsões: Viradas, Reversão e Líquido PDD | João | `feat/previsoes-viradas-reversao-pdd` | 2026-08-24 | Adicionar colunas de PDD projetada e atualizar a régua oficial para A-F |

---

## 🟡 Próximas (backlog priorizado)
> Pegue de cima para baixo. Se for começar, mova para "Em andamento".

- [ ] **OC-13 — Indicadores, permissões e auditoria operacional** — depende das telas anteriores
- [ ] **OC-14 — Testes, benchmark e homologação paralela** — contínua por entrega
- [ ] **Enforcement de permissões** — hoje o middleware só checa login, não as permissões `*.view`/`*.manage`
- [ ] **Unificar formatters** — Dashboard e DRE redefinem formatters em vez de usar `lib/formatters.ts`
- [ ] **Módulo Relatórios** (`/dashboard/relatorios`) — exportações (placeholder; deixar para o final)
- [ ] **Validar média CUSTO x RECEITA da Previsões** — reconciliar médias usadas na Previsões com os cálculos manuais e com as linhas-base da DRE/Variação
- [ ] **Refinar metodologia de Previsões** — revisar premissas de receita, custo, PDD, cota e impacto diário para deixar a previsão mais precisa
- [ ] **Tela de LOG** — criar uma tela no OSHER para consultar eventos, importações, execuções automáticas e ações relevantes do sistema

---

## 🟢 Concluídas (recentes)
- [x] **[2026-08-31] Desempenho do matching de baixas (Consignado)** — arquivos grandes estouravam os 300s da Vercel e morriam sem gravar nada. Três gargalos corrigidos sem alterar decisão: o filtro `contains` de documento na carga de candidatos (provadamente incapaz de casar com documento formatado, agora dispensado por consulta de guarda), a pontuação contra o pool inteiro e a varredura do histórico de remessas — ambos passaram a usar índice sobre as mesmas chaves. Transações de import e de remessa ganharam timeout e inserção em blocos, porque o padrão de 5s do Prisma não cobre dez mil itens. Equivalência garantida por teste diferencial validado por mutação — _Juan_ · branch `perf/matching-baixas-consignado`.
- [x] **[2026-08-28] Reabrir lote de baixa (Consignado)** — a geração da remessa marcava como `EXCLUDED` todo título não aprovado e a tela filtrava os excluídos, então eles sumiam sem caminho de volta (o cartão contava "Fora/revisão" e a classificação dizia "Todos os títulos estão aptos"). Botão "Reabrir lote" devolve os títulos com o status original, gravado agora num `ConsignadoStatusEvent` na geração; lotes antigos derivam o status. Reabrir e cancelar remessa são independentes: com remessa ativa o lote reabre só para conferência. `refreshBatchTotals` passou a preservar `GENERATED`/`RECONCILING`/`RECONCILED`/`CANCELLED`, senão reabrir destravaria as ações por acidente. Sem migration — _Juan_ · branch `feat/reabrir-lote-baixa`.
- [x] **[2026-08-20] Conciliação por títulos fora da remessa (Consignado)** — snapshot idempotente dos títulos excluídos por remessa, composição `entrada = remessa + títulos + Outros` em transação `Serializable`, pendências "Outros" auditáveis com resolução/desfazimento, relatórios com filtros e Excel para títulos excluídos e diferenças — implementação, documentação e migration `20260820000000_add_consignado_remittance_exclusions` concluídas e aplicadas no schema `OSHER` em 2026-08-20; checklist pós-migration e checklist de concorrência real (duas conciliações `Serializable` reais disputando o mesmo título) validados contra o Postgres do Railway. O teste de concorrência revelou e corrigiu um problema real: o timeout padrão de transação do Prisma (5s) era curto demais para essa transação multi-etapas — subiu para `maxWait: 5s`/`timeout: 15s`, e o conflito de serialização (`P2034`) agora vira mensagem amigável na API. PR aberto: https://github.com/projetoslibra/intranet/pull/6. Ajustes pós-feedback: aba "Títulos fora da remessa" movida pro nav principal de Baixas, situação `AVAILABLE` renomeada para "Pendente", filtros do relatório validados (sem bugs), e migration `20260820200000_backfill_consignado_legacy_other_differences` para dar visibilidade às 4 diferenças antigas (R$ 997,58) que ficavam fora da aba "Diferenças e ajustes" — _Juan_ · branch `feat/conciliacao-titulos-excluidos`.
- [x] **[2026-08-19] Log financeiro dos lotes do Consignado** — resumo recolhido com valor pago, valor da remessa, estado da conciliação e entradas bancárias vinculadas; manutenção da base PDD movida para aba secundária — _Juan_ · branch `feat/log-lotes-consignado`.
- [x] **[2026-08-19] Importação automática Singulare** — cron diário no Vercel para reprocessar carteira e caixa dos últimos 3 dias úteis, mantendo o botão manual para datas específicas — _João_ · branch `feat/singulare-importacao-automatica`.
- [x] **[2026-08-19] Tela PDD dos fundos** — nova tela com indicadores, viradas futuras, matriz cedente/sacado por data, ordenações, filtro de viradas no mês, histórico passado e exportação para Excel numérico — _João_ · branch `feat/tela-pdd`.
- [x] **[2026-08-19] DRE abrir no mês atual por padrão** — aba DRE e DRE/Variação agora abrem no range do mês atual, mantendo os filtros de período e datas customizadas — _João_ · branch `feat/dre-mes-atual-padrao`.
- [x] **[2026-08-18] Filtros e ajustes da conciliação do Consignado** — lotes filtrados por processamento, cancelamento lógico de duplicados sem remessa, entradas por data, indicadores globais e diferenças encerradas com justificativa auditável e estorno — _Juan_ · branch `feat/conciliacao-consignado-filtros-ajustes` · migration aplicada no schema `OSHER`.
- [x] **[2026-08-13] Resumo diário automático de PDD** — endpoint para N8N, tabela `PDD_RESUMOS_DIARIOS`, card na tela PDD, narrativa via OpenAI com fallback determinístico e criação idempotente da tabela no primeiro uso autorizado — _João_ · branch `feat/pdd-resumo-diario`.
- [x] **[2026-08-12] Documentação e consolidação do Operacional Consignado** — fluxo publicado, navegação, reprocessamento, antecipações, candidatos com vencimento, base histórica PDD e valores por filtro registrados em `docs/OPERACIONAL-CONSIGNADO.md` — _Juan_ · `main`.
- [x] **[2026-08-10] Recuperações de PDD do Consignado** — importação histórica idempotente, matching após falha no estoque, reclassificação de lotes abertos, filtro próprio e bloqueio de nova remessa — _Juan_ · branch `feat/operacional-consignado` · migration aplicada no schema `OSHER`.
- [x] **[2026-08-10] Revisão operacional das baixas** — valores pagos em todos os filtros, antecipações por diferença/recorrência, aviso de arquivo repetido e vencimento na pesquisa de candidatos — _Juan_ · branch `feat/operacional-consignado`.
- [x] **[2026-08-06] OC-04 a OC-12** — Fluxos diários BMP/UY3, matching com estoque, revisão manual, CNAB 444 Daycoval, extrato Bradesco, conciliação muitos-para-muitos e confirmação pelo estoque seguinte — _Juan_ · branch `feat/operacional-consignado` · publicado na `main`; migrations aplicadas.
- [x] **[2026-08-06] OC-01 a OC-03** — Fundação histórica do estoque do Consignado, upload direto para armazenamento privado, processamento reexecutável em blocos e tela de versões/histórico — _Juan_ · branch `feat/operacional-consignado`. Blob privado configurado via OIDC.
- [x] **[2026-08-03]** Estrutura QProf de cobrança no schema `OSHER`, com tabela para carga do n8n e views por fundo — _Juan_ · branch `feat/qprof-cobranca`.
- [x] **[2026-08-03]** Ajustes básicos de UX na marca, login e visualização do Caixa — _Juan_ · branch `fix/ajustes-ux-marca-caixa`.
- [x] **[2026-07-29]** Previsões: tooltip de composição da PDD em saldos históricos, projeções, seleção de cedente/sacado, títulos do estoque e memória de baixas — _João_ · branch `feat/previsoes-tooltip-pdd`.
- [x] **[2026-08-03]** Nova identidade visual da OSHER no login, navegação e tela de Caixa — _Juan_ · branch `feat/identidade-visual`.
- [x] **[2026-08-03]** Dashboard Crédito&Cadastro no OSHER, consumindo em modo somente leitura os resultados do schema `ARAM` — _Juan_ · branch `feat/credito-cadastro-integracao`.
- [x] **[2026-07-28]** Enquadramento com botão de atualização das bases mais recentes por fundo e consulta histórica funcional — _Juan_ · branch `fix/atualizacao-enquadramento`.
- [x] **[2026-07-27]** Níveis de acesso por aba e cartões de usuários recolhidos por padrão — _Juan_ · branch `feat/niveis-acesso-usuarios`.
- [x] **[2026-07-27]** Enquadramento via `FIDC_ESTOQUES`, filtros por cedente/sacado e remoção dos controles manuais de estoque/DIM — _Juan_ · branch `feat/enquadramento-estoque-api`.
- [x] **[2026-07-20]** Módulo Usuários (`/dashboard/usuarios`): CRUD, status e atribuição de acessos — _João_ · branch `feat/modulo-usuarios`.
- [x] **[2026-07-20]** Módulo Operacional: Financeiro, Mesa de Operações, estoque, risco e DIM cedentes — _Juan_ · branch `feat/modulo-operacional`.
- [x] **[2026-07-20]** Corrigir sinais e rentabilidades da aba Previsões: PDD positiva reduz PL, reversão negativa aumenta PL, rentabilidades diária/mensal/anual recalculam com o PL projetado e tooltip documenta os sinais — _João_ · branch `fix/previsoes-pdd-rentabilidade`.
- [x] **[2026-07-06]** PREVISÕES DE COTA DRE: nova aba Previsões abaixo da DRE, histórico real da `CARTEIRAS`, projeção diária por data futura, PDD como variável manual e receita média de Direitos Creditórios baseada na DRE/Variação — _João_ · branch `feat/previsoes-cota-dre`.
- [x] **[2026-07-01]** Botão "Exportar Excel" da DRE: exporta a tabela filtrada atual da DRE em `.xls` e remove o fundo de teste FIDC Alpha Senior da seed, telas e banco — _João_ · branch `feat/exportar-dre-excel`.
- [x] **[2026-07-01]** Cadastrar fundos reais (APUAMA, BRISTOL) e importar planilhas QITECH — _João_.
- [x] **[2026-06-30]** Fazer a tela DASHBOARDS pegar os dados reais da table `CARTEIRAS`: cards do dashboard agora usam a última carteira importada por fundo para PL, cotas superiores e rentabilidades — _João_ · branch `feat/dashboard-carteiras`.
- [x] **[2026-06-30]** Criação API para importar carteira e caixa Singulare: tabelas `CARTEIRAS`/`CAIXAS`, importação via DRE, classificação de carteira, DRE/Variação ajustada por compras/liquidações e conciliação separada — _João_ · branch `feat/criação-api`.
- [x] **[2026-06-26]** TASK 10 — Caixa da empresa: matriz de visualização + input diário por fundo, migration `add_cash_daily_balances`, seed dos 4 fundos (CNPJ placeholder), backfill `cash_backfill.py` — _Juan_ · PR #1. Pendências: validar UI ao vivo e rodar o backfill em `--dry-run`.
- [x] **[2026-06-25]** Banco de produção configurado no schema `OSHER` (Railway compartilhado): migrations + seed — _Juan_
- [x] **[2026-06-25]** Reconhecimento do projeto → `docs/PROJECT-MAP.md` — _Juan_
- [x] TASK 1–8 (base, banco, auth, layout, fundos, DRE, caixa-dos-fundos, dashboard) — ver histórico no `CLAUDE.md`

---

## 🧱 Decisões / convenções de equipe
- **`main` é sagrada**: sempre deployável (Vercel faz deploy automático dela). Nada quebrado vai pra `main`.
- **Branch por task + PR**: `git checkout -b feat/<nome>`; ao terminar, PR e o outro revisa.
- **Banco é COMPARTILHADO** (schema `OSHER`, mesma instância do CRM): só **uma pessoa mexe no schema/migrations por vez**. Avise aqui em "Em andamento" antes de criar migration. Depois do merge, o outro roda `prisma migrate deploy` (pelo binário — ver `CLAUDE.md`) para sincronizar.
- **Segredos**: `.env` é local e gitignored — nunca commitar. Mudou alguma variável? Atualize o `.env.example` (só os nomes, sem valores) e avise aqui.
- **Sincronize sempre**: `git pull` antes de começar e antes de abrir PR.

---

## ⚠️ Bloqueios / pendências
- Resumo diário de PDD: OSHER já calcula, salva em `PDD_RESUMOS_DIARIOS`, exibe o card na tela PDD e devolve `analiseTexto` para o N8N. Paramos em 2026-08-14 na etapa de disparo de e-mail pelo N8N porque SMTP/Outlook exigiu configuração Microsoft Entra/OAuth; retomar depois definindo se o envio ficará no N8N via Microsoft Graph, SMTP AUTH habilitado ou outro provedor.
- pnpm v11 bloqueia build scripts → o wrapper `corepack pnpm --filter ... <script>` falha. Workaround documentado no `CLAUDE.md` (rodar Prisma pelo binário). _Resolver de vez configurando `onlyBuiltDependencies`._
- [2026-08-20] A senha do Postgres já havia sido rotacionada no Railway, mas só o `.env` da raiz tinha o valor novo — `packages/database/.env` e `apps/web/.env` ainda estavam com a senha antiga (por isso `prisma migrate status/deploy` falhava com `P1000` mesmo com a app rodando normalmente). Os três `.env` locais foram sincronizados com a senha atual. **Falta confirmar/atualizar a `DATABASE_URL` na Vercel** com o mesmo valor.
