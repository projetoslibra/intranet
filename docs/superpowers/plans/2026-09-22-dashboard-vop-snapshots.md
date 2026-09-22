# Dashboard VOP Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist immutable daily VOP snapshots for active APUAMA and BRISTOL funds and display the latest daily and monthly accumulated values on the Dashboard.

**Architecture:** A focused server module owns fund matching, stability checks, missing-date discovery, aggregation, and insert-only persistence. A protected Vercel cron calls it twice daily, while a separate read helper supplies already-frozen values to the Dashboard without side effects.

**Tech Stack:** Next.js 14 server components and route handlers, TypeScript 5.7, Prisma 6/PostgreSQL, Node test runner through `tsx --test`, Vercel Cron.

**Spec:** `docs/superpowers/specs/2026-09-22-dashboard-vop-snapshots-design.md`

## Global Constraints

- Only active APUAMA and BRISTOL funds are eligible.
- Calculate each date from rows where `dataReferencia` and `dataAquisicao` are that same date.
- Never update or delete an existing snapshot.
- Backfill only the month containing each fund's latest stock position.
- A stock position must be quiet for at least 10 minutes before freezing.
- Dashboard reads never create or recalculate snapshots.
- Missing snapshots display as `Indisponível`; a real zero displays as `R$ 0,00`.
- Cron schedules are 10:00 and 15:30 America/Sao_Paulo, represented as 13:00 and 18:30 UTC.

---

### Task 1: VOP domain rules and snapshot persistence

