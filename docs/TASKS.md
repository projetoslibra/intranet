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
| Tela PDD dos fundos | João | `feat/tela-pdd` | 2026-08-12 | Nova tela com indicadores, viradas futuras e matriz cedente/sacado por data |

---

## 🟡 Próximas (backlog priorizado)
> Pegue de cima para baixo. Se for começar, mova para "Em andamento".

- [ ] **OC-13 — Indicadores, permissões e auditoria operacional** — depende das telas anteriores
- [ ] **OC-14 — Testes, benchmark e homologação paralela** — contínua por entrega
- [ ] **Enforcement de permissões** — hoje o middleware só checa login, não as permissões `*.view`/`*.manage`
- [ ] **Unificar formatters** — Dashboard e DRE redefinem formatters em vez de usar `lib/formatters.ts`
- [ ] **Módulo Relatórios** (`/dashboard/relatorios`) — exportações (placeholder; deixar para o final)

---

## 🟢 Concluídas (recentes)
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
- pnpm v11 bloqueia build scripts → o wrapper `corepack pnpm --filter ... <script>` falha. Workaround documentado no `CLAUDE.md` (rodar Prisma pelo binário). _Resolver de vez configurando `onlyBuiltDependencies`._
- Senha do Postgres circulou em chat — **rotacionar no Railway** e atualizar `.env`/Vercel.
