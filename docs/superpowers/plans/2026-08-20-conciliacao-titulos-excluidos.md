# Conciliação de Títulos Excluídos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar, exportar e usar títulos fora da remessa para explicar diferenças bancárias, mantendo qualquer saldo residual como pendência operacional mensurável.

**Architecture:** A geração da remessa cria snapshots explícitos das exclusões. O planejador puro valida a igualdade entre entradas, remessas, títulos e outros ajustes; o serviço transacional persiste os vínculos e as pendências. Relatórios dedicados reutilizam filtros tipados e geradores de workbook sem estado.

**Tech Stack:** Next.js 14, TypeScript, React 18, Prisma 6/PostgreSQL, Zod, `xlsx`, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-20-conciliacao-titulos-excluidos-design.md`

## Global Constraints

- Cálculos monetários usam `Prisma.Decimal`, com igualdade exata em centavos e sem tolerância automática.
- O valor explicativo de um título é o snapshot de `paidAmount`; títulos são usados integralmente, nunca parcialmente.
- Títulos só explicam `ENTRY_EXCESS` e devem pertencer às remessas selecionadas.
- Um título não pode participar de duas conciliações `ACTIVE`; a checagem final ocorre na transação serializável.
- Saldo residual exige categoria, valor e justificativa mínima de cinco caracteres e permanece `OPEN` após a conciliação.
- Desfazer uma conciliação libera seus títulos e cancela suas pendências sem apagar histórico.
- Visualização e Excel exigem `operational.view`; mutações exigem `operational.finance.manage`.
- A migration retroalimenta remessas existentes de forma idempotente e não remove colunas antigas.
- Nenhuma mudança deve alterar parsers BMP/UY3, matching de estoque ou fluxos de outros fundos.
- Cada comportamento novo segue RED/GREEN/REFACTOR; configuração Prisma é validada com `prisma validate` e geração do client.

---

### Task 1: Estrutura Prisma, migration e retroalimentação

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260820000000_add_consignado_remittance_exclusions/migration.sql`

**Interfaces:**
- Produces: modelos Prisma `ConsignadoRemittanceExclusion`, `ConsignadoBankDifferenceTitle` e `ConsignadoBankOtherDifference` e seus enums.
- Produces: delegates `prisma.consignadoRemittanceExclusion`, `prisma.consignadoBankDifferenceTitle` e `prisma.consignadoBankOtherDifference` consumidos pelas Tasks 2–7.

- [ ] **Step 1: Adicionar enums e relações ao schema**

Adicionar os enums com estes valores exatos:

```prisma
enum RemittanceExclusionCategory {
  NOT_FOUND_IN_STOCK
  OPERATOR_EXCLUDED
  NOT_APPROVED
  PDD_RECOVERY
  OTHER_DIVERGENCE
}

enum BankDifferenceCategory {
  BANK_FEE
  UNIDENTIFIED_CREDIT
  VALUE_DIFFERENCE
  ROUNDING
  TIMING_DIFFERENCE
  OTHER
}

enum BankDifferenceDirection {
  ENTRY_EXCESS
  REMITTANCE_EXCESS
}

enum BankDifferenceStatus {
  OPEN
  RESOLVED
  CANCELLED
}
```

Adicionar os modelos com estes campos e restrições exatos:

