# Conciliação do Consignado Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar filtros de data, cancelamento lógico de lotes e conciliação com diferença justificada às telas operacionais do Consignado.

**Architecture:** Manter os painéis atuais e ampliar suas APIs com filtros opcionais. Extrair o cálculo N:N para uma função pura testável; persistir alocações reais e ajustes justificados separadamente, de modo que estados e estornos continuem determinísticos e auditáveis.

**Tech Stack:** Next.js 14, React 18, TypeScript, Prisma 6, PostgreSQL, Zod, `node:test` executado por `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-18-conciliacao-consignado-filtros-ajustes-design.md`

## Global Constraints

- Não alterar os parsers, o matching de títulos nem a geração Daycoval já validados.
- Datas de processamento usam `America/Sao_Paulo`; datas bancárias usam o valor `DATE` armazenado.
- Cancelamento de lote é lógico e bloqueado quando existe remessa ativa.
- Diferença maior que zero exige justificativa e encerra os dois lados por ajuste auditável.
- Toda aritmética monetária de domínio usa `Prisma.Decimal`.
- Migração somente aditiva; dados históricos permanecem válidos.

---

### Task 1: Test harness e planejamento puro da conciliação

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/web/src/server/operational/consignado-reconciliation.ts`
- Test: `apps/web/src/server/operational/consignado-reconciliation.test.ts`

**Interfaces:**
- Produces: `planConsignadoReconciliation(input): ReconciliationPlan`
- `ReconciliationPlan` contém `entryTotal`, `remittanceTotal`, `allocatedTotal`, `difference`, `allocations`, `entryAdjustments` e `remittanceAdjustments`.

- [ ] **Step 1: Configurar o comando de teste**

Adicionar `tsx` às dependências de desenvolvimento do web e o script:

```json
"test:operational": "tsx --test src/server/operational/consignado-reconciliation.test.ts src/server/operational/consignado-date.test.ts"
```

- [ ] **Step 2: Escrever testes que falham para igualdade e diferenças**

Cobrir:

```ts
test("aloca valores iguais sem ajustes", () => { /* 53 contra 53 */ });
test("ajusta o excedente da entrada", () => { /* 53 contra 52.90 => 0.10 */ });
test("ajusta o excedente da remessa", () => { /* 52.90 contra 53 => 0.10 */ });
test("distribui N:N de forma determinística", () => { /* duas entradas e duas remessas */ });
```

- [ ] **Step 3: Executar os testes e confirmar falha**

Run: `corepack pnpm --filter @osher/web test:operational`

Expected: FAIL porque `planConsignadoReconciliation` ainda não existe.

- [ ] **Step 4: Implementar o planejador mínimo**

Usar tipos equivalentes a:

```ts
type Balance = { id: string; remaining: Prisma.Decimal };
type PlannedAllocation = { bankEntryId: string; remittanceId: string; amount: Prisma.Decimal };
type PlannedAdjustment = { entityId: string; amount: Prisma.Decimal };

export function planConsignadoReconciliation(input: {
  entries: Balance[];
  remittances: Balance[];
}): ReconciliationPlan;
```

O algoritmo aloca `min(entry.remaining, remittance.remaining)` e transforma os saldos restantes de apenas um lado em ajustes positivos.

- [ ] **Step 5: Executar os testes e confirmar sucesso**

Run: `corepack pnpm --filter @osher/web test:operational`

Expected: 4 testes passando.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/server/operational/consignado-reconciliation.ts apps/web/src/server/operational/consignado-reconciliation.test.ts
git commit -m "test: cobre ajustes da conciliacao do consignado"
```

### Task 2: Modelo persistente para ajustes auditáveis

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260818000000_add_consignado_bank_adjustments/migration.sql`

**Interfaces:**
- Produces: campos `adjustedAmount`, totais/diferença na conciliação e modelo `ConsignadoBankAdjustment`.

- [ ] **Step 1: Ampliar o schema Prisma**

Adicionar `adjustedAmount Decimal @default(0) @db.Decimal(24, 2)` em `ConsignadoBankCreditEntry` e `ConsignadoRemittance`.

Adicionar em `ConsignadoBankReconciliation`:

```prisma
entryTotalAmount      Decimal @default(0) @map("entry_total_amount") @db.Decimal(24, 2)
remittanceTotalAmount Decimal @default(0) @map("remittance_total_amount") @db.Decimal(24, 2)
differenceAmount     Decimal @default(0) @map("difference_amount") @db.Decimal(24, 2)
differenceReason     String? @map("difference_reason")
adjustments          ConsignadoBankAdjustment[]
```

Criar `ConsignadoBankAdjustment` com `reconciliationId`, `bankEntryId?`, `remittanceId?`, `amount` e `createdAt`, mais relações e índices.

- [ ] **Step 2: Criar a migração SQL aditiva**

Adicionar colunas com `DEFAULT 0`, preencher totais históricos com `total_amount`, criar tabela, chaves estrangeiras, índices e uma constraint que exige exatamente um entre `bank_entry_id` e `remittance_id`.

- [ ] **Step 3: Validar o schema**

Run: `corepack pnpm --filter @osher/database db:generate`

Expected: Prisma Client gerado sem erro.

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260818000000_add_consignado_bank_adjustments/migration.sql
git commit -m "feat: registra ajustes bancarios do consignado"
```

