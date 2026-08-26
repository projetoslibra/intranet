# Cruzamento de títulos não encontrados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recuperar títulos `NOT_FOUND` do lote de baixa por sacado + valor nominal + vencimento, apresentando sugestões auditáveis que o operador aceita em lote ou individualmente.

**Architecture:** Um motor puro sem banco calcula as sugestões e faz a alocação um-para-um; um serviço carrega o contexto do Prisma e aplica as aceitas reusando o caminho de correção manual; uma rota expõe sugerir (GET) e aplicar (POST); um painel novo renderiza a aba "Não encontrados no estoque" sem tocar no restante do painel de baixas.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Prisma, `node:test` + `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-26-cruzamento-titulos-nao-encontrados-design.md`

## Global Constraints

- Não alterar `chooseCandidate`, `loadCandidates`, `parseBmpCnab` nem `parseUy3Workbook`. O título continua chegando como `NOT_FOUND`.
- Nenhuma migration. O enum `SettlementItemStatus` fica inalterado; o item aceito vira `MANUALLY_MATCHED`.
- Tolerância de valor: `Math.abs(left - right) < 0.01`.
- Permissão obrigatória em toda rota nova: `operational.finance.manage`.
- Idioma do código em inglês; idioma da interface em português brasileiro.
- Valores financeiros com `Prisma.Decimal` na persistência; o motor puro trabalha com `number` porque só compara com tolerância.
- Datas comparadas por dia em UTC (`toISOString().slice(0, 10)`), nunca por instante.
- A etapa de sugestão não grava nada no banco.
- A aplicação nunca aceita `positionId` vindo do cliente.

---

### Task 1: Motor puro de cruzamento

**Files:**
- Create: `apps/web/src/server/operational/consignado-cross-match.ts`
- Create: `apps/web/src/server/operational/consignado-cross-match.test.ts`
- Modify: `apps/web/package.json:11` (adicionar o novo teste ao script `test:operational`)

**Interfaces:**
- Consumes: nada. Módulo puro, sem imports do projeto.
- Produces:
  - `type CrossMatchGroup = "FULL_KEY" | "OLDEST_NEXT_MONTH" | "OLDEST_WIDE_GAP"`
  - `type CrossMatchField = "debtorDocument" | "debtorName" | "nominalValue" | "dueDate"`
  - `type CrossMatchItem = { id: string; sourceRow: number; debtorName: string | null; debtorDocument: string | null; dueDate: Date | null; titleAmount: number }`
  - `type CrossMatchPosition = { id: string; yourNumber: string | null; documentNumber: string | null; debtorName: string; debtorDocument: string; cedentName: string; nominalValue: number; dueDate: Date | null }`
  - `type CrossMatchSuggestion = { itemId: string; positionId: string; group: CrossMatchGroup; matchedOn: CrossMatchField[]; fileDueDate: string | null; stockDueDate: string | null; poolSize: number }`
  - `buildCrossMatchSuggestions(input: { source: "BMP" | "UY3"; items: CrossMatchItem[]; positions: CrossMatchPosition[]; blockedPositionIds?: Iterable<string> }): { suggestions: CrossMatchSuggestion[]; unmatchedItemIds: string[] }`

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/web/src/server/operational/consignado-cross-match.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildCrossMatchSuggestions, type CrossMatchItem, type CrossMatchPosition } from "./consignado-cross-match";

function item(overrides: Partial<CrossMatchItem> = {}): CrossMatchItem {
  return { id: "item-1", sourceRow: 1, debtorName: "MARIANA ALVES SILVA SIMOES", debtorDocument: "37335957850", dueDate: new Date("2026-08-23T00:00:00.000Z"), titleAmount: 41.73, ...overrides };
}

function position(overrides: Partial<CrossMatchPosition> = {}): CrossMatchPosition {
  return { id: "pos-1", yourNumber: "463283", documentNumber: "1", debtorName: "MARIANA ALVES SILVA SIMOES", debtorDocument: "373.359.578-50", cedentName: "BMP SOCIEDADE DE CREDITO DIRETO S.A", nominalValue: 41.73, dueDate: new Date("2026-08-23T00:00:00.000Z"), ...overrides };
}

test("casa cpf formatado no estoque com cpf sem pontuacao do arquivo", () => {
  const result = buildCrossMatchSuggestions({ source: "BMP", items: [item()], positions: [position()] });
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].positionId, "pos-1");
  assert.equal(result.suggestions[0].group, "FULL_KEY");
  assert.deepEqual(result.suggestions[0].matchedOn, ["debtorDocument", "nominalValue", "dueDate"]);
  assert.deepEqual(result.unmatchedItemIds, []);
});

test("casa por nome normalizado quando falta documento dos dois lados", () => {
  const result = buildCrossMatchSuggestions({
    source: "BMP",
    items: [item({ debtorDocument: null, debtorName: "  joão   da SILVA " })],
    positions: [position({ debtorDocument: "", debtorName: "JOAO DA SILVA" })],
  });
  assert.equal(result.suggestions.length, 1);
  assert.deepEqual(result.suggestions[0].matchedOn, ["debtorName", "nominalValue", "dueDate"]);
});

test("documento diferente reprova o par mesmo com nome identico", () => {
  const result = buildCrossMatchSuggestions({
    source: "BMP",
    items: [item({ debtorDocument: "11111111111" })],
    positions: [position({ debtorDocument: "222.222.222-22" })],
  });
  assert.deepEqual(result.suggestions, []);
  assert.deepEqual(result.unmatchedItemIds, ["item-1"]);
});