```prisma
model ConsignadoRemittanceExclusion {
  id               String                      @id @default(cuid())
  remittanceId     String                      @map("remittance_id")
  settlementItemId String                      @map("settlement_item_id")
  category         RemittanceExclusionCategory
  reason           String
  paidAmount       Decimal                     @map("paid_amount") @db.Decimal(24, 2)
  titleAmount      Decimal                     @map("title_amount") @db.Decimal(24, 2)
  createdAt        DateTime                    @default(now()) @map("created_at")
  remittance       ConsignadoRemittance        @relation(fields: [remittanceId], references: [id], onDelete: Cascade)
  settlementItem   ConsignadoSettlementItem    @relation(fields: [settlementItemId], references: [id], onDelete: Restrict)
  differenceTitles ConsignadoBankDifferenceTitle[]

  @@unique([remittanceId, settlementItemId])
  @@index([remittanceId, category])
  @@index([settlementItemId])
  @@map("consignado_remittance_exclusions")
}

model ConsignadoBankDifferenceTitle {
  id                    String                         @id @default(cuid())
  reconciliationId      String                         @map("reconciliation_id")
  remittanceExclusionId String                         @map("remittance_exclusion_id")
  amount                Decimal                        @db.Decimal(24, 2)
  createdAt             DateTime                       @default(now()) @map("created_at")
  reconciliation        ConsignadoBankReconciliation   @relation(fields: [reconciliationId], references: [id], onDelete: Cascade)
  remittanceExclusion   ConsignadoRemittanceExclusion  @relation(fields: [remittanceExclusionId], references: [id], onDelete: Restrict)

  @@unique([reconciliationId, remittanceExclusionId])
  @@index([remittanceExclusionId])
  @@map("consignado_bank_difference_titles")
}

model ConsignadoBankOtherDifference {
  id                String                     @id @default(cuid())
  reconciliationId  String                     @map("reconciliation_id")
  createdByUserId   String                     @map("created_by_user_id")
  resolvedByUserId  String?                    @map("resolved_by_user_id")
  category          BankDifferenceCategory
  direction         BankDifferenceDirection
  amount            Decimal                    @db.Decimal(24, 2)
  reason            String
  status            BankDifferenceStatus       @default(OPEN)
  createdAt         DateTime                   @default(now()) @map("created_at")
  resolvedAt        DateTime?                  @map("resolved_at")
  resolutionNote    String?                    @map("resolution_note")
  cancelledAt       DateTime?                  @map("cancelled_at")
  reconciliation    ConsignadoBankReconciliation @relation(fields: [reconciliationId], references: [id], onDelete: Cascade)
  createdBy         User                       @relation("BankOtherDifferenceCreatedBy", fields: [createdByUserId], references: [id], onDelete: Restrict)
  resolvedBy        User?                      @relation("BankOtherDifferenceResolvedBy", fields: [resolvedByUserId], references: [id], onDelete: Restrict)

  @@index([reconciliationId, status])
  @@index([status, category, createdAt])
  @@map("consignado_bank_other_differences")
}
```

Adicionar arrays correspondentes em `User`, `ConsignadoSettlementItem`, `ConsignadoRemittance` e `ConsignadoBankReconciliation`. Os dois arrays de `User` usam exatamente as relações nomeadas acima.

- [ ] **Step 2: Escrever a migration SQL completa**

Criar os quatro tipos PostgreSQL com os mesmos valores dos enums, as três tabelas com os mesmos nomes/colunas/decimais dos modelos, todos os índices e as sete FKs descritas pelas relações. `ON DELETE` deve seguir os modelos (`CASCADE` para pais de histórico e `RESTRICT` para item/exclusão/usuários). Depois executar o backfill com esta forma vinculante:

```sql
INSERT INTO "consignado_remittance_exclusions" (
  "id", "remittance_id", "settlement_item_id", "category", "reason",
  "paid_amount", "title_amount", "created_at"
)
SELECT
  'backfill_' || md5(r."id" || ':' || i."id"),
  r."id",
  i."id",
  CASE
    WHEN i."status"::text IN ('PDD_RECOVERY', 'PDD_REVIEW') THEN 'PDD_RECOVERY'::"RemittanceExclusionCategory"
    WHEN i."matched_stock_position_id" IS NULL
      AND COALESCE(i."status_reason", '') ILIKE '%não encontrado%' THEN 'NOT_FOUND_IN_STOCK'::"RemittanceExclusionCategory"
    WHEN i."exclusion_reason" IS NOT NULL
      AND i."exclusion_reason" NOT ILIKE '%não incluído na remessa aprovada%' THEN 'OPERATOR_EXCLUDED'::"RemittanceExclusionCategory"
    WHEN i."approved" = FALSE THEN 'NOT_APPROVED'::"RemittanceExclusionCategory"
    ELSE 'OTHER_DIVERGENCE'::"RemittanceExclusionCategory"
  END,
  COALESCE(i."exclusion_reason", i."status_reason", 'Não incluído na remessa.'),
  i."paid_amount",
  i."title_amount",
  r."generated_at"
FROM "consignado_remittances" r
JOIN "consignado_settlement_batches" b ON b."id" = r."batch_id"
JOIN "consignado_settlement_items" i ON i."batch_id" = b."id"
LEFT JOIN "consignado_remittance_items" ri ON ri."settlement_item_id" = i."id"
WHERE r."status"::text <> 'CANCELLED'
  AND b."status"::text <> 'CANCELLED'
  AND ri."id" IS NULL
ON CONFLICT ("remittance_id", "settlement_item_id") DO NOTHING;
```

