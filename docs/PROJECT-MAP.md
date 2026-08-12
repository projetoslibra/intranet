# PROJECT-MAP — Mapa do estado atual do projeto OSHER

> Relatório de reconhecimento (TASK 0). **Somente leitura** — nenhum arquivo do projeto foi modificado além deste documento.
> Gerado em 2026-06-25.

> **Aviso de atualização (12/08/2026):** este arquivo é o retrato histórico do início do projeto e várias seções abaixo estão desatualizadas. Para o estado atual do módulo operacional do Consignado, use [`OPERACIONAL-CONSIGNADO.md`](./OPERACIONAL-CONSIGNADO.md) e, para entregas recentes, [`TASKS.md`](./TASKS.md). Não use as contagens antigas de models, migrations ou páginas deste mapa como inventário atual.

> ⚠️ **Nota sobre o nome do repositório**: o `CLAUDE.md` diz que o projeto fica em `C:\PROGRAMAS-JP\osher-finance-app`. O repositório real analisado está em `C:\Users\Juan Carneiro\Documents\GitHub\intranet` (remote `projetoslibra/intranet`). O conteúdo é o mesmo monorepo `osher-finance-app`.

---

## 1. Estrutura de pastas

Monorepo (workspaces pnpm) com 3 áreas: `apps/web`, `packages/database`, `scripts/imports`.

```txt
intranet/
├─ apps/web/                      # App Next.js 14 (App Router)
│  ├─ middleware.ts               # Proteção de rotas via JWT NextAuth
│  ├─ next.config.mjs / tailwind.config.ts / tsconfig.json / components.json
│  └─ src/
│     ├─ app/
│     │  ├─ layout.tsx            # Root layout
│     │  ├─ page.tsx              # "/" → redirect para /login
│     │  ├─ login/page.tsx
│     │  ├─ api/auth/[...nextauth]/route.ts
│     │  └─ dashboard/
│     │     ├─ layout.tsx         # Shell + guarda de sessão
│     │     ├─ page.tsx           # Dashboard principal (IMPLEMENTADO)
│     │     ├─ fundos/
│     │     │  ├─ page.tsx        # Lista de fundos (IMPLEMENTADO)
│     │     │  ├─ novo/page.tsx + actions.ts   # Cadastro de fundo (IMPLEMENTADO)
│     │     │  └─ [id]/page.tsx   # Detalhe do fundo (IMPLEMENTADO)
│     │     ├─ dre/page.tsx       # DRE c/ abas Carteira/Variação (IMPLEMENTADO)
│     │     ├─ caixa/page.tsx     # PLACEHOLDER (só título)
│     │     ├─ usuarios/page.tsx  # PLACEHOLDER (só título)
│     │     └─ relatorios/page.tsx# PLACEHOLDER (só título)
│     ├─ components/
│     │  ├─ dashboard-shell.tsx   # Sidebar + topbar
│     │  ├─ funds-table.tsx       # TanStack Table client
│     │  └─ fund-form.tsx         # Form de cadastro (client)
│     ├─ lib/
│     │  ├─ prisma.ts             # Singleton PrismaClient
│     │  ├─ auth.ts               # NextAuth v5 (Credentials)
│     │  ├─ formatters.ts         # formatCurrency/Decimal/Percent/Date
│     │  └─ utils.ts              # cn()
│     └─ types/next-auth.d.ts     # Augmentation do tipo Session/JWT
├─ packages/database/
│  ├─ package.json                # scripts db:generate/migrate/seed/studio
│  └─ prisma/
│     ├─ schema.prisma            # 16 models, 11 enums
│     ├─ seed.ts                  # Seed admin + roles + permissões + DRE accounts + 1 fundo
│     └─ migrations/
│        ├─ 20260428143613_init_schema/migration.sql
│        ├─ 20260512120000_add_fund_cash_flow/migration.sql
│        └─ migration_lock.toml
├─ scripts/imports/
│  ├─ qitech_importer.py          # Importador XLSX QITECH → Postgres
│  ├─ requirements.txt
│  ├─ APUAMA/ ... (planilhas .xlsx de exemplo)
│  └─ BRISTOL/ ... (planilhas .xlsx de exemplo)
├─ docs/
│  ├─ installation.md
│  └─ PROJECT-MAP.md              # (este arquivo)
├─ .env.example                   # DATABASE_URL / NEXTAUTH_SECRET / NEXTAUTH_URL (vazios)
└─ CLAUDE.md
```

