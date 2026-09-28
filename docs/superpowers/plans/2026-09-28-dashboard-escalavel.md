# Dashboard Escalável Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar um dashboard comparativo, expansível e preparado para dez ou mais fundos, com VOP consolidado em uma data comum.

**Architecture:** Regras puras produzem o modelo consolidado; um loader servidor busca as fontes em lote e isola falhas; componentes de apresentação exibem KPIs e uma tabela cliente com busca, ordenação e expansão.

**Tech Stack:** Next.js 14, React 18, TypeScript, Prisma, Tailwind CSS, `node:test`/`tsx`.

**Spec:** `docs/superpowers/specs/2026-09-28-dashboard-escalavel-design.md`

## Global Constraints

- Sem migration.
- VOP integrado somente para Apuama e Bristol nesta rodada.
- Consolidados de VOP usam a última data de snapshot comum.
- Prazo e taxa permanecem individuais e ponderados pelo valor de aquisição.
- Estados distintos: `Sem operações`, `Não integrado` e `Sem dados`.
- Consultas de dados devem ser em lote, sem uma sequência nova de queries por fundo.

---

### Task 1: Modelo e consolidação do dashboard

**Files:**
- Create: `apps/web/src/server/dashboard/dashboard-overview.ts`
- Test: `apps/web/src/server/dashboard/dashboard-overview.test.ts`

**Interfaces:**
- Produces: `buildDashboardOverview(input): DashboardOverview`
- Produces: `DashboardOverview`, `DashboardFundRow` e `FundOperationalStatus`

- [ ] Escrever testes que falhem para data comum, totais diário/mensal, VOP zero, fundo não integrado, ausência de snapshot comum e falha isolada.
- [ ] Rodar `corepack pnpm exec tsx --test src/server/dashboard/dashboard-overview.test.ts` e confirmar falha pelo módulo ausente.
- [ ] Implementar a transformação pura e os estados do domínio.
- [ ] Repetir o teste e confirmar sucesso.
- [ ] Commit: `feat: adiciona consolidacao escalavel do dashboard`.

### Task 2: Loader em lote

**Files:**
- Create: `apps/web/src/server/dashboard/dashboard-data.ts`
- Modify: `apps/web/src/app/dashboard/page.tsx`
- Test: `apps/web/src/server/dashboard/dashboard-data.test.ts`

**Interfaces:**
- Consumes: `buildDashboardOverview(input)`
- Produces: `loadDashboardOverview(): Promise<DashboardOverview>`

- [ ] Criar teste com repositório controlado que exija chamadas em lote e preserve os demais fundos quando uma fonte estiver indisponível.
- [ ] Confirmar RED com o loader ausente.
- [ ] Extrair do `page.tsx` a coleta de carteira, caixa e snapshots; carregar conjuntos por fonte e agrupar por fundo em memória.
- [ ] Manter o cálculo atual de PL, composição, rentabilidades, receita e custo.
- [ ] Confirmar GREEN e executar os testes de dashboard existentes.
- [ ] Commit: `refactor: carrega dashboard em lote`.

### Task 3: Tabela comparativa e detalhes expansíveis

**Files:**
- Create: `apps/web/src/features/dashboard/components/DashboardKpis.tsx`
- Create: `apps/web/src/features/dashboard/components/FundOverviewTable.tsx`
- Create: `apps/web/src/features/dashboard/fund-overview-state.ts`
- Test: `apps/web/src/features/dashboard/fund-overview-state.test.ts`
- Modify: `apps/web/src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `DashboardOverview`
- Produces: busca, ordenação e expansão exclusiva de uma linha.

- [ ] Escrever testes que falhem para busca sem acentos, ordenações suportadas e alternância de uma única expansão.
- [ ] Implementar os helpers mínimos até os testes passarem.
- [ ] Criar os quatro KPIs com data de corte e cobertura explícitas.
- [ ] Criar tabela com cabeçalho fixo, rolagem horizontal visível, cores semânticas e estados legíveis.
- [ ] Criar detalhe inline com composição do PL, barra proporcional, rentabilidades, receita e custo.
- [ ] Substituir os cartões antigos no `page.tsx`.
- [ ] Rodar testes e typecheck.
- [ ] Commit: `feat: redesenha dashboard para comparacao de fundos`.

### Task 4: Verificação final

**Files:**
- Modify only if verification reveals a defect.

- [ ] Conferir no banco de produção, somente leitura, a data comum e os valores esperados de Apuama e Bristol.
- [ ] Rodar todos os testes `*.test.ts`/`*.test.tsx` com cliente Prisma gerado.
- [ ] Rodar `corepack pnpm typecheck`, `corepack pnpm lint` e `corepack pnpm build`.
- [ ] Revisar o diff contra a especificação e corrigir somente lacunas do escopo aprovado.