- [ ] **Step 3: Validar schema e gerar o client**

Run:

```powershell
corepack pnpm --filter @osher/database exec prisma validate
corepack pnpm --filter @osher/database db:generate
```

Expected: ambos saem com código 0 e os novos delegates/tipos são gerados.

- [ ] **Step 4: Verificar migration e commit**

Run:

```powershell
git diff --check
corepack pnpm typecheck
```

Expected: código 0.

Commit:

```powershell
git add packages/database/prisma
git commit -m "feat: estrutura titulos excluidos e diferencas"
```

---

### Task 2: Classificação e registro de exclusões na remessa

**Files:**
- Create: `apps/web/src/server/operational/consignado-remittance-exclusions.ts`
- Create: `apps/web/src/server/operational/consignado-remittance-exclusions.test.ts`
- Modify: `apps/web/src/server/operational/consignado-settlement-service.ts`
- Modify: `apps/web/package.json`

**Interfaces:**
- Produces: `classifyRemittanceExclusion(item): RemittanceExclusionCategory`.
- Produces: `buildRemittanceExclusions(remittanceId, allItems, includedIds)` com snapshots persistíveis.
- Consumes: models e enums da Task 1.

- [ ] **Step 1: Escrever testes RED de classificação e snapshot**

Adicionar casos literais para `PDD_RECOVERY`, `NOT_FOUND_IN_STOCK`, exclusão manual, não aprovado e fallback. O caso central deve afirmar:

```ts
test("registra como não encontrado o item sem posição que ficou fora da remessa", () => {
  const rows = buildRemittanceExclusions("r1", [
    item({ id: "i1", matchedStockPositionId: null, statusReason: "Título não encontrado no estoque ativo.", paidAmount: "54.31", titleAmount: "60.00" }),
  ], new Set());

  assert.deepEqual(serializable(rows), [{
    remittanceId: "r1",
    settlementItemId: "i1",
    category: "NOT_FOUND_IN_STOCK",
    reason: "Título não encontrado no estoque ativo.",
    paidAmount: "54.31",
    titleAmount: "60.00",
  }]);
});
```

Adicionar o arquivo ao `test:operational` e rodar:

```powershell
corepack pnpm --filter @osher/web test:operational
```

Expected: FAIL porque o módulo ainda não existe.

- [ ] **Step 2: Implementar o classificador puro**

Implementar a precedência da spec e retornar somente itens ausentes de `includedIds`. `reason` usa `exclusionReason`, depois `statusReason`, depois `"Não incluído na remessa."`.

- [ ] **Step 3: Integrar na transação de geração**

Carregar todos os itens do lote, gerar `includedIds`, criar remessa e `remittance_items`, e na mesma transação executar:

```ts
const exclusions = buildRemittanceExclusions(remittance.id, allItems, new Set(items.map((item) => item.id)));
if (exclusions.length) {
  await tx.consignadoRemittanceExclusion.createMany({ data: exclusions, skipDuplicates: true });
}
```

O evento `REMITTANCE` deve acrescentar `excludedItems` e `excludedPaidAmount` no metadata.

- [ ] **Step 4: Rodar GREEN e verificações**

Run:

```powershell
corepack pnpm --filter @osher/web test:operational
corepack pnpm typecheck
corepack pnpm lint
```

Expected: todos com código 0.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/package.json apps/web/src/server/operational
git commit -m "feat: registra titulos fora da remessa"
```

---

### Task 3: Planejador monetário com títulos e outros ajustes

**Files:**
- Modify: `apps/web/src/server/operational/consignado-reconciliation.ts`
- Modify: `apps/web/src/server/operational/consignado-reconciliation.test.ts`

**Interfaces:**
- Produces: `DifferenceTitleInput`, `OtherDifferenceInput` e campos de composição em `ReconciliationPlan`.
- Produces: erros determinísticos consumidos pela API e UI nas Tasks 4–5.

- [ ] **Step 1: Escrever testes RED das novas regras**

Adicionar testes independentes para:

```ts
test("fecha excedente da entrada com títulos excluídos", () => {
  const plan = planConsignadoReconciliation({
    entries: [balance("e1", "1000.00")],
    remittances: [balance("r1", "900.00")],
    differenceTitles: [differenceTitle("x1", "r1", "60.00"), differenceTitle("x2", "r1", "40.00")],
    otherDifferences: [],
  });
  assert.equal(plan.titleDifferenceTotal.toFixed(2), "100.00");
  assert.equal(plan.unexplainedDifference.toFixed(2), "0.00");
});

test("mantém saldo residual como outro ajuste", () => {
  const plan = planConsignadoReconciliation({
    entries: [balance("e1", "1000.00")],
    remittances: [balance("r1", "900.00")],
    differenceTitles: [differenceTitle("x1", "r1", "85.00")],
    otherDifferences: [other("15.00", "VALUE_DIFFERENCE", "Crédito complementar não identificado")],
  });
  assert.equal(plan.otherDifferenceTotal.toFixed(2), "15.00");
  assert.equal(plan.unexplainedDifference.toFixed(2), "0.00");
});
```

Também testar rejeição de excesso, saldo aberto, título de remessa não selecionada, título em `REMITTANCE_EXCESS`, justificativa curta e direção incorreta.

Run: `corepack pnpm --filter @osher/web test:operational`

Expected: FAIL nos novos campos/regras.

- [ ] **Step 2: Implementar composição e validações**

Estender a entrada com arrays default `[]`. Calcular:

```ts
const signedDifference = entryTotal.sub(remittanceTotal);
const direction = signedDifference.gte(0) ? "ENTRY_EXCESS" : "REMITTANCE_EXCESS";
const difference = signedDifference.abs();
const titleDifferenceTotal = totalDifferenceTitles(input.differenceTitles ?? []);
const otherDifferenceTotal = totalOtherDifferences(input.otherDifferences ?? []);
const unexplainedDifference = difference.sub(titleDifferenceTotal).sub(otherDifferenceTotal);
```

Rejeitar `unexplainedDifference !== 0`, totais acima da diferença e todas as violações descritas na spec. Manter a alocação N:N existente.

- [ ] **Step 3: Rodar GREEN e commit**

Run:

```powershell
corepack pnpm --filter @osher/web test:operational
corepack pnpm typecheck
```

Expected: código 0.

Commit:

```powershell
git add apps/web/src/server/operational/consignado-reconciliation.ts apps/web/src/server/operational/consignado-reconciliation.test.ts
git commit -m "feat: compoe diferenca bancaria com titulos"
```

---

### Task 4: Persistência transacional e APIs de conciliação

**Files:**
- Modify: `apps/web/src/server/operational/consignado-bank-service.ts`
- Create: `apps/web/src/server/operational/consignado-bank-input.ts`
- Create: `apps/web/src/server/operational/consignado-bank-input.test.ts`
- Modify: `apps/web/src/app/api/operacional/consignado/conciliacoes/route.ts`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: planejador da Task 3 e models da Task 1.
- Produces: POST payload `{ entryIds, remittanceIds, exclusionIds, otherDifferences, note? }`.
- Produces: workspace com exclusões elegíveis e histórico detalhado.

- [ ] **Step 1: Criar parser RED do payload**

Exportar um schema Zod que aceite:

```ts
{
  entryIds: string[];
  remittanceIds: string[];
  exclusionIds: string[];
  otherDifferences: Array<{
    category: "BANK_FEE" | "UNIDENTIFIED_CREDIT" | "VALUE_DIFFERENCE" | "ROUNDING" | "TIMING_DIFFERENCE" | "OTHER";
    amount: string;
    reason: string;
  }>;
  note?: string;
}
```

Testar deduplicação no serviço, decimal positivo, justificativa mínima e categoria inválida. Rodar os testes e observar FAIL antes da implementação.

- [ ] **Step 2: Recarregar e validar exclusões dentro da transação**

Consultar exclusões por `id`, incluir remessa/lote e vínculos cuja conciliação esteja `ACTIVE`. Exigir quantidade exata, remessa selecionada, status ativo e ausência de uso ativo. Passar snapshots recarregados ao planejador, nunca valores enviados pelo browser.

- [ ] **Step 3: Persistir vínculos e pendências**

Após criar a conciliação:

```ts
await tx.consignadoBankDifferenceTitle.createMany({
  data: exclusions.map((item) => ({
    reconciliationId: reconciliation.id,
    remittanceExclusionId: item.id,
    amount: item.paidAmount,
  })),
});