**Observação importante**: não existem as pastas `features/`, `server/` nem `app/api/` (além de auth) descritas no roadmap do `CLAUDE.md`. A lógica de negócio mora diretamente nas `page.tsx` (Server Components) e em **Server Actions**. Não há diretório `features/` por módulo.

### Módulos/features que já existem
| Módulo | Estado |
|---|---|
| Autenticação / Login | ✅ Implementado |
| Layout executivo (sidebar + topbar) | ✅ Implementado |
| Dashboard principal | ✅ Implementado (PL por classe + rentabilidades) |
| Fundos (lista / detalhe / cadastro) | ✅ Implementado |
| DRE (Carteira + DRE/Variação) | ✅ Implementado |
| Caixa | 🚧 Placeholder (página vazia) |
| Usuários | 🚧 Placeholder (página vazia) |
| Relatórios | 🚧 Placeholder (página vazia) |
| Importação QITECH (Python) | ✅ Implementado (script CLI) |

---

## 2. Schema Prisma completo

Arquivo: [packages/database/prisma/schema.prisma](../packages/database/prisma/schema.prisma)
Datasource: PostgreSQL via `env("DATABASE_URL")`. Generator: `prisma-client-js`.

### Enums (11)
| Enum | Valores |
|---|---|
| `UserStatus` | ACTIVE, INACTIVE, BLOCKED |
| `FundType` | FIDC, FII, FIM, FIA, RENDA_FIXA, MULTIMERCADO, OUTRO |
| `FundStatus` | ACTIVE, INACTIVE, CLOSED |
| `FundAccessLevel` | VIEW, MANAGE |
| `DreAccountType` | REVENUE, EXPENSE, ASSET, LIABILITY, EQUITY |
| `CashAccountType` | CHECKING, SAVINGS, INVESTMENT, OTHER |
| `CashAccountStatus` | ACTIVE, INACTIVE, CLOSED |
| `CashTransactionType` | CREDIT, DEBIT |
| `ImportModule` | FUNDS, QUOTES, DRE, CASH, POSITIONS, USERS |
| `ImportStatus` | PENDING, PROCESSING, COMPLETED, FAILED |

### Models (16)

| Model | `@@map` (tabela) | Campos principais | Relações |
|---|---|---|---|
| `User` | `users` | id, name, email (unique), passwordHash, status, createdAt, updatedAt | → AuditLog[], UserFundAccess[], ImportBatch[], UserRole[] |
| `Role` | `roles` | id, name (unique), description | → RolePermission[], UserRole[] |
| `Permission` | `permissions` | id, key (unique), description | → RolePermission[] |
| `UserRole` | `user_roles` | PK composta (userId, roleId) | User ↔ Role (join) |
| `RolePermission` | `role_permissions` | PK composta (roleId, permissionId) | Role ↔ Permission (join) |
| `Fund` | `funds` | id, name, shortName, cnpj (unique), fundType, status, startDate(Date), timestamps | → DreEntry[], FundCashFlow[], FinancialPosition[], FundQuote[], UserFundAccess[] |
| `UserFundAccess` | `user_fund_accesses` | PK composta (userId, fundId), accessLevel | User ↔ Fund (join) |
| `FundQuote` | `fund_quotes` | id, fundId, quoteDate(Date), quotaValue(20,8), netAssetValue(20,2), sharesQuantity(20,8), dailyReturn(12,8), monthReturn(12,8), yearReturn(12,8) — **unique(fundId, quoteDate)** | → Fund |
| `DreAccount` | `dre_accounts` | id, code (unique), name, type(DreAccountType) | → DreEntry[] |
| `DreEntry` | `dre_entries` | id, fundId, accountId, referenceDate(Date), amount(20,2), description?, source — **index(fundId, referenceDate)** | → DreAccount (Restrict), Fund (Cascade) |
| `CompanyCashAccount` | `company_cash_accounts` | id, name, bankName, accountType, status | → CompanyCashTransaction[] |
| `CompanyCashTransaction` | `company_cash_transactions` | id, cashAccountId, transactionDate(Date), description, type, amount(20,2), category, source — **index(cashAccountId, transactionDate)** | → CompanyCashAccount |
| `FinancialPosition` | `financial_positions` | id, fundId, positionDate(Date), assetClass, assetName, quantity(20,8), grossValue(20,2), netValue(20,2) — **index(fundId, positionDate)** | → Fund |
| `FundCashFlow` | `fund_cash_flows` | id, fundId, flowDate(Date), description, flowType, assetClass, assetCode, amount(20,6), source(default "QITECH"), createdAt — **unique(fundId, flowDate, description, flowType, assetCode)** | → Fund |
| `ImportBatch` | `import_batches` | id, importedByUserId, module, fileName, status, totalRows, importedRows, errorRows, createdAt | → User (Restrict) |
| `AuditLog` | `audit_logs` | id, userId?, action, entity, entityId?, metadata(Json?), createdAt — **index(entity,entityId) + (userId,createdAt)** | → User (SetNull) |