test("sem vencimento exato escolhe a parcela mais antiga e marca um mes de intervalo", () => {
  const result = buildCrossMatchSuggestions({
    source: "BMP",
    items: [item({ dueDate: new Date("2026-06-23T00:00:00.000Z"), titleAmount: 18.56 })],
    positions: [
      position({ id: "pos-set", documentNumber: "3", nominalValue: 18.56, dueDate: new Date("2026-09-23T00:00:00.000Z") }),
      position({ id: "pos-jul", documentNumber: "1", nominalValue: 18.56, dueDate: new Date("2026-07-23T00:00:00.000Z") }),
      position({ id: "pos-ago", documentNumber: "2", nominalValue: 18.56, dueDate: new Date("2026-08-23T00:00:00.000Z") }),
    ],
  });
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].positionId, "pos-jul");
  assert.equal(result.suggestions[0].group, "OLDEST_NEXT_MONTH");
  assert.equal(result.suggestions[0].stockDueDate, "2026-07-23");
  assert.equal(result.suggestions[0].fileDueDate, "2026-06-23");
});

test("intervalo diferente de um mes cai no grupo de revisao individual", () => {
  const result = buildCrossMatchSuggestions({
    source: "BMP",
    items: [item({ dueDate: new Date("2026-06-23T00:00:00.000Z"), titleAmount: 22.4 })],
    positions: [position({ id: "pos-ago", nominalValue: 22.4, dueDate: new Date("2026-08-23T00:00:00.000Z") })],
  });
  assert.equal(result.suggestions[0].group, "OLDEST_WIDE_GAP");
});

test("dia inexistente no mes seguinte usa o ultimo dia do mes", () => {
  const result = buildCrossMatchSuggestions({
    source: "BMP",
    items: [item({ dueDate: new Date("2026-01-31T00:00:00.000Z") })],
    positions: [position({ dueDate: new Date("2026-02-28T00:00:00.000Z") })],
  });
  assert.equal(result.suggestions[0].group, "OLDEST_NEXT_MONTH");
});

test("posicao bloqueada nunca e sugerida", () => {
  const result = buildCrossMatchSuggestions({ source: "BMP", items: [item()], positions: [position()], blockedPositionIds: ["pos-1"] });
  assert.deepEqual(result.suggestions, []);
  assert.deepEqual(result.unmatchedItemIds, ["item-1"]);
});

test("arquivo bmp nao recebe sugestao de titulo de cedente uy3", () => {
  const result = buildCrossMatchSuggestions({ source: "BMP", items: [item()], positions: [position({ cedentName: "UY3 SOCIEDADE DE CREDITO DIRETO S.A" })] });
  assert.deepEqual(result.suggestions, []);
});

test("duas linhas equivalentes recebem uma posicao equivalente cada", () => {
  const result = buildCrossMatchSuggestions({
    source: "BMP",
    items: [
      item({ id: "item-185", sourceRow: 185, debtorName: "LIANE DA SILVA CHAGAS", debtorDocument: "99988877766", titleAmount: 41.8 }),
      item({ id: "item-373", sourceRow: 373, debtorName: "LIANE DA SILVA CHAGAS", debtorDocument: "99988877766", titleAmount: 41.8 }),
    ],
    positions: [
      position({ id: "pos-456206", yourNumber: "456206", debtorDocument: "999.888.777-66", debtorName: "LIANE DA SILVA CHAGAS", nominalValue: 41.8 }),
      position({ id: "pos-456197", yourNumber: "456197", debtorDocument: "999.888.777-66", debtorName: "LIANE DA SILVA CHAGAS", nominalValue: 41.8 }),
    ],
  });
  assert.equal(result.suggestions.length, 2);
  assert.deepEqual(result.suggestions.map((suggestion) => suggestion.positionId).sort(), ["pos-456197", "pos-456206"]);
  assert.deepEqual(result.unmatchedItemIds, []);
});

test("item que perde a posicao exata nao cai para a parcela mais antiga", () => {
  const result = buildCrossMatchSuggestions({
    source: "BMP",
    items: [item({ id: "item-a", sourceRow: 1 }), item({ id: "item-b", sourceRow: 2 })],
    positions: [position({ id: "pos-exata" }), position({ id: "pos-futura", documentNumber: "2", dueDate: new Date("2026-09-23T00:00:00.000Z") })],
  });
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].itemId, "item-a");
  assert.equal(result.suggestions[0].positionId, "pos-exata");
  assert.deepEqual(result.unmatchedItemIds, ["item-b"]);
});

test("item sem candidato fica sem sugestao", () => {
  const result = buildCrossMatchSuggestions({ source: "BMP", items: [item({ titleAmount: 999.99 })], positions: [position()] });
  assert.deepEqual(result.suggestions, []);
  assert.deepEqual(result.unmatchedItemIds, ["item-1"]);
});

test("a mesma entrada produz sempre a mesma saida", () => {
  const input = {
    source: "BMP" as const,
    items: [item({ id: "item-a", sourceRow: 2 }), item({ id: "item-b", sourceRow: 1 })],
    positions: [position({ id: "pos-x", documentNumber: "2" }), position({ id: "pos-y", documentNumber: "1" })],
  };
  const output = buildCrossMatchSuggestions(input);
  assert.deepEqual(buildCrossMatchSuggestions(input), output);
  assert.equal(output.suggestions.find((entry) => entry.itemId === "item-b")?.positionId, "pos-y");
  assert.equal(output.suggestions.find((entry) => entry.itemId === "item-a")?.positionId, "pos-x");
});
```

- [ ] **Step 2: Rodar o teste e confirmar a falha**

Run: `cd apps/web && npx tsx --test src/server/operational/consignado-cross-match.test.ts`
Expected: FAIL — não resolve `./consignado-cross-match`.

- [ ] **Step 3: Implementar o motor**

Criar `apps/web/src/server/operational/consignado-cross-match.ts`:

```ts
export type CrossMatchGroup = "FULL_KEY" | "OLDEST_NEXT_MONTH" | "OLDEST_WIDE_GAP";
export type CrossMatchField = "debtorDocument" | "debtorName" | "nominalValue" | "dueDate";

