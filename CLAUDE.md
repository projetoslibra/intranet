# OSHER — Contexto do Projeto

## O que é este projeto
Aplicação web financeira interna da OSHER para gestão de fundos de investimento.
Acesso restrito à diretoria e equipe financeira.

## Stack definida
- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui + lucide-react
- Prisma ORM
- PostgreSQL (Docker local / Neon em produção)
- Auth.js (NextAuth v5) com e-mail e senha
- Recharts (gráficos)
- TanStack Table (tabelas)
- Zod (validação)

## Estrutura de pastas
```txt
osher-finance-app/
  apps/web/src/
    app/          -> rotas, páginas, layouts
    components/   -> componentes reutilizáveis
    features/     -> módulos de negócio
    lib/          -> prisma, auth, formatadores, utils
    server/       -> regras server-side
  packages/database/ -> schema Prisma, migrations, seeds
  scripts/imports/   -> scripts Python para CSV/Excel
  docs/
```

## Identidade visual
- Nome exibido: OSHER
- Tom: executivo, limpo, profissional
- Cores: a definir (dark sidebar + conteúdo claro)

## Perfis de usuário
ADMIN | DIRETOR | SOCIO | FINANCEIRO | LEITURA

## Permissões granulares
- dashboard.view
- funds.view
- funds.manage
- quotes.view
- quotes.import
- dre.view
- dre.import
- cash.view
- cash.manage
- users.manage
- reports.export

## Módulos planejados (roadmap)
1. Base do projeto
2. Banco de dados
3. Autenticação + login
4. Layout executivo (sidebar + topbar)
5. Usuários e permissões
6. Cadastro de fundos
7. Cotas e rentabilidade
8. Dashboard financeiro
9. DRE dos fundos
10. Caixa da empresa
11. Importação de dados (CSV/Excel)
12. Relatórios gerenciais
13. Auditoria e segurança
14. Deploy (Vercel + Neon)

## Status atual
- [x] TASK 0 — CLAUDE.md criado
- [ ] TASK 1 — Estrutura do projeto + Next.js iniciado (estrutura criada; validação pendente de Node.js/npm no PATH)
- [x] TASK 2 — Docker + PostgreSQL + Prisma configurado
- [x] TASK 3 — Auth.js + login funcionando
- [x] TASK 4 — Layout executivo (sidebar + topbar + dashboard vazio)
- [x] TASK 5 — Módulo de Fundos + Script de Importação QITECH
- [x] TASK 6 — DRE dos fundos com dados reais

## Trabalho em equipe (IMPORTANTE — ler no início de cada sessão)
- O projeto é tocado por mais de uma pessoa, todas via Claude Code. O quadro de coordenação fica em `docs/TASKS.md`.
- **No início de cada sessão**: `git pull`, ler `docs/TASKS.md` e este `CLAUDE.md`. **Antes de finalizar**: atualizar `docs/TASKS.md` (mover tasks entre Em andamento / Concluídas) e commitá-lo junto.
- **Fluxo de git**: `main` é sempre deployável (Vercel faz deploy automático dela). Trabalhar em **branch por task** (`feat/...`, `fix/...`) e abrir **PR** para a `main` — não fazer push direto na `main` sem alinhar com o outro.
- **Banco compartilhado**: o schema `OSHER` é único e compartilhado. Só uma pessoa cria migration por vez; registrar em `docs/TASKS.md` antes. Após merge, o outro roda `prisma migrate deploy` para sincronizar.
- Ao mudar variáveis de ambiente, atualizar `.env.example` (só nomes, sem valores) e avisar em `docs/TASKS.md`.

## Convenções
- Valores financeiros: Decimal (nunca float)
- Formatação de moeda: `Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })`
- Formatação de datas: `Intl.DateTimeFormat("pt-BR")`
- Idioma do código: inglês (variáveis, funções, schema)
- Idioma da interface: português brasileiro
- Para rodar scripts do database, sempre usar `corepack pnpm --filter @osher/database <script>` e não `corepack pnpm <script>` na raiz.
  - ATENÇÃO: o pnpm v11 bloqueia build scripts e faz o wrapper de script falhar com `ERR_PNPM_IGNORED_BUILDS`. Enquanto isso não for resolvido (`pnpm approve-builds` ou `pnpm.onlyBuiltDependencies` no package.json), rode o Prisma direto pelo binário: a partir de `packages/database`, `./node_modules/.bin/prisma <cmd>` (ex.: `migrate deploy`, `generate`) e `./node_modules/.bin/tsx prisma/seed.ts`.