**Files:**
- Create: `apps/web/src/server/dashboard/vop-snapshots.ts`
- Create: `apps/web/src/server/dashboard/vop-snapshots.test.ts`
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260922130000_add_fund_vop_snapshots/migration.sql`

**Interfaces:**
- Produces: `syncVopSnapshots(options?: { now?: Date }): Promise<VopSyncResult>` for the cron route.
- Produces: `loadFundVopSummary(fundId: string): Promise<FundVopSummary | null>` for the Dashboard.
- Produces: pure exported helpers `resolveVopFundKey`, `isStablePosition`, and `monthBounds` for focused unit tests.

- [ ] **Step 1: Write failing domain tests**

Cover normalized APUAMA/BRISTOL matching, rejection of unrelated funds, month bounds in UTC, the exact ten-minute stability boundary, acquisition-date filtering, idempotent conflict behavior through an injected fake repository, zero-valued snapshots, and preserving an existing value when the source changes.

```ts
test("keeps an existing snapshot immutable", async () => {
  const repository = fakeRepository({ existing: [{ fundId: "apuama", referenceDate: day, amount: 100 }] });
  repository.stockRows = [{ referenceDate: day, acquisitionDate: day, amount: 999 }];
  await syncVopSnapshots({ now, repository });
  assert.deepEqual(repository.snapshots, [{ fundId: "apuama", referenceDate: day, amount: 100 }]);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `corepack pnpm --dir apps/web exec tsx --test src/server/dashboard/vop-snapshots.test.ts`

Expected: FAIL because `vop-snapshots.ts` does not exist.

- [ ] **Step 3: Add the Prisma model and SQL migration**

Add `vopSnapshots FundVopSnapshot[]` to `Fund` and define:

```prisma
model FundVopSnapshot {
  id            String   @id @default(cuid())
  fundId        String   @map("fund_id")
  referenceDate DateTime @map("reference_date") @db.Date
  amount        Decimal  @db.Decimal(24, 10)
  createdAt     DateTime @default(now()) @map("created_at")
  fund          Fund     @relation(fields: [fundId], references: [id], onDelete: Restrict)

  @@unique([fundId, referenceDate])
  @@index([referenceDate])
  @@map("fund_vop_snapshots")
}
```

The SQL migration creates the table, unique constraint, date index, and restrictive foreign key to `Fund(id)`.

- [ ] **Step 4: Implement the minimal server module**

Define a small repository interface used by `syncVopSnapshots`, with a Prisma-backed default. For each matched active fund, find its latest stock date, enumerate stock dates in that month, exclude existing snapshots, reject dates whose maximum stock `createdAt` is newer than `now - 10 minutes`, aggregate `valorAquisicao` only where `dataAquisicao = dataReferencia`, and call `createMany({ skipDuplicates: true })`. Use Prisma `Decimal`/database aggregation without converting money to floating point.

`loadFundVopSummary` must return:

```ts
type FundVopSummary = {
  referenceDate: Date;
  dailyAmount: number;
  monthlyAmount: number;
};
```

It finds the latest snapshot and aggregates from the UTC month start through that snapshot date.

- [ ] **Step 5: Run focused tests and Prisma validation**

Run:

```powershell
corepack pnpm --dir apps/web exec tsx --test src/server/dashboard/vop-snapshots.test.ts
corepack pnpm --dir packages/database exec prisma validate
corepack pnpm --dir packages/database exec prisma generate
```

Expected: all tests PASS; Prisma schema validates and client generation succeeds.

- [ ] **Step 6: Commit the persistence slice**

```powershell
git add apps/web/src/server/dashboard packages/database/prisma
git commit -m "feat: persist daily VOP snapshots"
```

### Task 2: Protected scheduled synchronization

**Files:**
- Create: `apps/web/src/app/api/cron/vop-snapshots/route.ts`
- Create: `apps/web/src/app/api/cron/vop-snapshots/route.test.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `syncVopSnapshots()` from Task 1.
- Produces: authenticated `GET /api/cron/vop-snapshots` and two Vercel schedules.

- [ ] **Step 1: Write failing route tests**

Extract and export `authorizeCronRequest(request, expectedSecret)` and `statusForVopSync(result)` so tests can assert missing configuration → 500, invalid token → 401, valid bearer or `x-osher-api-key` → authorized, all funds successful → 200, and any fund failure → 207.

- [ ] **Step 2: Run the route tests and verify failure**

Run: `corepack pnpm --dir apps/web exec tsx --test src/app/api/cron/vop-snapshots/route.test.ts`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement the route and schedules**

Follow the existing Singulare cron authorization convention, call `syncVopSnapshots`, and return its per-fund result. Add both schedules without removing the existing Singulare schedule:

```json
{ "path": "/api/cron/vop-snapshots", "schedule": "0 13 * * *" },
{ "path": "/api/cron/vop-snapshots", "schedule": "30 18 * * *" }
```

- [ ] **Step 4: Run route tests**

Run: `corepack pnpm --dir apps/web exec tsx --test src/app/api/cron/vop-snapshots/route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the cron slice**

```powershell
git add apps/web/src/app/api/cron/vop-snapshots vercel.json
git commit -m "feat: schedule VOP snapshot synchronization"
```

### Task 3: Dashboard VOP indicators

**Files:**
- Create: `apps/web/src/server/dashboard/vop-display.ts`
- Create: `apps/web/src/server/dashboard/vop-display.test.ts`
- Modify: `apps/web/src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `loadFundVopSummary(fundId)` from Task 1.
- Produces: `toVopDisplay(summary): { dailyLabel: string; monthlyLabel: string; dateLabel: string }` used by the Dashboard.

- [ ] **Step 1: Write failing display tests**

Assert that `null` produces two `Indisponível` labels and no misleading date, a zero summary formats both amounts as `R$ 0,00`, and a populated summary formats BRL plus `Posição em DD/MM/AAAA` using UTC.

- [ ] **Step 2: Run the display tests and verify failure**

Run: `corepack pnpm --dir apps/web exec tsx --test src/server/dashboard/vop-display.test.ts`

Expected: FAIL because `vop-display.ts` does not exist.

- [ ] **Step 3: Implement display mapping and Dashboard reads**

Add nullable VOP fields to `FundDashboardData`. During each fund's existing parallel data load, call `loadFundVopSummary` only for resolved APUAMA/BRISTOL funds. Add a two-column VOP section to each eligible fund card with `VOP do dia`, `VOP no mês`, and the snapshot position date; do not call synchronization code from the page.

- [ ] **Step 4: Run display tests and typecheck**

Run:

```powershell
corepack pnpm --dir apps/web exec tsx --test src/server/dashboard/vop-display.test.ts
corepack pnpm --dir apps/web run typecheck
```

Expected: tests PASS and TypeScript reports no errors.

- [ ] **Step 5: Commit the Dashboard slice**

```powershell
git add apps/web/src/server/dashboard/vop-display* apps/web/src/app/dashboard/page.tsx
git commit -m "feat: show daily and monthly VOP on dashboard"
```

### Task 4: Integrated verification and handoff

**Files:**
- Modify: `docs/TASKS.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified branch ready for push, with the team board reflecting completion and deployment requirements.

- [ ] **Step 1: Run all new tests together**

Run:

```powershell
corepack pnpm --dir apps/web exec tsx --test src/server/dashboard/vop-snapshots.test.ts src/app/api/cron/vop-snapshots/route.test.ts src/server/dashboard/vop-display.test.ts
```

Expected: all tests PASS.

- [ ] **Step 2: Run project verification**

Run:

```powershell
corepack pnpm --dir packages/database exec prisma validate
corepack pnpm --dir packages/database exec prisma generate
corepack pnpm --dir apps/web run typecheck
corepack pnpm --dir apps/web run build
```

Expected: schema validation, generation, typecheck, and production build all succeed. If pnpm blocks Prisma scripts, use the documented direct binary workaround from `CLAUDE.md` and record the exact result.

- [ ] **Step 3: Review the diff for scope and secrets**

Run:

```powershell
git diff origin/main...HEAD --check
git diff origin/main...HEAD --stat
git status --short
```

Expected: no whitespace errors, no `.env` or secret values, and only VOP-related files plus the approved documentation.

- [ ] **Step 4: Update the team board and commit verification state**

Move the VOP task from “Em andamento” to “Concluídas”, noting that the migration must be applied and the first authorized cron call must be run in the target environment.

```powershell
git add docs/TASKS.md docs/superpowers/plans/2026-09-22-dashboard-vop-snapshots.md
git commit -m "docs: conclude dashboard VOP delivery"
```

- [ ] **Step 5: Push the feature branch**

```powershell
git push -u origin feat/dashboard-vop-snapshots
```

Expected: remote branch created and local branch tracks it.