export type CrossMatchItem = {
  id: string;
  sourceRow: number;
  debtorName: string | null;
  debtorDocument: string | null;
  dueDate: Date | null;
  titleAmount: number;
};

export type CrossMatchPosition = {
  id: string;
  yourNumber: string | null;
  documentNumber: string | null;
  debtorName: string;
  debtorDocument: string;
  cedentName: string;
  nominalValue: number;
  dueDate: Date | null;
};

export type CrossMatchSuggestion = {
  itemId: string;
  positionId: string;
  group: CrossMatchGroup;
  matchedOn: CrossMatchField[];
  fileDueDate: string | null;
  stockDueDate: string | null;
  poolSize: number;
};

function digits(value: unknown) { return String(value ?? "").replace(/\D/g, ""); }
function normalized(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase().replace(/\s+/g, " ");
}
function sameMoney(left: number, right: number) { return Math.abs(left - right) < 0.01; }
function dayKey(value: Date | null) { return value ? value.toISOString().slice(0, 10) : null; }
function parcel(value: string | null) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function cedentMatchesSource(source: "BMP" | "UY3", cedentName: string) {
  const cedent = normalized(cedentName);
  return source === "UY3" ? cedent.includes("UY3") : cedent.includes("BMP") || cedent.includes("MONEY PLUS");
}

function debtorField(item: CrossMatchItem, position: CrossMatchPosition): CrossMatchField | null {
  const itemDocument = digits(item.debtorDocument);
  const positionDocument = digits(position.debtorDocument);
  if (itemDocument && positionDocument) return itemDocument === positionDocument ? "debtorDocument" : null;
  const itemName = normalized(item.debtorName);
  return itemName && itemName === normalized(position.debtorName) ? "debtorName" : null;
}

function isNextMonth(fileDue: Date, stockDue: Date) {
  const year = fileDue.getUTCFullYear();
  const month = fileDue.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  const expected = new Date(Date.UTC(year, month + 1, Math.min(fileDue.getUTCDate(), lastDay)));
  return dayKey(expected) === dayKey(stockDue);
}

function byStableOrder(left: CrossMatchPosition, right: CrossMatchPosition) {
  return parcel(left.documentNumber) - parcel(right.documentNumber)
    || String(left.yourNumber ?? "").localeCompare(String(right.yourNumber ?? ""))
    || left.id.localeCompare(right.id);
}

function byDueDateThenStable(left: CrossMatchPosition, right: CrossMatchPosition) {
  const leftDue = dayKey(left.dueDate) ?? "9999-12-31";
  const rightDue = dayKey(right.dueDate) ?? "9999-12-31";
  return leftDue.localeCompare(rightDue) || byStableOrder(left, right);
}

export function buildCrossMatchSuggestions(input: {
  source: "BMP" | "UY3";
  items: CrossMatchItem[];
  positions: CrossMatchPosition[];
  blockedPositionIds?: Iterable<string>;
}): { suggestions: CrossMatchSuggestion[]; unmatchedItemIds: string[] } {
  const blocked = new Set(input.blockedPositionIds ?? []);
  const available = input.positions.filter((position) => !blocked.has(position.id) && cedentMatchesSource(input.source, position.cedentName));
  const items = [...input.items].sort((left, right) => left.sourceRow - right.sourceRow || left.id.localeCompare(right.id));

  const pools = new Map<string, { field: CrossMatchField; position: CrossMatchPosition }[]>();
  items.forEach((entry) => {
    pools.set(entry.id, available.flatMap((position) => {
      const field = debtorField(entry, position);
      if (!field || !sameMoney(position.nominalValue, entry.titleAmount)) return [];
      return [{ field, position }];
    }));
  });

  const consumed = new Set<string>();
  const suggestions: CrossMatchSuggestion[] = [];
  const unmatchedItemIds: string[] = [];
  const settled = new Set<string>();

  items.forEach((entry) => {
    const fileDueDate = dayKey(entry.dueDate);
    const exact = (pools.get(entry.id) ?? []).filter(({ position }) => fileDueDate !== null && dayKey(position.dueDate) === fileDueDate);
    if (!exact.length) return;
    settled.add(entry.id);
    const free = exact.filter(({ position }) => !consumed.has(position.id)).sort((left, right) => byStableOrder(left.position, right.position));
    const chosen = free[0];
    if (!chosen) { unmatchedItemIds.push(entry.id); return; }
    consumed.add(chosen.position.id);
    suggestions.push({
      itemId: entry.id, positionId: chosen.position.id, group: "FULL_KEY",
      matchedOn: [chosen.field, "nominalValue", "dueDate"],
      fileDueDate, stockDueDate: dayKey(chosen.position.dueDate), poolSize: exact.length,
    });
  });

  items.forEach((entry) => {
    if (settled.has(entry.id)) return;
    const pool = (pools.get(entry.id) ?? []).filter(({ position }) => !consumed.has(position.id)).sort((left, right) => byDueDateThenStable(left.position, right.position));
    const chosen = pool[0];
    if (!chosen) { unmatchedItemIds.push(entry.id); return; }
    consumed.add(chosen.position.id);
    const nextMonth = Boolean(entry.dueDate && chosen.position.dueDate && isNextMonth(entry.dueDate, chosen.position.dueDate));
    suggestions.push({
      itemId: entry.id, positionId: chosen.position.id,
      group: nextMonth ? "OLDEST_NEXT_MONTH" : "OLDEST_WIDE_GAP",
      matchedOn: [chosen.field, "nominalValue"],
      fileDueDate: dayKey(entry.dueDate), stockDueDate: dayKey(chosen.position.dueDate), poolSize: pool.length,
    });
  });

  return {
    suggestions: suggestions.sort((left, right) => left.itemId.localeCompare(right.itemId)),
    unmatchedItemIds: unmatchedItemIds.sort(),
  };
}
```

- [ ] **Step 4: Rodar os testes e confirmar aprovação**

Run: `cd apps/web && npx tsx --test src/server/operational/consignado-cross-match.test.ts`
Expected: PASS, 12 testes.

- [ ] **Step 5: Registrar o teste no script do projeto**

Em `apps/web/package.json`, acrescentar `src/server/operational/consignado-cross-match.test.ts` ao final da lista de arquivos do script `test:operational`.

Run: `cd apps/web && npm run test:operational`
Expected: PASS em toda a suíte.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/operational/consignado-cross-match.ts apps/web/src/server/operational/consignado-cross-match.test.ts apps/web/package.json
git commit -m "feat: motor de cruzamento de titulos nao encontrados"
```