await tx.consignadoBankOtherDifference.createMany({
  data: input.otherDifferences.map((item) => ({
    reconciliationId: reconciliation.id,
    createdByUserId: input.userId,
    category: item.category,
    direction: plan.direction,
    amount: new Prisma.Decimal(item.amount),
    reason: item.reason.trim(),
  })),
});
```

Gerar `differenceReason` apenas como resumo derivado. Incluir IDs e totais no evento.

- [ ] **Step 4: Atualizar desfazimento e workspace**

No desfazimento, carregar `otherDifferences`, marcá-los `CANCELLED` com `cancelledAt`, e deixar os vínculos históricos intactos. No workspace, cada remessa pendente inclui exclusões disponíveis; o histórico inclui títulos e outros ajustes.

- [ ] **Step 5: Atualizar rota e rodar GREEN**

Trocar o schema inline pelo parser compartilhado. Rodar:

```powershell
corepack pnpm --filter @osher/web test:operational
corepack pnpm typecheck
corepack pnpm lint
```

Expected: código 0.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/package.json apps/web/src/server/operational apps/web/src/app/api/operacional/consignado/conciliacoes/route.ts
git commit -m "feat: vincula titulos a conciliacao bancaria"
```

---

### Task 5: Interface da conciliação dentro da conciliação

**Files:**
- Modify: `apps/web/src/features/operational/components/ConsignadoBankReconciliationPanel.tsx`
- Create: `apps/web/src/features/operational/components/ConsignadoDifferenceComposer.tsx`
- Create: `apps/web/src/features/operational/consignado-difference-composer.ts`
- Create: `apps/web/src/features/operational/consignado-difference-composer.test.ts`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: workspace e POST payload da Task 4.
- Produces: seleção visual exata de títulos e formulário residual.

- [ ] **Step 1: Escrever RED do estado derivado do compositor**

Criar teste puro para `composeDifferenceState` com valores literais. Cobrir seleção parcial (`100 - 85 - 0 = 15`), fechamento com "Outro", bloqueio de ajuste incompleto e bloqueio de título em `REMITTANCE_EXCESS`. Adicionar o teste ao script e rodar `test:operational`; Expected: FAIL porque o helper ainda não existe.

- [ ] **Step 2: Extrair o compositor como unidade focada**

Criar props tipadas:

```ts
type DifferenceComposerProps = {
  difference: number;
  direction: "ENTRY_EXCESS" | "REMITTANCE_EXCESS";
  exclusions: EligibleExclusion[];
  selectedIds: string[];
  otherDifferences: OtherDifferenceDraft[];
  disabled: boolean;
  onSelectedIdsChange(ids: string[]): void;
  onOtherDifferencesChange(items: OtherDifferenceDraft[]): void;
};
```