- BANCO DE DADOS (atualizado em 2026-06-25): Railway, host `trolley.proxy.rlwy.net:56227`, banco `railway`. É uma instância COMPARTILHADA, multi-tenant por schema (o CRM/intranet vive em `public`; há ainda `MesaRV`, `cambio`, `rh`, `DashboardSquadLeaders`). **O OSHER usa o schema dedicado `OSHER`** — a `DATABASE_URL` é a mesma string do projeto, acrescida de `&schema=OSHER` no final. NUNCA rodar migrations sem o `&schema=OSHER`, sob risco de criar tabelas no `public` (CRM). O host antigo `metro.proxy.rlwy.net:20041` registrado anteriormente está OBSOLETO.
  - Schema `OSHER` já migrado e seedado (16 tabelas + dados da seed). NÃO rodar `migrate` na Vercel — só no setup; o deploy apenas lê/escreve dados.
  - A connection string completa (com senha) NÃO fica versionada — apenas nos arquivos `.env` locais (gitignored: raiz, `apps/web/`, `packages/database/`) e nas Environment Variables da Vercel.

## Observações importantes
- Caminho atual do projeto: `C:\PROGRAMAS-JP\osher-finance-app`.
- Cada TASK deve ser executada e validada antes de iniciar a próxima.
- Após cada TASK concluída, atualizar o status neste arquivo.
- Scripts de importação serão em Python separado do Next.js.
- Credenciais de desenvolvimento do PostgreSQL local: banco `osher_db`, usuário `osher`, senha `osher123`, porta `5432`.
- Credenciais do usuário admin seed: email `admin@osher.com.br`, senha `Admin@2024`.
- Script de importação QITECH: `scripts/imports/qitech_importer.py`.
- Dependências Python do importador: `scripts/imports/requirements.txt`.
- Contas DRE padrão seedadas no banco para despesas, PDD e receitas.
- Repositório GitHub: `https://github.com/projetoslibra/intranet.git`.
- Deploy: Vercel conectado ao repositório GitHub. URL de produção: `https://osher-lilac.vercel.app`.
- Variáveis de ambiente necessárias na Vercel (Production/Preview/Development): `DATABASE_URL` (com `&schema=OSHER`), `NEXTAUTH_SECRET`, `NEXTAUTH_URL` (em produção = a URL pública do deploy). Os valores reais ficam só na Vercel e nos `.env` locais — não versionar.
- Caminho real do repositório nesta máquina: `C:\Users\Juan Carneiro\Documents\GitHub\intranet` (o repo se chama `intranet`, mas contém o monorepo `osher-finance-app`).

## Atualizacoes recentes
- [x] TASK 7 - DRE com abas Carteira e DRE/Variacao + fluxos de caixa dos fundos.
- Nova tabela `FundCashFlow` (`fund_cash_flows`) armazena aplicacoes/resgates dos fundos importados do demonstrativo de caixa QITECH.
- Tela DRE possui duas abas: `Carteira` para valores absolutos e `DRE / Variacao` para delta diario ajustado por aplicacoes/resgates.
- [x] TASK 8 - Dashboard principal com PL por classe, KPIs consolidados e rentabilidades reais dos fundos.
- [2026-06-25] Banco de produção configurado: schema `OSHER` no Railway compartilhado (`trolley.proxy.rlwy.net:56227`), migrations aplicadas e seed executada (admin, role ADMIN, 11 permissões, 14 contas DRE).
- [x] TASK 10 — Caixa da empresa com input manual de posição diária.
- Nova tabela `CompanyCashDailyBalance` (`company_cash_daily_balances`) para snapshots diários de saldo por fundo.
- Tabelas existentes `company_cash_accounts` e `company_cash_transactions` mantidas intocadas.
- Fundos no Caixa: Antena, Apuama, Bristol, Consignado (criados na seed com **CNPJ placeholder `PENDENTE-<NOME>`**, tipo `OUTRO` e data placeholder — substituir pelos dados reais quando disponíveis).
- Tela com matriz de visualização (linhas=contas, colunas=fundos) + formulário de input por data. `Caixa = Conta pgto − Reserva − Usado` (calculado em runtime, `Prisma.Decimal`, nunca float).
- Decisão: "Reserva" (`reserveBalance`) foi incluída como input/linha (consta no schema Zod e na fórmula), embora o texto da task listasse só 4 inputs.
- Gate de permissões granular criado em `apps/web/src/lib/permissions.ts` (`cash.view`/`cash.manage`), consultando roles→permissions (a sessão só carrega o nome do role).
- Backfill histórico: `scripts/imports/cash_backfill.py` (lê Google Sheets via CSV público, idempotente). Atenção: o psycopg2 não entende `&schema=OSHER` — o script remove o param e faz `SET search_path TO "OSHER"`.
- Padrão: Server Components + Server Actions + Zod. Componentes em `apps/web/src/features/cash/`. Detalhe de reconhecimento do projeto em `docs/PROJECT-MAP.md`.