---

### Task 2: Serviço de sugestão e aplicação

**Files:**
- Create: `apps/web/src/server/operational/consignado-cross-match-service.ts`
- Modify: `apps/web/src/server/operational/consignado-settlement-service.ts:260` (trocar `async function refreshBatchTotals` por `export async function refreshBatchTotals`)

**Interfaces:**
- Consumes: `buildCrossMatchSuggestions`, `CrossMatchGroup`, `CrossMatchSuggestion` da Task 1; `refreshBatchTotals(batchId: string)` do serviço de baixas.
- Produces:
  - `type CrossMatchSuggestionView = { itemId: string; group: CrossMatchGroup; matchedOn: string[]; fileDueDate: string | null; stockDueDate: string | null; item: { sourceRow: number; contractNumber: string | null; debtorName: string | null; debtorDocument: string | null; titleAmount: string; paidAmount: string }; position: { id: string; yourNumber: string | null; documentNumber: string | null; debtorName: string; debtorDocument: string; nominalValue: string; dueDate: string | null } }`
  - `type CrossMatchUnmatchedView = { itemId: string; sourceRow: number; debtorName: string | null; debtorDocument: string | null; titleAmount: string; paidAmount: string }`
  - `suggestCrossMatches(batchId: string): Promise<{ analyzed: number; suggestions: CrossMatchSuggestionView[]; unmatched: CrossMatchUnmatchedView[] }>`
  - `applyCrossMatches(input: { userId: string; batchId: string; itemIds: string[] }): Promise<{ appliedItems: number; paidAmount: string }>`

- [ ] **Step 1: Exportar `refreshBatchTotals`**

Em `apps/web/src/server/operational/consignado-settlement-service.ts`, linha 260, trocar:

```ts
async function refreshBatchTotals(batchId: string) {
```

por:

```ts
export async function refreshBatchTotals(batchId: string) {
```

- [ ] **Step 2: Implementar o serviço**

Criar `apps/web/src/server/operational/consignado-cross-match-service.ts`:

```ts
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildCrossMatchSuggestions, type CrossMatchGroup, type CrossMatchPosition } from "./consignado-cross-match";
import { refreshBatchTotals } from "./consignado-settlement-service";

const CHUNK = 300;

const groupJustification: Record<CrossMatchGroup, string> = {
  FULL_KEY: "chave completa: sacado, valor nominal e vencimento idênticos ao título do estoque",
  OLDEST_NEXT_MONTH: "parcela em aberto mais antiga, um mês após o vencimento do arquivo",
  OLDEST_WIDE_GAP: "parcela em aberto mais antiga, com intervalo maior que um mês",
};

function digits(value: unknown) { return String(value ?? "").replace(/\D/g, ""); }

export function documentVariants(document: string | null) {
  const value = digits(document);
  if (!value) return [];
  if (value.length === 11) return [value, `${value.slice(0, 3)}.${value.slice(3, 6)}.${value.slice(6, 9)}-${value.slice(9)}`];
  if (value.length === 14) return [value, `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8, 12)}-${value.slice(12)}`];
  return [value];
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) result.push(values.slice(offset, offset + size));
  return result;
}

const positionSelect = {
  id: true, yourNumber: true, documentNumber: true, debtorName: true, debtorDocument: true,
  cedentName: true, nominalValue: true, originalDueDate: true, adjustedDueDate: true,
} satisfies Prisma.ReceivableStockPositionSelect;

type PositionRow = Prisma.ReceivableStockPositionGetPayload<{ select: typeof positionSelect }>;

async function loadContext(batchId: string) {
  const batch = await prisma.consignadoSettlementBatch.findUniqueOrThrow({
    where: { id: batchId },
    select: { id: true, source: true, status: true, stockBatchId: true },
  });
  const items = await prisma.consignadoSettlementItem.findMany({
    where: { batchId, status: "NOT_FOUND", approved: false },
    select: { id: true, sourceRow: true, contractNumber: true, debtorName: true, debtorDocument: true, dueDate: true, titleAmount: true, paidAmount: true },
    orderBy: { sourceRow: "asc" },
  });

  const documents = new Set<string>();
  const names = new Set<string>();
  items.forEach((item) => {
    const variants = documentVariants(item.debtorDocument);
    if (variants.length) variants.forEach((variant) => documents.add(variant));
    else if (item.debtorName) names.add(item.debtorName);
  });

  const positions = new Map<string, PositionRow>();
  for (const chunk of chunks(Array.from(documents), CHUNK)) {
    const rows = await prisma.receivableStockPosition.findMany({ where: { batchId: batch.stockBatchId, debtorDocument: { in: chunk } }, select: positionSelect });
    rows.forEach((row) => positions.set(row.id, row));
  }
  for (const chunk of chunks(Array.from(names), 50)) {
    const rows = await prisma.receivableStockPosition.findMany({
      where: { batchId: batch.stockBatchId, OR: chunk.map((name) => ({ debtorName: { equals: name, mode: "insensitive" as const } })) },
      select: positionSelect,
    });
    rows.forEach((row) => positions.set(row.id, row));
  }

  const approvedInBatch = await prisma.consignadoSettlementItem.findMany({
    where: { batchId, approved: true, matchedStockPositionId: { not: null } },
    select: { matchedStockPositionId: true },
  });
  const blocked = new Set(approvedInBatch.flatMap((entry) => entry.matchedStockPositionId ? [entry.matchedStockPositionId] : []));
  for (const chunk of chunks(Array.from(positions.keys()), CHUNK)) {
    const remitted = await prisma.consignadoRemittanceItem.findMany({
      where: { stockPositionId: { in: chunk }, remittance: { status: { not: "CANCELLED" } } },
      select: { stockPositionId: true },
    });
    remitted.forEach((entry) => { if (entry.stockPositionId) blocked.add(entry.stockPositionId); });
  }

  const enginePositions: CrossMatchPosition[] = Array.from(positions.values()).map((row) => ({
    id: row.id, yourNumber: row.yourNumber, documentNumber: row.documentNumber,
    debtorName: row.debtorName, debtorDocument: row.debtorDocument, cedentName: row.cedentName,
    nominalValue: Number(row.nominalValue), dueDate: row.adjustedDueDate ?? row.originalDueDate,
  }));

  const result = buildCrossMatchSuggestions({
    source: batch.source as "BMP" | "UY3",
    items: items.map((item) => ({ id: item.id, sourceRow: item.sourceRow, debtorName: item.debtorName, debtorDocument: item.debtorDocument, dueDate: item.dueDate, titleAmount: Number(item.titleAmount) })),
    positions: enginePositions,
    blockedPositionIds: blocked,
  });

  return { batch, items, positions, result };
}

export async function suggestCrossMatches(batchId: string) {
  const { items, positions, result } = await loadContext(batchId);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const suggestions = result.suggestions.flatMap((suggestion) => {
    const item = itemById.get(suggestion.itemId);
    const position = positions.get(suggestion.positionId);
    if (!item || !position) return [];
    return [{
      itemId: suggestion.itemId, group: suggestion.group, matchedOn: suggestion.matchedOn,
      fileDueDate: suggestion.fileDueDate, stockDueDate: suggestion.stockDueDate,
      item: { sourceRow: item.sourceRow, contractNumber: item.contractNumber, debtorName: item.debtorName, debtorDocument: item.debtorDocument, titleAmount: item.titleAmount.toString(), paidAmount: item.paidAmount.toString() },
      position: {
        id: position.id, yourNumber: position.yourNumber, documentNumber: position.documentNumber,
        debtorName: position.debtorName, debtorDocument: position.debtorDocument,
        nominalValue: position.nominalValue.toString(),
        dueDate: (position.adjustedDueDate ?? position.originalDueDate)?.toISOString().slice(0, 10) ?? null,
      },
    }];
  });
  suggestions.sort((left, right) => left.item.sourceRow - right.item.sourceRow);
  const unmatched = result.unmatchedItemIds.flatMap((itemId) => {
    const item = itemById.get(itemId);
    return item ? [{ itemId, sourceRow: item.sourceRow, debtorName: item.debtorName, debtorDocument: item.debtorDocument, titleAmount: item.titleAmount.toString(), paidAmount: item.paidAmount.toString() }] : [];
  }).sort((left, right) => left.sourceRow - right.sourceRow);
  return { analyzed: items.length, suggestions, unmatched };
}

export async function applyCrossMatches(input: { userId: string; batchId: string; itemIds: string[] }) {
  const { batch, items, result } = await loadContext(input.batchId);
  if (batch.status === "GENERATED") throw new Error("O lote já possui remessa gerada.");
  const requested = new Set(input.itemIds);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const selected = result.suggestions.filter((suggestion) => requested.has(suggestion.itemId) && itemById.has(suggestion.itemId));
  if (!selected.length) throw new Error("Nenhuma sugestão válida para aplicar. Rode o cruzamento novamente.");

  await prisma.$transaction(async (tx) => {
    for (const suggestion of selected) {
      const item = itemById.get(suggestion.itemId)!;
      const matchedBy = suggestion.matchedOn.includes("debtorDocument") ? "CPF" : "nome do sacado";
      const justification = `Cruzamento automático (${matchedBy}) — ${groupJustification[suggestion.group]}.`;
      await tx.consignadoManualCorrection.updateMany({ where: { itemId: item.id, active: true }, data: { active: false } });
      await tx.consignadoManualCorrection.create({ data: {
        itemId: item.id, replacementPositionId: suggestion.positionId, previousPositionId: null,
        userId: input.userId, originalYourNumber: item.contractNumber, replacementYourNumber: null,
        justification, active: true,
      } });
      await tx.consignadoSettlementItem.update({ where: { id: item.id }, data: {
        matchedStockPositionId: suggestion.positionId, matchedPddTitleId: null,
        status: "MANUALLY_MATCHED", statusReason: justification, approved: true, exclusionReason: null,
      } });
      await tx.consignadoStatusEvent.create({ data: {
        userId: input.userId, entityType: "SETTLEMENT_ITEM", entityId: item.id,
        fromStatus: "NOT_FOUND", toStatus: "MANUALLY_MATCHED",
        metadata: { crossMatchGroup: suggestion.group, matchedOn: suggestion.matchedOn, fileDueDate: suggestion.fileDueDate, stockDueDate: suggestion.stockDueDate, positionId: suggestion.positionId },
      } });
    }
  }, { maxWait: 5000, timeout: 30000 });

  await refreshBatchTotals(input.batchId);
  return {
    appliedItems: selected.length,
    paidAmount: selected.reduce((sum, suggestion) => sum.add(itemById.get(suggestion.itemId)!.paidAmount), new Prisma.Decimal(0)).toString(),
  };
}
```