### Grafo de relações (resumo)
- **`Fund`** é o hub central: liga-se a `FundQuote`, `FinancialPosition`, `FundCashFlow`, `DreEntry` e `UserFundAccess`.
- **RBAC**: `User` —(`UserRole`)— `Role` —(`RolePermission`)— `Permission`.
- **`DreEntry`** referencia tanto `Fund` quanto `DreAccount`.
- **`AuditLog`** e **`ImportBatch`** referenciam `User`.
- **`CompanyCashAccount` / `CompanyCashTransaction`** são o caixa da empresa — **independentes de `Fund`** (não usados por nenhuma página ainda).

> Observação: valores monetários usam `Decimal` (correto, conforme convenção). Datas de negócio usam `@db.Date`.

---

## 3. Tabelas no banco de dados

✅ **Conectado ao banco real** (Railway, instância `trolley.proxy.rlwy.net:56227`, banco `railway`) em 2026-06-25.

**Descoberta crítica**: esta instância Railway é **multi-tenant por schema** — vários projetos da Libra dividem o mesmo banco `railway`, cada um em seu schema:

| Schema | Conteúdo | Tabelas |
|---|---|---|
| `public` | **CRM / intranet** (outro projeto) | 46 (`crm_cards`, `crm_interacoes`, `account_advisor`, `rm_reports_*`, `portfolio_positions`, `margens_*`, `consignado_*`, `boletos`, `users`...) |
| `OSHER` | **Este projeto (OSHER Finance)** | **0 — schema vazio, reservado** |
| `MesaRV` | Mesa de renda variável | — |
| `cambio` | Câmbio | — |
| `rh` | RH | — |
| `DashboardSquadLeaders` | Dashboard | — |

> ⚠️ As 16 tabelas do OSHER (`funds`, `fund_quotes`, `dre_entries`, etc.) **ainda não existem no banco**. O schema `OSHER` está vazio. As migrations Prisma do OSHER (`init_schema`, `add_fund_cash_flow`) **nunca foram aplicadas** nesta instância — o `_prisma_migrations` que existe (3 linhas) é do CRM, no schema `public`.

**Configuração adotada**: a `DATABASE_URL` do OSHER usa a **mesma string** do CRM acrescida de `&schema=OSHER`, isolando as tabelas do OSHER no schema `OSHER` sem tocar no `public` do CRM. (Os `.env` foram criados em raiz, `apps/web/` e `packages/database/` — todos no `.gitignore`.)

**Tabelas que serão criadas no schema `OSHER`** ao rodar as migrations (16, idênticas aos 16 `@@map` do schema — divergência schema↔migrations: nenhuma):

```
audit_logs · company_cash_accounts · company_cash_transactions · dre_accounts ·
dre_entries · financial_positions · fund_cash_flows · fund_quotes · funds ·
import_batches · permissions · role_permissions · roles · user_fund_accesses ·
user_roles · users
```

> Nota: o host atual (`trolley...:56227`) difere do que o `CLAUDE.md` registra (`metro.proxy.rlwy.net:20041`). A `CLAUDE.md` está desatualizada quanto ao host/banco.

**Próximo passo para popular o banco**: rodar `prisma migrate deploy` + seed apontando para `&schema=OSHER` (ver seção final).

---

## 4. Fundos existentes

✅ **Consulta executada** em `OSHER.funds`: **a tabela ainda não existe** (schema `OSHER` vazio). Portanto **não há fundos cadastrados** no banco até o momento.

Tabela de fundos (após migration): **`OSHER.funds`** (model `Fund`).

