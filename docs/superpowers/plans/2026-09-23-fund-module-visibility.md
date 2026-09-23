# Fund Module Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow administrators to enable Dashboard, Caixa, DRE, Previsões, and PDD independently for each fund, with ANTENA available only in Caixa and CONSIGNADO hidden from all five modules.

**Architecture:** A normalized `FundModuleVisibility` relation stores one explicit boolean per fund/module. A pure shared module owns module metadata, normalization, and the Prisma fund filter; UI pages reuse that filter, while Caixa additionally validates reads and writes server-side. Administrative toggles call a permission-checked server action backed by an independently tested service.

**Tech Stack:** Next.js 14 server components/actions, React 18, TypeScript 5.7, Prisma 6/PostgreSQL, Zod, Node test runner through `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-09-23-fund-module-visibility-design.md`

## Global Constraints

- Configurable modules are exactly `DASHBOARD`, `CASH`, `DRE`, `FORECASTS`, and `PDD`.
- A fund is visible only when `Fund.status = ACTIVE` and its module row has `enabled = true`.
- Missing configuration means disabled.
- ANTENA is active only in Caixa; CONSIGNADO is inactive and hidden from all five modules.
- APUAMA and BRISTOL are active in all five modules.
- New funds start with all five modules disabled.
- Only `funds.manage` may change module visibility.
- Existing financial history is preserved.
- Imports and internal operational services keep their current `Fund.status` behavior.
- The VOP synchronization remains based on active APUAMA and BRISTOL and is not gated by module visibility.

---

### Task 1: Module domain model, schema, and migration backfill

**Files:**
- Create: `apps/web/src/lib/fund-modules.ts`
- Create: `apps/web/src/lib/fund-modules.test.ts`
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260923140000_add_fund_module_visibilities/migration.sql`

**Interfaces:**
- Produces `FUND_MODULES`, `FundModuleKey`, and `FundModuleVisibilityMap`.
- Produces `fundEnabledFor(module: FundModuleKey): Prisma.FundWhereInput`.
- Produces `normalizeFundModules(rows): FundModuleVisibilityMap`.
- Produces Prisma models `FundModuleVisibility` and enum `FundModule`.

- [ ] **Step 1: Write failing domain tests**

Create tests proving the exact module list and labels, the combined status/relation filter, and missing rows normalized to `false`:

```ts
test("requires active status and an enabled row for the requested module", () => {
  assert.deepEqual(fundEnabledFor("CASH"), {
    status: "ACTIVE",
    moduleVisibilities: { some: { module: "CASH", enabled: true } },
  });
});