- [ ] **Step 3: Conferir tipagem**

Run: `cd apps/web && npm run typecheck`
Expected: sem erros.

- [ ] **Step 4: Confirmar que a suíte segue verde**

Run: `cd apps/web && npm run test:operational`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/operational/consignado-cross-match-service.ts apps/web/src/server/operational/consignado-settlement-service.ts
git commit -m "feat: servico de sugestao e aplicacao do cruzamento"
```

---

### Task 3: Rota de cruzamento

**Files:**
- Create: `apps/web/src/app/api/operacional/consignado/baixas/[batchId]/cruzamento/route.ts`

**Interfaces:**
- Consumes: `suggestCrossMatches(batchId)` e `applyCrossMatches({ userId, batchId, itemIds })` da Task 2.
- Produces: `GET` devolvendo `{ ok: true, analyzed, suggestions, unmatched }`; `POST` recebendo `{ itemIds: string[] }` e devolvendo `{ ok: true, result, message }`.

- [ ] **Step 1: Implementar a rota**

Criar `apps/web/src/app/api/operacional/consignado/baixas/[batchId]/cruzamento/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { applyCrossMatches, suggestCrossMatches } from "@/server/operational/consignado-cross-match-service";

const applySchema = z.object({ itemIds: z.array(z.string().min(1)).min(1).max(2000) });

async function guard(): Promise<{ error: NextResponse | null; userId: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 }), userId: "" };
  if (!(await hasPermission("operational.finance.manage"))) return { error: NextResponse.json({ ok: false, message: "Sem permissão." }, { status: 403 }), userId: "" };
  return { error: null, userId: session.user.id };
}

export async function GET(request: Request, { params }: { params: { batchId: string } }) {
  const access = await guard();
  if (access.error) return access.error;
  try {
    const result = await suggestCrossMatches(params.batchId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Erro ao cruzar títulos." }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: { params: { batchId: string } }) {
  const access = await guard();
  if (access.error) return access.error;
  try {
    const input = applySchema.parse(await request.json());
    const result = await applyCrossMatches({ userId: access.userId, batchId: params.batchId, itemIds: input.itemIds });
    return NextResponse.json({ ok: true, result, message: `${result.appliedItems} título(s) cruzados e liberados para a remessa.` });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Erro ao aplicar o cruzamento." }, { status: 400 });
  }
}
```

- [ ] **Step 2: Conferir tipagem**

Run: `cd apps/web && npm run typecheck`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/operacional/consignado/baixas/
git commit -m "feat: rota de cruzamento de titulos nao encontrados"
```

---

### Task 4: Painel da aba "Não encontrados no estoque"

**Files:**
- Create: `apps/web/src/features/operational/components/ConsignadoCrossMatchPanel.tsx`
- Modify: `apps/web/src/features/operational/components/ConsignadoSettlementPanel.tsx` (bloco `activeFilter === "NOT_FOUND"`)

**Interfaces:**
- Consumes: `GET`/`POST` de `/api/operacional/consignado/baixas/[batchId]/cruzamento` da Task 3.
- Produces: `ConsignadoCrossMatchPanel({ batchId, items, canManage, renderItem, onApplied })`, onde `items` é a lista de itens `NOT_FOUND` já filtrada pelo painel de baixas, `renderItem: (itemId: string) => ReactNode` reaproveita o `renderIssueItem` existente e `onApplied: () => Promise<void>` recarrega o workspace.

- [ ] **Step 1: Implementar o painel**

Criar `apps/web/src/features/operational/components/ConsignadoCrossMatchPanel.tsx`:

```tsx
"use client";

import { useState, type ReactNode } from "react";
import { Loader2, Sparkles } from "lucide-react";

type Group = "FULL_KEY" | "OLDEST_NEXT_MONTH" | "OLDEST_WIDE_GAP";
type Suggestion = {
  itemId: string; group: Group; matchedOn: string[]; fileDueDate: string | null; stockDueDate: string | null;
  item: { sourceRow: number; contractNumber: string | null; debtorName: string | null; debtorDocument: string | null; titleAmount: string; paidAmount: string };
  position: { id: string; yourNumber: string | null; documentNumber: string | null; debtorName: string; debtorDocument: string; nominalValue: string; dueDate: string | null };
};
type Unmatched = { itemId: string; sourceRow: number; debtorName: string | null; debtorDocument: string | null; titleAmount: string; paidAmount: string };
type Result = { analyzed: number; suggestions: Suggestion[]; unmatched: Unmatched[] };

const groupLabel: Record<Group, string> = {
  FULL_KEY: "Chave completa",
  OLDEST_NEXT_MONTH: "Parcela mais antiga (um mês)",
  OLDEST_WIDE_GAP: "Parcela mais antiga (intervalo maior)",
};
const groupHint: Record<Group, string> = {
  FULL_KEY: "Sacado, valor e vencimento idênticos ao título do estoque.",
  OLDEST_NEXT_MONTH: "Sem vencimento igual no estoque. Indicada a parcela em aberto mais antiga, que vence um mês depois.",
  OLDEST_WIDE_GAP: "Sem vencimento igual no estoque e o intervalo não é de um mês. Revise um a um antes de aceitar.",
};
const groupOrder: Group[] = ["FULL_KEY", "OLDEST_NEXT_MONTH", "OLDEST_WIDE_GAP"];
const bulkGroups = new Set<Group>(["FULL_KEY", "OLDEST_NEXT_MONTH"]);

function money(value: string | number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value)); }
function day(value: string | null) { return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`)) : "—"; }
function paidTotal(entries: Array<{ item?: { paidAmount: string }; paidAmount?: string }>) {
  return entries.reduce((sum, entry) => sum + Number(entry.item?.paidAmount ?? entry.paidAmount ?? 0), 0);
}