O que será criado quando rodarmos migration + seed:
- **Seed** ([seed.ts](../packages/database/prisma/seed.ts)) cria usuários/permissões, contas DRE e os fundos operacionais do Caixa.
- As pastas `scripts/imports/APUAMA/` e `scripts/imports/BRISTOL/` contêm planilhas QITECH — os fundos **APUAMA** e **BRISTOL** devem existir em `funds` antes de importar cotas/posições (o importador localiza o fundo por nome via `find_fund_id`).

> ⚠️ Atenção: a tabela `public.users` (do CRM) **não** é a mesma `OSHER.users`. São schemas isolados — o login do OSHER usará `OSHER.users` (criada pela seed com `admin@osher.com.br`).

---

## 5. Rotas e páginas

Cada `page.tsx` em `apps/web/src/app/` é uma rota (App Router).

| Rota | Arquivo | Estado |
|---|---|---|
| `/` | app/page.tsx | ✅ Redirect → `/login` |
| `/login` | app/login/page.tsx | ✅ Implementado (form client, `signIn` credentials) |
| `/api/auth/[...nextauth]` | api/auth/[...nextauth]/route.ts | ✅ Handler NextAuth |
| `/dashboard` | dashboard/page.tsx | ✅ Implementado — KPIs (PL consolidado, nº de fundos) + cards por fundo (Sênior/Mezanino/Júnior + rentabilidades) |
| `/dashboard/fundos` | dashboard/fundos/page.tsx | ✅ Implementado — tabela filtrável |
| `/dashboard/fundos/novo` | dashboard/fundos/novo/page.tsx | ✅ Implementado — form + Server Action |
| `/dashboard/fundos/[id]` | dashboard/fundos/[id]/page.tsx | ✅ Implementado — métricas + histórico de cotas + posição da carteira |
| `/dashboard/dre` | dashboard/dre/page.tsx | ✅ Implementado — filtros de período + abas Carteira / DRE-Variação |
| `/dashboard/caixa` | dashboard/caixa/page.tsx | 🚧 **Placeholder** — só renderiza o título "Caixa" |
| `/dashboard/usuarios` | dashboard/usuarios/page.tsx | 🚧 **Placeholder** — só renderiza "Usuários" |
| `/dashboard/relatorios` | dashboard/relatorios/page.tsx | 🚧 **Placeholder** — só renderiza "Relatórios" |

**Exportações**: "Exportar Excel" na DRE baixa a tabela filtrada atual em arquivo `.xls`.

---

## 6. Sistema de permissões

### Onde estão definidos
- **Roles**: **não existe enum de role.** Roles são linhas na tabela `roles` (model `Role`). O seed cria apenas o role **`ADMIN`**. Os perfis do `CLAUDE.md` (DIRETOR, SOCIO, FINANCEIRO, LEITURA) **não estão seedados** — só existem como texto na documentação.
- **Permissões**: lista hardcoded no [seed.ts](../packages/database/prisma/seed.ts) (linhas 6–18), gravadas na tabela `permissions` (model `Permission`, campo `key`):
  `dashboard.view, funds.view, funds.manage, quotes.view, quotes.import, dre.view, dre.import, cash.view, cash.manage, users.manage, reports.export`.
- **Mapeamento role→permissão**: no seed, **todas** as 11 permissões são atribuídas ao role `ADMIN` via `role_permissions`. Não há mapeamento por outro role.

### Como o gate é feito
- **Middleware** ([apps/web/middleware.ts](../apps/web/middleware.ts)): apenas verifica **presença de token JWT** (autenticação), redirecionando para `/login` em rotas protegidas (`/dashboard`, `/fundos`, `/usuarios`, `/dre`, `/caixa`, `/relatorios`). **Não checa permissões.**
- **Layout do dashboard** ([dashboard/layout.tsx](../apps/web/src/app/dashboard/layout.tsx)): chama `auth()` e redireciona se não houver sessão.
- **Auth callback** ([lib/auth.ts](../apps/web/src/lib/auth.ts)): coloca no token/sessão apenas `role` = nome do **primeiro** role do usuário (`user.roles[0]?.role.name ?? "LEITURA"`). **Não carrega a lista de permissões na sessão.**

> ⚠️ **Conclusão**: existe a *infraestrutura de dados* para RBAC granular (tabelas roles/permissions/role_permissions), mas **não há enforcement de permissões na aplicação** hoje. A proteção atual é binária: autenticado vs. não autenticado. O `role` fica disponível em `session.user.role`, porém nenhuma página/action consome permissões `*.view`/`*.manage`. Não há hook nem wrapper `can()`/`hasPermission()`.