### Task 3: Integrar ajustes, resumo e filtro no serviço bancário

**Files:**
- Create: `apps/web/src/server/operational/consignado-date.ts`
- Test: `apps/web/src/server/operational/consignado-date.test.ts`
- Modify: `apps/web/src/server/operational/consignado-bank-service.ts`
- Modify: `apps/web/src/app/api/operacional/consignado/conciliacao-bancaria/route.ts`
- Modify: `apps/web/src/app/api/operacional/consignado/conciliacoes/route.ts`

**Interfaces:**
- Consumes: `planConsignadoReconciliation` da Task 1 e campos Prisma da Task 2.
- Produces: `getBankReconciliationWorkspace({ transactionDate? })` com `summary.openEntryCount` e `summary.openEntryAmount`.
- Produces: `createBankReconciliation({ ..., differenceReason? })`.

- [ ] **Step 1: Escrever testes que falham para datas**

Cobrir validação de `YYYY-MM-DD`, igualdade de `DATE` bancária e faixa UTC correspondente a um dia em São Paulo para `createdAt`.

- [ ] **Step 2: Executar e confirmar falha**

Run: `corepack pnpm --filter @osher/web test:operational`

Expected: FAIL porque os helpers de data não existem.

- [ ] **Step 3: Implementar helpers de data**

Exportar:

```ts
export function parseDateOnly(value: string): Date;
export function saoPauloDayRange(value: string): { gte: Date; lt: Date };
```

Rejeitar datas inexistentes e entradas fora do formato exato.

- [ ] **Step 4: Integrar o planejador no serviço**

Na transação:

- calcular saldo por `amount - allocatedAmount - adjustedAmount`;
- exigir `differenceReason` com pelo menos 5 caracteres quando `difference > 0`;
- criar conciliação com os quatro totais;
- criar alocações e ajustes planejados;
- atualizar `allocatedAmount`, `adjustedAmount` e estados;
- registrar os totais no evento de auditoria.

- [ ] **Step 5: Integrar estorno e consulta**

No estorno, incluir `adjustments`, subtrair ambos os tipos de movimento e recalcular estados. Na consulta, aplicar `transactionDate` somente às entradas listadas e calcular o resumo em uma agregação independente do filtro.

- [ ] **Step 6: Atualizar validação e parâmetros das APIs**

Aceitar `transactionDate` no GET e `differenceReason` entre 5 e 500 caracteres no POST. O serviço continua sendo a validação definitiva contra requisições diretas.

- [ ] **Step 7: Executar testes e typecheck**

Run: `corepack pnpm --filter @osher/web test:operational && corepack pnpm typecheck`

Expected: todos os testes e o TypeScript passam.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/server/operational apps/web/src/app/api/operacional/consignado/conciliacao-bancaria/route.ts apps/web/src/app/api/operacional/consignado/conciliacoes/route.ts
git commit -m "feat: concilia diferencas justificadas do consignado"
```

### Task 4: Filtrar e cancelar lotes de baixa

**Files:**
- Modify: `apps/web/src/server/operational/consignado-settlement-service.ts`
- Modify: `apps/web/src/app/api/operacional/consignado/baixas/route.ts`
- Create: `apps/web/src/app/api/operacional/consignado/baixas/[batchId]/route.ts`

**Interfaces:**
- Consumes: `saoPauloDayRange` da Task 3.
- Produces: `getSettlementWorkspace({ createdDate? })` e `cancelSettlementBatch(batchId, userId)`.

- [ ] **Step 1: Alterar a consulta de lotes**

Excluir `CANCELLED` da lista padrão e combinar opcionalmente `createdAt: saoPauloDayRange(createdDate)`. Manter ordenação e limite atuais quando não há filtro.

- [ ] **Step 2: Implementar cancelamento lógico transacional**

Carregar lote e remessas; rejeitar lote já cancelado ou com qualquer remessa não cancelada; atualizar status para `CANCELLED`; criar `ConsignadoStatusEvent` com motivo `REMOVED_FROM_WORKSPACE`.

- [ ] **Step 3: Expor GET filtrado e DELETE protegido por permissão**

O GET valida `createdDate`. O DELETE exige `operational.finance.manage` e retorna mensagem clara quando há remessa ativa.

- [ ] **Step 4: Executar typecheck**

Run: `corepack pnpm typecheck`

Expected: TypeScript sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/operational/consignado-settlement-service.ts apps/web/src/app/api/operacional/consignado/baixas
git commit -m "feat: filtra e cancela lotes de baixa"
```