export function ConsignadoCrossMatchPanel({ batchId, canManage, renderItem, onApplied }: {
  batchId: string;
  canManage: boolean;
  renderItem: (itemId: string) => ReactNode;
  onApplied: () => Promise<void>;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function run() {
    setPending(true); setFeedback("");
    try {
      const response = await fetch(`/api/operacional/consignado/baixas/${batchId}/cruzamento`, { cache: "no-store" });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.message);
      setResult({ analyzed: payload.analyzed, suggestions: payload.suggestions, unmatched: payload.unmatched });
      setFeedback(`${payload.analyzed} títulos analisados · ${payload.suggestions.length} com sugestão.`);
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Erro ao cruzar títulos."); }
    finally { setPending(false); }
  }

  async function apply(itemIds: string[], label: string) {
    if (!window.confirm(`Aceitar ${itemIds.length} sugestão(ões) de ${label}? Os títulos serão baixados contra os títulos indicados.`)) return;
    setPending(true); setFeedback("");
    try {
      const response = await fetch(`/api/operacional/consignado/baixas/${batchId}/cruzamento`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemIds }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.message);
      setFeedback(payload.message);
      setResult(null);
      await onApplied();
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Erro ao aplicar o cruzamento."); }
    finally { setPending(false); }
  }

  return <div className="mt-4 space-y-4">
    {canManage ? <div className="flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-white p-3">
      <button className="inline-flex h-9 items-center gap-2 rounded bg-primary px-3 text-sm font-semibold text-white disabled:opacity-60" disabled={pending} onClick={() => void run()} type="button">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Cruzar títulos com IA
      </button>
      <p className="text-xs text-slate-500">Procura o título no estoque por sacado, valor nominal e vencimento quando o &quot;seu número&quot; do arquivo não bate.</p>
      {feedback ? <p className="w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{feedback}</p> : null}
    </div> : null}

    {result ? groupOrder.flatMap((group) => {
      const entries = result.suggestions.filter((suggestion) => suggestion.group === group);
      if (!entries.length) return [];
      return [<section className="rounded border border-emerald-200 bg-emerald-50/40 p-4" key={group}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="font-semibold text-emerald-900">{groupLabel[group]} ({entries.length} · {money(paidTotal(entries))})</h4>
            <p className="mt-1 text-sm text-emerald-800">{groupHint[group]}</p>
          </div>
          {canManage && bulkGroups.has(group) ? <button className="rounded bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={pending} onClick={() => void apply(entries.map((entry) => entry.itemId), groupLabel[group].toLowerCase())} type="button">Aceitar as {entries.length} sugestões</button> : null}
        </div>
        <div className="mt-3 space-y-3">{entries.map((entry) => <div className="rounded border border-emerald-200 bg-white p-3" key={entry.itemId}>
          <div className="flex flex-wrap items-start justify-between gap-3 text-sm">
            <div>
              <p className="font-semibold text-slate-900">{entry.item.debtorName ?? "Sacado não informado"}</p>
              <p className="text-xs text-slate-500">linha {entry.item.sourceRow} · contrato {entry.item.contractNumber ?? "—"} · arquivo vence {day(entry.fileDueDate)} · {money(entry.item.paidAmount)}</p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-emerald-900">Título {entry.position.yourNumber ?? entry.position.id}{entry.position.documentNumber ? ` · parcela ${entry.position.documentNumber}` : ""}</p>
              <p className="text-xs text-emerald-800">estoque vence {day(entry.position.dueDate)} · {money(entry.position.nominalValue)} · {entry.position.debtorDocument}</p>
            </div>
          </div>
          {canManage ? <div className="mt-2 flex justify-end">
            <button className="h-8 rounded border border-primary px-3 text-xs font-semibold text-primary disabled:opacity-60" disabled={pending} onClick={() => void apply([entry.itemId], "título individual")} type="button">Aceitar este</button>
          </div> : null}
          <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold text-slate-600">Ver o título original e pesquisar manualmente</summary><div className="mt-2">{renderItem(entry.itemId)}</div></details>
        </div>)}</div>
      </section>];
    }) : null}

    {result?.unmatched.length ? <section className="rounded border border-slate-200 bg-white p-4">
      <h4 className="font-semibold text-slate-900">Sem sugestão ({result.unmatched.length} · {money(paidTotal(result.unmatched))})</h4>
      <p className="mt-1 text-sm text-slate-500">Nenhum título do estoque bate sacado e valor. Seguem como não encontrados.</p>
      <div className="mt-3 space-y-3">{result.unmatched.map((entry) => <div key={entry.itemId}>{renderItem(entry.itemId)}</div>)}</div>
    </section> : null}
  </div>;
}
```

- [ ] **Step 2: Ligar o painel na aba**

Em `apps/web/src/features/operational/components/ConsignadoSettlementPanel.tsx`:

1. Acrescentar o import no topo, junto aos demais:

```tsx
import { ConsignadoCrossMatchPanel } from "./ConsignadoCrossMatchPanel";
```

2. Substituir a linha que renderiza a aba `NOT_FOUND`:

```tsx
{activeFilter === "NOT_FOUND" ? <div className="mt-4 space-y-3">{notFoundItems.length ? notFoundItems.map((item) => renderIssueItem(batch, item)) : <p className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-500">Nenhum título não encontrado.</p>}</div> : null}
```

por:

```tsx
{activeFilter === "NOT_FOUND" ? (notFoundItems.length ? <ConsignadoCrossMatchPanel batchId={batch.id} canManage={canManage} onApplied={() => refresh()} renderItem={(itemId) => { const found = notFoundItems.find((entry) => entry.id === itemId); return found ? renderIssueItem(batch, found) : null; }} /> : <p className="mt-4 rounded border border-slate-200 bg-white p-4 text-sm text-slate-500">Nenhum título não encontrado.</p>) : null}
```

- [ ] **Step 3: Conferir tipagem e lint**

Run: `cd apps/web && npm run typecheck && npm run lint`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/operational/components/
git commit -m "feat: painel de cruzamento na aba de titulos nao encontrados"
```

---

### Task 5: Documentação e verificação final

**Files:**
- Modify: `docs/TASKS.md` (mover a task para Concluídas)
- Modify: `CLAUDE.md` (seção "Atualizacoes recentes")
- Modify: `docs/OPERACIONAL-CONSIGNADO.md` (documentar o cruzamento no fluxo de baixas)

**Interfaces:**
- Consumes: tudo das Tasks 1 a 4.
- Produces: nenhuma interface de código.

- [ ] **Step 1: Documentar o fluxo**

Em `docs/OPERACIONAL-CONSIGNADO.md`, acrescentar ao final da seção que descreve o fluxo de baixas:

```markdown
### Cruzamento de títulos não encontrados

Quando o "seu número" do arquivo não existe no estoque, o título é classificado como `NOT_FOUND` e vai para a aba "Não encontrados no estoque". O botão **Cruzar títulos com IA** procura o título por chaves alternativas: mesmo sacado (CPF quando os dois lados têm documento, nome normalizado quando falta), mesmo valor nominal com tolerância de um centavo, e vencimento. Nada é gravado nessa etapa.

As sugestões saem em três grupos:

- **Chave completa** — sacado, valor e vencimento idênticos. Aceita aprovação em lote.
- **Parcela mais antiga (um mês)** — não existe vencimento igual no estoque; é indicada a parcela em aberto mais antiga, que vence exatamente um mês depois. Caso típico de pagamento atrasado cuja parcela já saiu do estoque. Aceita aprovação em lote.
- **Parcela mais antiga (intervalo maior)** — mesma regra, mas o intervalo não é de um mês. Só aceita aprovação individual.

Cada posição do estoque é alocada a um único item, e posições já aprovadas no lote ou presentes em remessa não cancelada nunca são sugeridas. Ao aceitar, o item vira `MANUALLY_MATCHED` com justificativa automática em `ConsignadoManualCorrection` e um `ConsignadoStatusEvent` guardando grupo, campos casados e os dois vencimentos.

A aplicação recalcula as sugestões no servidor e só aceita `itemIds` do cliente, nunca o título de destino.
```

- [ ] **Step 2: Atualizar o quadro da equipe**

Em `docs/TASKS.md`, acrescentar em "Concluídas (recentes)" a linha:

```markdown
- [x] **[2026-08-26] Cruzamento de títulos não encontrados (Consignado)** — motor puro de cruzamento por sacado + valor nominal + vencimento com alocação um-para-um, sugestões em três grupos (chave completa, parcela mais antiga a um mês, parcela mais antiga com intervalo maior), aceite em lote nos dois primeiros e revisão individual no terceiro. Diagnóstico registrado: o estoque grava CPF formatado e o arquivo de baixa grava só dígitos, então a cláusula `contains` do `loadCandidates` nunca casava. Sem migration — o item aceito vira `MANUALLY_MATCHED` com justificativa automática e `ConsignadoStatusEvent` auditável — _Juan_ · branch `feat/cruzamento-titulos-nao-encontrados`.
```

- [ ] **Step 3: Atualizar o CLAUDE.md**

Em `CLAUDE.md`, na seção "Atualizacoes recentes", acrescentar:

```markdown
- [2026-08-26] Cruzamento de títulos não encontrados nas baixas do Consignado: `consignado-cross-match.ts` (motor puro) + `consignado-cross-match-service.ts` + rota `baixas/[batchId]/cruzamento`. ATENÇÃO: o estoque grava `debtor_document` formatado (`NNN.NNN.NNN-NN`) e o parser de baixas grava só dígitos — qualquer comparação de CPF entre as duas bases precisa normalizar os dois lados.
```

- [ ] **Step 4: Rodar a verificação completa**

Run: `cd apps/web && npm run test:operational && npm run typecheck && npm run lint`
Expected: PASS nos três.

- [ ] **Step 5: Commit**

```bash
git add docs/ CLAUDE.md
git commit -m "docs: registra o cruzamento de titulos nao encontrados"
```