---

## 7. Padrão de módulo (referência: Fundos + DRE)

Não há camada `features/` nem tRPC/React Query. O padrão é **Next.js App Router puro**:

- **Organização**: a lógica vive na própria `page.tsx` como **Server Component async**. Componentes interativos isolados em `components/` com `"use client"`.
- **Camada server / data fetching**:
  - **Leitura**: feita **direto no Server Component** via `prisma.*` importado de [lib/prisma.ts](../apps/web/src/lib/prisma.ts) (singleton). Ex.: `dashboard/page.tsx`, `dre/page.tsx`, `fundos/page.tsx` chamam `prisma.fund.findMany(...)` no corpo do componente. **Sem API routes, sem React Query, sem SWR.**
  - **Escrita**: via **Server Actions** (`"use server"`). Único exemplo: [fundos/novo/actions.ts](../apps/web/src/app/dashboard/fundos/novo/actions.ts) → `createFundAction`, usado no client com `useFormState`/`useFormStatus`. Faz `revalidatePath` + `redirect` após salvar.
- **Validação Zod**: usada nas Server Actions. Em `actions.ts`, `createFundSchema` valida com `z.object`, regex de CNPJ, `z.enum` para tipo/status; erros retornados via `parsed.error.flatten().fieldErrors` e exibidos campo a campo no form. (Zod **não** é usado nas leituras.)
- **Tratamento de erro**: a action captura `P2002` (unique violation do Prisma) para mensagem amigável de CNPJ duplicado.
- **Formatação moeda/data**: helpers centrais em [lib/formatters.ts](../apps/web/src/lib/formatters.ts) (`formatCurrency`, `formatDecimal`, `formatPercent`, `formatDate`, todos `pt-BR`). ⚠️ Inconsistência: `dashboard/page.tsx` e `dre/page.tsx` **redefinem seus próprios formatters locais** (com `timeZone: "UTC"` e casas decimais diferentes) em vez de usar os de `lib/formatters.ts`.
- **Conversão Decimal**: valores `Decimal` do Prisma são convertidos com `Number(...)` antes de formatar/renderizar.

---

## 8. Seeds e scripts de importação

### Seed ([packages/database/prisma/seed.ts](../packages/database/prisma/seed.ts))
Roda via `corepack pnpm --filter @osher/database db:seed` (`tsx prisma/seed.ts`). Idempotente (usa `upsert`). Cria:
1. **Usuário admin** — `admin@osher.com.br` / senha `Admin@2024` (bcrypt, 12 rounds), status ACTIVE.
2. **Role `ADMIN`** + vínculo `userRole` admin↔ADMIN.
3. **11 permissões** (lista da seção 6) + vínculo de **todas** ao role ADMIN.
4. **Fundos operacionais do Caixa** — Antena, Apuama, Bristol e Consignado com CNPJ placeholder `PENDENTE-<NOME>`.
5. **14 contas DRE** (`dre_accounts`): taxa_gestao, taxa_administracao, taxa_custodia, auditoria, servicos_cobranca, iof, cetip, selic, consultoria, rating, outras_despesas, pdd, receita_credito, receita_fundo. Tipo: `REVENUE` se começa com `receita_`, senão `EXPENSE`.

### Scripts de importação ([scripts/imports/](../scripts/imports/))
- **`qitech_importer.py`** — importador CLI de planilhas XLSX da QITECH para o Postgres (psycopg2 + openpyxl + python-dotenv).
  - Uso: `python qitech_importer.py <CARTEIRA.xlsx> <CAIXA.xlsx>`. Modo debug: `python qitech_importer.py --debug <arquivo>`.
  - Lê `DATABASE_URL` de `.env` em `root/`, `apps/web/` ou `packages/database/`.
  - **Do arquivo de carteira** extrai: cabeçalho (CLIENTE + Data de posição); seção Rentabilidade → `fund_quotes` (PL, valor/qtd cota, variações diária/mensal/anual); posições por seção (SRP→senior, MEZAN→mezanino, NTN-B→ntnb, DIR→direitos_creditorios, OUTROSFUNDOS→outros_fundos/direitos_creditorios) → `financial_positions`; PDD de "OutrosAtivos" → `financial_positions` (assetClass `pdd`); seção CPR → despesas `dre_entries` (categorizadas por histórico).
  - **Do arquivo de caixa** extrai: data do cabeçalho, Saldo em Tesouraria (só imprime), e fluxos "Aplicação no Fundo"/"Resgate do Fundo" → `fund_cash_flows` (com classificação de assetClass).
  - **Localização do fundo**: `find_fund_id` busca em `funds` por nome exato → ILIKE → por palavra-chave. O fundo precisa já existir.
  - **Upserts** com IDs determinísticos (`stable_id` = sha1 dos campos-chave) e `ON CONFLICT`.
  - ⚠️ O script grava em `financial_positions` colunas `grossValue`/`netValue`/`quantity`, mas **não grava** `market_unit_price`, `indexer` nem `maturity_date` (extraídos no dataclass mas ausentes do schema/INSERT). `treasury_balance` é apenas impresso, não persistido.