### Task 5: Atualizar a interface de lotes

**Files:**
- Modify: `apps/web/src/features/operational/components/ConsignadoSettlementPanel.tsx`

**Interfaces:**
- Consumes: GET filtrado e DELETE da Task 4.

- [ ] **Step 1: Adicionar estado e controles do filtro**

Criar `createdDate`, input `type="date"`, botão `Filtrar` e botão `Todos recentes`. A atualização chama `/api/operacional/consignado/baixas?createdDate=...`.

- [ ] **Step 2: Adicionar exclusão por lote**

Para operadores, mostrar `Excluir da visualização` no cabeçalho do lote. Pedir confirmação citando o arquivo, chamar DELETE e atualizar a lista preservando o filtro atual.

- [ ] **Step 3: Tratar lista vazia e feedback**

Quando a data não tiver lotes, informar `Nenhum lote processado nesta data`; erros de bloqueio aparecem no feedback existente.

- [ ] **Step 4: Executar typecheck**

Run: `corepack pnpm typecheck`

Expected: TypeScript sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/operational/components/ConsignadoSettlementPanel.tsx
git commit -m "feat: organiza lotes de baixa por data"
```

### Task 6: Atualizar a interface de conciliação bancária

**Files:**
- Modify: `apps/web/src/features/operational/components/ConsignadoBankReconciliationPanel.tsx`

**Interfaces:**
- Consumes: resumo, filtro e `differenceReason` das Tasks 2 e 3.

- [ ] **Step 1: Adicionar indicador e filtro de entradas**

Mostrar cartões discretos `Entradas não conciliadas` e `Saldo em aberto`. Adicionar data, botão `Filtrar` e atalho `Todas em aberto`; limpar `entryIds` ao mudar o conjunto visível.

- [ ] **Step 2: Exibir a diferença selecionada**

Calcular `Math.abs(selectedEntryTotal - selectedRemittanceTotal)` apenas para apresentação e mostrar `Diferença` junto dos totais já existentes.

- [ ] **Step 3: Exigir justificativa quando necessário**

Ao clicar em conciliar com diferença maior que R$ 0,00, abrir uma caixa no próprio painel com textarea, totais, diferença e botões `Cancelar`/`Conciliar com justificativa`. Desabilitar confirmação com menos de 5 caracteres.

- [ ] **Step 4: Melhorar o histórico**

Exibir totais de entrada/remessa, diferença e justificativa em conciliações com ajuste; manter apresentação compacta para conciliações antigas ou sem diferença.

- [ ] **Step 5: Executar testes e typecheck**

Run: `corepack pnpm --filter @osher/web test:operational && corepack pnpm typecheck`

Expected: testes e TypeScript passam.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/operational/components/ConsignadoBankReconciliationPanel.tsx
git commit -m "feat: melhora controle da conciliacao bancaria"
```

### Task 7: Documentação e verificação integral

**Files:**
- Modify: `docs/OPERACIONAL-CONSIGNADO.md`
- Modify: `docs/TASKS.md`

**Interfaces:**
- Consumes: comportamento final das Tasks 1 a 6.

- [ ] **Step 1: Documentar as regras operacionais**

Registrar filtro por data, cancelamento lógico, indicador global, diferença justificada, auditoria e comportamento do estorno.

- [ ] **Step 2: Atualizar o acompanhamento das tarefas**

Marcar as entregas correspondentes como concluídas sem alterar tarefas do PDD ou de outros módulos.

- [ ] **Step 3: Executar verificação final**

Run:

```bash
corepack pnpm --filter @osher/web test:operational
corepack pnpm typecheck
corepack pnpm build
git diff --check
```

Expected: todos os comandos passam e não há erros de whitespace.

- [ ] **Step 4: Revisar o diff contra o escopo**

Confirmar que somente schema/migração, serviços/APIs, dois painéis, testes e documentação do Consignado foram alterados.

- [ ] **Step 5: Commit**

```bash
git add docs/OPERACIONAL-CONSIGNADO.md docs/TASKS.md
git commit -m "docs: atualiza conciliacao operacional do consignado"
```
