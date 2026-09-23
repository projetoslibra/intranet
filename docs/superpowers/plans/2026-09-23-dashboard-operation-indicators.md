# Dashboard Operation Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar prazo médio ponderado e taxa média efetiva a.m. ponderada das últimas aquisições de APUAMA e BRISTOL, congelando componentes reutilizáveis por fundo e data.

**Architecture:** Um cálculo financeiro puro recebe as operações elegíveis e devolve VOP, quantidade, numeradores e denominadores. O serviço atual de VOP persiste esses componentes de forma imutável e o Dashboard deriva as médias do snapshot mais recente.

**Tech Stack:** Next.js 14, TypeScript, Prisma 6, PostgreSQL, Node test runner com `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-23-dashboard-operation-indicators-design.md`

## Global Constraints

- Somente APUAMA e BRISTOL no Dashboard.
- Filtrar `dataReferencia = dataAquisicao = data do snapshot`.
- Ponderar prazo e taxa por `valorAquisicao` positivo.
- Converter cada `taxaCessao` de a.a. para taxa efetiva a.m. antes da ponderação.
- Nunca atualizar `amount` nem componentes que já tenham sido congelados.
- Calcular valores financeiros com `Prisma.Decimal`.
- Não implementar filtros históricos, cedente ou sacado nesta entrega.

---

### Task 1: Cálculo financeiro puro

**Files:**
- Create: `apps/web/src/server/dashboard/operation-indicators.ts`
- Create: `apps/web/src/server/dashboard/operation-indicators.test.ts`

**Interfaces:**
- Produces: `calculateOperationIndicators(rows): OperationIndicatorCalculation`.
- Produces: estado `ready`, `empty` ou `invalid`, VOP, quantidade e quatro componentes ponderados.

- [ ] Escrever testes falhando com valores literais para prazo ponderado, conversão individual a.m., diferença para média simples, peso zero, peso negativo e campo ausente.
- [ ] Executar `corepack pnpm --dir apps/web exec tsx --test src/server/dashboard/operation-indicators.test.ts` e confirmar falha pela ausência da implementação.
- [ ] Implementar o cálculo mínimo com `Prisma.Decimal`, incluindo `(1 + taxaCessao)^(1/12) - 1` por operação.
- [ ] Reexecutar o teste e confirmar aprovação.
- [ ] Commitar como `feat: calculate weighted operation indicators`.

### Task 2: Snapshot e backfill imutável

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260923190000_add_vop_operation_indicators/migration.sql`
- Modify: `apps/web/src/server/dashboard/vop-snapshots.ts`
- Modify: `apps/web/src/server/dashboard/vop-snapshots.test.ts`

**Interfaces:**
- Consumes: `calculateOperationIndicators` da Task 1.
- Produces: snapshots novos completos e `completeSnapshotIndicatorsOnce`, que só atualiza registros com `indicatorsCalculatedAt = null`.

- [ ] Escrever testes falhando que comprovem criação completa, backfill sem alterar `amount`, segunda execução sem alteração, erro de qualidade e consolidação por soma dos componentes.
- [ ] Executar os testes de snapshot e confirmar as falhas esperadas.
- [ ] Adicionar `operationCount`, `termWeightedValue`, `termWeightAmount`, `monthlyRateWeightedValue`, `monthlyRateWeightAmount` e `indicatorsCalculatedAt` como colunas opcionais.
- [ ] Integrar cálculo, criação e preenchimento condicional ao serviço e preservar a janela de estabilidade e o resultado por fundo.
- [ ] Validar Prisma, gerar client e executar os testes até passarem.
- [ ] Commitar como `feat: persist weighted operation snapshots`.

### Task 3: Exibição no Dashboard

**Files:**
- Modify: `apps/web/src/server/dashboard/vop-snapshots.ts`
- Modify: `apps/web/src/server/dashboard/vop-display.ts`
- Modify: `apps/web/src/server/dashboard/vop-display.test.ts`
- Modify: `apps/web/src/app/dashboard/page.tsx`

**Interfaces:**
- Produces: `termLabel` em dias e `monthlyRateLabel` com `% a.m.` no `VopDisplay`.

- [ ] Escrever testes falhando para `29,12 dias`, `3,2795% a.m.` e `Indisponível`.
- [ ] Derivar as médias do último snapshot sem média de médias e formatá-las.
- [ ] Transformar o bloco do VOP em grade responsiva com quatro indicadores e uma data comum.
- [ ] Executar testes direcionados e typecheck até passarem.
- [ ] Commitar como `feat: show weighted indicators on dashboard`.

### Task 4: Verificação e entrega

**Files:**
- Modify: `docs/TASKS.md`

- [ ] Executar juntos os testes de cálculo, snapshot, display e cron.
- [ ] Executar validação Prisma, typecheck e build de produção.
- [ ] Conferir o diff, atualizar a task como concluída e commitar a documentação.
- [ ] Antes do deploy, aplicar a migration no schema `OSHER`; depois publicar, chamar o cron uma vez e reconciliar os valores com `FIDC_ESTOQUES`.