- **`requirements.txt`** — dependências Python do importador.
- **`APUAMA/`, `BRISTOL/`** — planilhas XLSX de exemplo (CARTEIRA/CAIXA + arquivos ATIVO_CARTEIRA_DIARIA / ATIVO_DEMONSTRATIVO_CAIXA).

---

## 9. Dependências relevantes ([apps/web/package.json](../apps/web/package.json))

| Categoria | Pacote | Versão |
|---|---|---|
| Framework | next | ^14.2.0 |
| | react / react-dom | ^18.3.1 |
| Linguagem | typescript | ^5.7.2 |
| ORM | @prisma/client | 6.19.0 (prisma 6.19 no pacote database) |
| Auth | next-auth | **5.0.0-beta.31** (v5 / Auth.js) |
| | bcryptjs | ^3.0.3 |
| UI / ícones | lucide-react | ^0.468.0 |
| Gráficos | recharts | ^2.15.0 (instalado, **ainda não usado** em nenhuma página) |
| Tabelas | @tanstack/react-table | ^8.20.5 (usado em funds-table) |
| Estilo | tailwindcss | ^3.4.17 |
| | class-variance-authority, clsx, tailwind-merge | — (helper `cn`) |
| Validação | zod | ^3.24.1 |

**Não presentes** (apesar de comuns/citados): `react-hook-form`, `date-fns`, e componentes `shadcn/ui` materializados — há `components.json` (config shadcn) e os utilitários CVA/clsx/tailwind-merge, mas **não há pasta `components/ui/`**; os componentes são escritos à mão com Tailwind. Não há libs de data fetching (React Query/SWR) nem cliente HTTP.

---

## Resumo (10 pontos principais)

1. Monorepo `apps/web` (Next 14 App Router) + `packages/database` (Prisma) + `scripts/imports` (Python). **Sem** `features/`, `server/` ou API routes além de auth.
2. Schema Prisma: **16 models / 11 enums**, hub central em `Fund`; migrations batem 1:1 com o schema (sem divergência detectável estaticamente).
3. **Não foi possível consultar o banco** (sem `.env`/`DATABASE_URL`) — seções 3 e 4 ficaram baseadas em migrations/seed; rodar as queries no Railway para confirmar tabelas e fundos reais.
4. Páginas implementadas: Dashboard, Fundos (lista/novo/detalhe), DRE. **Placeholders vazios**: Caixa, Usuários, Relatórios.
5. Auth: NextAuth v5 (Credentials e-mail/senha, JWT). Middleware só checa **autenticação**, não permissões.
6. **RBAC granular existe no banco mas não é aplicado**: seed cria só o role ADMIN com todas as permissões; nenhuma página consome `*.view`/`*.manage`.
7. Padrão de módulo: leitura via `prisma` direto em Server Components; escrita via **Server Actions** + Zod; sem React Query/SWR.
8. Formatadores centrais em `lib/formatters.ts`, mas Dashboard e DRE **duplicam** formatters locais (inconsistência a unificar).
9. Importador QITECH (Python) popula `fund_quotes`, `financial_positions`, `dre_entries`, `fund_cash_flows`; fundo precisa pré-existir; alguns campos extraídos não são persistidos.
10. `recharts` instalado mas não usado; `shadcn/ui` configurado mas sem `components/ui/`; perfis DIRETOR/SOCIO/FINANCEIRO/LEITURA só existem na documentação.
</content>
</invoke>