test("normalizes missing module rows as disabled", () => {
  assert.deepEqual(normalizeFundModules([{ module: "CASH", enabled: true }]), {
    DASHBOARD: false,
    CASH: true,
    DRE: false,
    FORECASTS: false,
    PDD: false,
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `corepack pnpm --dir apps/web exec tsx --test src/lib/fund-modules.test.ts`

Expected: FAIL because `fund-modules.ts` does not exist.

- [ ] **Step 3: Implement the pure shared module**

Define the five literal module keys and Portuguese labels, return a fresh `FundWhereInput` from `fundEnabledFor`, and construct a complete false-first record in `normalizeFundModules` before applying persisted rows.

- [ ] **Step 4: Add schema relations and migration**

Add the Prisma enum and model:

```prisma
enum FundModule {
  DASHBOARD
  CASH
  DRE
  FORECASTS
  PDD
}

model FundModuleVisibility {
  fundId          String     @map("fund_id")
  module          FundModule
  enabled         Boolean    @default(false)
  updatedAt       DateTime   @updatedAt @map("updated_at")
  updatedByUserId String?    @map("updated_by_user_id")
  fund            Fund       @relation(fields: [fundId], references: [id], onDelete: Cascade)
  updatedBy       User?      @relation(fields: [updatedByUserId], references: [id], onDelete: SetNull)

  @@id([fundId, module])
  @@index([module, enabled])
  @@index([updatedByUserId])
  @@map("fund_module_visibilities")
}
```

Add inverse relations to `Fund` and `User`. The SQL migration must create all five rows for every existing fund, enable all modules for currently active funds, then override statuses and flags for names containing APUAMA, BRISTOL, ANTENA, and CONSIGNADO according to the approved matrix. Use `ON CONFLICT (fund_id, module) DO UPDATE` so the backfill is deterministic.

- [ ] **Step 5: Verify GREEN and validate Prisma**

Run:

```powershell
corepack pnpm --dir apps/web exec tsx --test src/lib/fund-modules.test.ts
$env:DATABASE_URL='postgresql://validate:validate@localhost:5432/validate?schema=OSHER'
corepack pnpm --dir packages/database exec prisma validate
corepack pnpm --dir packages/database exec prisma generate
Remove-Item Env:DATABASE_URL
```

Expected: tests pass, schema is valid, and Prisma Client generation succeeds.

- [ ] **Step 6: Commit the domain and persistence slice**

```powershell
git add apps/web/src/lib/fund-modules* packages/database/prisma
git commit -m "feat: add fund visibility by module"
```

### Task 2: Administrative toggles and safe fund creation

**Files:**
- Create: `apps/web/src/server/funds/module-visibility.ts`
- Create: `apps/web/src/server/funds/module-visibility.test.ts`
- Modify: `apps/web/src/app/dashboard/fundos/actions.ts`
- Modify: `apps/web/src/app/dashboard/fundos/novo/actions.ts`
- Modify: `apps/web/src/app/dashboard/fundos/page.tsx`
- Modify: `apps/web/src/components/funds-table.tsx`

**Interfaces:**
- Consumes `FUND_MODULES`, `FundModuleKey`, and `normalizeFundModules` from Task 1.
- Produces `setFundModuleVisibilityWithDependencies(input, deps)` for tested authorization and persistence behavior.
- Produces server action `setFundModuleVisibilityAction(input)` for the client component.

- [ ] **Step 1: Write failing service tests**

Test permission denial without database access, invalid module rejection, unknown fund handling, composite-key `upsert`, actor audit, and revalidation only after success. Use a fake dependency object rather than a live database:

```ts
const result = await setFundModuleVisibilityWithDependencies(
  { fundId: "antena", module: "CASH", enabled: true },
  { actorUserId: "juan", canManage: true, database, revalidate }
);
assert.equal(result.ok, true);
assert.deepEqual(upserts[0].where, {
  fundId_module: { fundId: "antena", module: "CASH" },
});
```

Also test a helper used by fund creation that produces exactly five `enabled: false` rows.

- [ ] **Step 2: Run the tests and verify RED**

Run: `corepack pnpm --dir apps/web exec tsx --test src/server/funds/module-visibility.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement service and server action**

Keep parsing and database logic in the testable server module. The wrapper in `fundos/actions.ts` obtains the session user, evaluates `funds.manage`, passes Prisma and `revalidatePath`, and returns a public `{ ok, message, enabled }` result. Revalidate:

```text
/dashboard
/dashboard/caixa
/dashboard/dre
/dashboard/previsoes
/dashboard/pdd
/dashboard/fundos
```

- [ ] **Step 4: Make new-fund creation transactional**

Replace the standalone `prisma.fund.create` with `prisma.$transaction`, create the fund, and `createMany` the five rows returned by the tested helper. Do not add module fields to the creation form.

- [ ] **Step 5: Render and operate the five toggles**

Load `moduleVisibilities` in `fundos/page.tsx` and normalize them. Add a `FundModuleToggle` child component with its own `pending`, `enabled`, and `message` state. Render a `role="switch"` button per module; users without `funds.manage` receive a non-interactive state indicator. On failure, restore the previous boolean and show the returned message.

Change “Excluir” copy to “Desativar” and make its confirmation explain that global inactivity overrides every module.

- [ ] **Step 6: Run service tests and typecheck**

Run:

```powershell
corepack pnpm --dir apps/web exec tsx --test src/server/funds/module-visibility.test.ts
corepack pnpm --dir apps/web run typecheck
```

Expected: service tests and typecheck pass.

- [ ] **Step 7: Commit the administration slice**

```powershell
git add apps/web/src/server/funds apps/web/src/app/dashboard/fundos apps/web/src/components/funds-table.tsx
git commit -m "feat: manage fund modules from funds screen"
```

### Task 3: Apply module visibility to Dashboard, DRE, Previsões, and PDD

**Files:**
- Modify: `apps/web/src/app/dashboard/page.tsx`
- Modify: `apps/web/src/app/dashboard/dre/page.tsx`
- Modify: `apps/web/src/app/dashboard/previsoes/page.tsx`
- Modify: `apps/web/src/app/dashboard/pdd/page.tsx`
- Test: `apps/web/src/lib/fund-modules.test.ts`

**Interfaces:**
- Consumes `fundEnabledFor("DASHBOARD" | "DRE" | "FORECASTS" | "PDD")`.
- Preserves the existing `findDefaultFund` behavior over the already-filtered list.

- [ ] **Step 1: Extend the failing query-contract tests**

Add one assertion per page module to prove each call receives the correct enum and that composing the helper with the placeholder-CNPJ exclusion retains both conditions. Expose a pure `fundListWhere(module)` helper if needed so the contract is tested without importing a server page.

- [ ] **Step 2: Run the contract test and verify RED**

Run: `corepack pnpm --dir apps/web exec tsx --test src/lib/fund-modules.test.ts`

Expected: the new composed-filter assertion fails until `fundListWhere` exists.

- [ ] **Step 3: Implement composed filter and update four pages**

Replace `status: "ACTIVE"` in each fund-list query with the appropriate central filter. Keep the placeholder CNPJ exclusion. Update empty-state text to say no fund is enabled for that module. Because `findDefaultFund` receives only enabled funds, a disabled `fundId` in the URL automatically falls back safely.

- [ ] **Step 4: Run tests, typecheck, and inspect module use**

Run:

```powershell
corepack pnpm --dir apps/web exec tsx --test src/lib/fund-modules.test.ts
corepack pnpm --dir apps/web run typecheck
rg -n 'fundListWhere\("(DASHBOARD|DRE|FORECASTS|PDD)"\)' apps/web/src/app/dashboard
```

Expected: tests/typecheck pass and each module appears in its intended page.

- [ ] **Step 5: Commit the analytical screens slice**

```powershell
git add apps/web/src/lib/fund-modules* apps/web/src/app/dashboard/page.tsx apps/web/src/app/dashboard/dre/page.tsx apps/web/src/app/dashboard/previsoes/page.tsx apps/web/src/app/dashboard/pdd/page.tsx
git commit -m "feat: filter fund screens by module"
```

### Task 4: Enforce Caixa visibility on reads and writes

**Files:**
- Create: `apps/web/src/server/cash/fund-access.ts`
- Create: `apps/web/src/server/cash/fund-access.test.ts`
- Modify: `apps/web/src/app/dashboard/caixa/actions.ts`

**Interfaces:**
- Consumes `fundListWhere("CASH")` from Task 3.
- Produces `validateCashFundIdsWithDependencies(fundIds, database)` returning either the accepted unique IDs or a public error.

- [ ] **Step 1: Write failing Caixa access tests**

Test unique-ID normalization, rejection when any requested ID is missing from the cash-enabled query, acceptance of ANTENA when returned by the database, and the exact `fundListWhere("CASH")` contract.

```ts
const result = await validateCashFundIdsWithDependencies(
  ["apuama", "antena", "antena"],
  database
);
assert.deepEqual(result, { ok: true, fundIds: ["apuama", "antena"] });
```

- [ ] **Step 2: Run tests and verify RED**

Run: `corepack pnpm --dir apps/web exec tsx --test src/server/cash/fund-access.test.ts`

Expected: FAIL because the access module does not exist.

- [ ] **Step 3: Implement validation and apply it to every Caixa boundary**

Use `fundListWhere("CASH")` in `getActiveCashFunds`. Filter `getCashDailyBalancesByDate` through the related fund. Before individual upsert, validate its one fund ID. Before batch upsert, validate all unique IDs and abort the entire action if any is unavailable. Return “Fundo não habilitado para o Caixa.” without writing.

- [ ] **Step 4: Run Caixa tests and typecheck**

Run:

```powershell
corepack pnpm --dir apps/web exec tsx --test src/server/cash/fund-access.test.ts
corepack pnpm --dir apps/web run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit the Caixa slice**

```powershell
git add apps/web/src/server/cash apps/web/src/app/dashboard/caixa/actions.ts
git commit -m "feat: enforce cash fund visibility"
```

### Task 5: Integrated verification, team board, and delivery

**Files:**
- Modify: `docs/TASKS.md`

**Interfaces:**
- Consumes all previous tasks.
- Produces a verified branch and explicit deployment checklist.

- [ ] **Step 1: Run all new tests together**

Run:

```powershell
corepack pnpm --dir apps/web exec tsx --test src/lib/fund-modules.test.ts src/server/funds/module-visibility.test.ts src/server/cash/fund-access.test.ts
```

Expected: all new tests pass with zero failures.

- [ ] **Step 2: Run the existing regression suite**

Run: `corepack pnpm --dir apps/web run test:operational`

Expected: all existing operational tests pass.

- [ ] **Step 3: Validate schema, types, and production build**

Run:

```powershell
$env:DATABASE_URL='postgresql://validate:validate@localhost:5432/validate?schema=OSHER'
corepack pnpm --dir packages/database exec prisma validate
corepack pnpm --dir packages/database exec prisma generate
corepack pnpm --dir apps/web run typecheck
corepack pnpm --dir apps/web run build
Remove-Item Env:DATABASE_URL
```

Expected: schema, generation, typecheck, and build all succeed.

- [ ] **Step 4: Review migration and diff**

Confirm the migration only adds the enum/table/relations, backfills module rows, and changes ANTENA/CONSIGNADO statuses. Run:

```powershell
git diff origin/feat/dashboard-vop-snapshots...HEAD --check
git diff origin/feat/dashboard-vop-snapshots...HEAD --stat
git status --short
```

Expected: no whitespace errors, secrets, environment files, or unrelated changes.

- [ ] **Step 5: Update and commit the team board**

Move the task to “Concluídas”, noting that migration deployment must precede the application deployment.

```powershell
git add docs/TASKS.md docs/superpowers/plans/2026-09-23-fund-module-visibility.md
git commit -m "docs: conclude fund module visibility"
```

- [ ] **Step 6: Push only after explicit delivery authorization**

If the user asks for push after reviewing the implementation:

```powershell
git push -u origin feat/fund-module-visibility
```

Keep the worktree for review and deployment follow-up.