O componente calcula títulos, outros e falta explicar; filtra por contrato/sacado/CPF/categoria; nunca recebe autorização para alterar dados sozinho.

- [ ] **Step 3: Substituir a justificativa livre**

Remover `differenceReason` do estado e enviar `exclusionIds` e `otherDifferences`. Exibir a composição:

```text
Entradas | Remessas | Diferença | Títulos selecionados | Outros | Falta explicar
```

Desabilitar conclusão quando `falta explicar !== 0`, houver título acima do saldo ou ajuste incompleto. Em `REMITTANCE_EXCESS`, esconder seleção de títulos e exigir "Outro".

- [ ] **Step 4: Mostrar a explicação no histórico**

Listar quantidade/valor dos títulos e quantidade/valor/status dos outros ajustes. Manter a ação de desfazer e os filtros existentes.

- [ ] **Step 5: Rodar GREEN e verificar UI**

Run:

```powershell
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm --filter @osher/web test:operational
```

Expected: código 0.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/package.json apps/web/src/features/operational
git commit -m "feat: explica conciliacao com titulos excluidos"
```

---

### Task 6: Relatório e Excel de títulos fora da remessa

**Files:**
- Create: `apps/web/src/server/operational/consignado-exclusion-report.ts`
- Create: `apps/web/src/server/operational/consignado-exclusion-report.test.ts`
- Create: `apps/web/src/app/api/operacional/consignado/titulos-fora-remessa/route.ts`
- Create: `apps/web/src/app/api/operacional/consignado/titulos-fora-remessa/export/route.ts`
- Create: `apps/web/src/app/dashboard/operacional/financeiro/conciliacao/consignado/baixas/titulos-fora-remessa/page.tsx`
- Create: `apps/web/src/features/operational/components/ConsignadoExcludedTitlesPanel.tsx`
- Modify: `apps/web/src/features/operational/components/ConsignadoSettlementPanel.tsx`
- Modify: `apps/web/package.json`

**Interfaces:**
- Produces: `parseExclusionReportFilters`, `getExclusionReport`, `buildExclusionWorkbook`.
- Consumes: exclusões e vínculos das Tasks 1 e 4.

- [ ] **Step 1: Escrever testes RED do filtro, resumo e workbook**

Com fixtures literais, validar filtros por data/originador/categoria/situação/busca e totais. O workbook deve ser relido com `XLSX.read` e afirmar:

```ts
assert.deepEqual(workbook.SheetNames, ["Resumo", "Titulos"]);
assert.equal(detailRows[0]["Contrato"], "94608325001");
assert.equal(detailRows[0]["Valor pago"], 99.24);
assert.equal(detailRows[0]["Situação"], "Disponível");
```

Adicionar o teste ao script e observar FAIL.

- [ ] **Step 2: Implementar serviço de consulta e workbook**

Usar o mesmo objeto de filtros para query e exportação. Situações exatas: `AVAILABLE`, `ACTIVE_RECONCILIATION`, `UNDONE_HISTORY`. O resumo agrega quantidade, face e pago por categoria/situação.

- [ ] **Step 3: Criar rotas protegidas**

GET JSON e GET XLSX exigem `operational.view`. O Excel retorna `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` e nome `titulos-fora-remessa-YYYY-MM-DD.xlsx`.

- [ ] **Step 4: Criar página e atalhos**

Implementar filtros, cards de resumo, tabela, link de Excel e estados vazios. No cabeçalho de "Lotes de baixa", adicionar "Títulos fora da remessa"; dentro de lote com remessa, adicionar links filtrados `Ver títulos fora` e `Exportar Excel`.

- [ ] **Step 5: Rodar GREEN e commit**

Run:

```powershell
corepack pnpm --filter @osher/web test:operational
corepack pnpm typecheck
corepack pnpm lint
```

Expected: código 0.

Commit:

```powershell
git add apps/web
git commit -m "feat: adiciona relatorio de titulos fora da remessa"
```

---

### Task 7: Página de diferenças e resolução de pendências

**Files:**
- Create: `apps/web/src/server/operational/consignado-difference-report.ts`
- Create: `apps/web/src/server/operational/consignado-difference-report.test.ts`
- Create: `apps/web/src/app/api/operacional/consignado/diferencas/route.ts`
- Create: `apps/web/src/app/api/operacional/consignado/diferencas/export/route.ts`
- Create: `apps/web/src/app/api/operacional/consignado/diferencas/[differenceId]/route.ts`
- Create: `apps/web/src/app/dashboard/operacional/financeiro/conciliacao/consignado/conciliacao-bancaria/diferencas/page.tsx`
- Create: `apps/web/src/features/operational/components/ConsignadoDifferencesPanel.tsx`
- Modify: `apps/web/src/features/operational/components/ConsignadoBankReconciliationPanel.tsx`
- Modify: `apps/web/package.json`

**Interfaces:**
- Produces: consulta, workbook e `resolveOtherDifference(id, userId, note)`.
- Consumes: pendências criadas pela Task 4.

- [ ] **Step 1: Escrever testes RED de resumo e transição**

Testar agregação somente de `OPEN`, filtros, categorias/direções e uma função pura de transição que rejeite `RESOLVED`/`CANCELLED` e nota curta. Testar workbook com abas `Resumo` e `Diferencas`.

- [ ] **Step 2: Implementar serviço e resolução transacional**

Resolver somente `OPEN` e gravar:

```ts
{
  status: "RESOLVED",
  resolvedAt: new Date(),
  resolvedByUserId: userId,
  resolutionNote: note.trim(),
}
```

Criar evento `BANK_OTHER_DIFFERENCE` de `OPEN` para `RESOLVED`.

- [ ] **Step 3: Criar APIs com permissões**

GET e export usam `operational.view`; PATCH usa `operational.finance.manage` e schema `{ resolutionNote: string().trim().min(5).max(500) }`.

- [ ] **Step 4: Criar página e navegação**

Cards de aberto, filtros, tabela, resolução e Excel. Adicionar link "Diferenças e ajustes" na conciliação bancária e exibir badge discreto com quantidade/valor aberto.

- [ ] **Step 5: Rodar GREEN e commit**

Run:

```powershell
corepack pnpm --filter @osher/web test:operational
corepack pnpm typecheck
corepack pnpm lint
```

Expected: código 0.

Commit:

```powershell
git add apps/web
git commit -m "feat: acompanha diferencas bancarias em aberto"
```

---

### Task 8: Documentação, regressão e build final

**Files:**
- Modify: `docs/OPERACIONAL-CONSIGNADO.md`
- Modify: `docs/TASKS.md`

**Interfaces:**
- Consumes: todos os fluxos implementados nas Tasks 1–7.
- Produces: instruções operacionais e evidência final da branch.

- [ ] **Step 1: Atualizar documentação operacional**

Documentar geração das exclusões, filtros/Excel, composição da conciliação, pendências "Outros", resolução, desfazimento, migration e permissões. Marcar as tasks correspondentes como concluídas sem apagar histórico anterior.

- [ ] **Step 2: Validar schema e client**

```powershell
corepack pnpm --filter @osher/database exec prisma validate
corepack pnpm --filter @osher/database db:generate
```

- [ ] **Step 3: Executar suíte completa**

```powershell
corepack pnpm --filter @osher/web test:operational
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
```

Expected: todos saem com código 0, sem testes falhos, erros de lint, erros TypeScript ou falha no build.

- [ ] **Step 4: Conferir escopo e migration**

```powershell
$base = git merge-base main HEAD
git diff --check "$base..HEAD"
git status --short
git log --oneline (git merge-base main HEAD)..HEAD
```

Expected: diff sem whitespace inválido, worktree limpo após o commit e apenas arquivos previstos pela spec.

- [ ] **Step 5: Commit da documentação**

```powershell
git add docs/OPERACIONAL-CONSIGNADO.md docs/TASKS.md
git commit -m "docs: atualiza conciliacao de titulos excluidos"
```
