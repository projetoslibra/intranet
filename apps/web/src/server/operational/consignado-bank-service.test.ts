import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

type EntryRow = {
  id: string;
  fundId: string;
  amount: Prisma.Decimal;
  allocatedAmount: Prisma.Decimal;
  adjustedAmount: Prisma.Decimal;
  status: string;
  transactionDate: Date;
  createdAt: Date;
};

type BatchRow = { id: string; status: string; fileName: string };
type RemittanceRow = {
  id: string;
  fundId: string;
  batchId: string;
  totalAmount: Prisma.Decimal;
  allocatedAmount: Prisma.Decimal;
  adjustedAmount: Prisma.Decimal;
  status: string;
  generatedAt: Date;
  fileName: string;
};
type ExclusionRow = {
  id: string;
  remittanceId: string;
  paidAmount: Prisma.Decimal;
  titleAmount: Prisma.Decimal;
  createdAt: Date;
  settlementItem: Record<string, unknown>;
};
type ReconciliationRow = {
  id: string;
  createdByUserId: string;
  undoneByUserId: string | null;
  status: string;
  totalAmount: Prisma.Decimal;
  entryTotalAmount: Prisma.Decimal;
  remittanceTotalAmount: Prisma.Decimal;
  differenceAmount: Prisma.Decimal;
  differenceReason: string | null;
  note: string | null;
  createdAt: Date;
  undoneAt: Date | null;
};
type AllocationRow = { reconciliationId: string; bankEntryId: string; remittanceId: string; amount: Prisma.Decimal };
type AdjustmentRow = { reconciliationId: string; bankEntryId?: string; remittanceId?: string; amount: Prisma.Decimal };
type DifferenceTitleRow = { reconciliationId: string; remittanceExclusionId: string; amount: Prisma.Decimal };
type OtherDifferenceRow = {
  id: string;
  reconciliationId: string;
  createdByUserId: string;
  category: string;
  direction: string;
  amount: Prisma.Decimal;
  reason: string;
  status: string;
  cancelledAt: Date | null;
};
type EventRow = {
  userId: string | null;
  entityType: string;
  entityId: string;
  fromStatus?: string;
  toStatus: string;
  metadata?: Record<string, unknown>;
};

type MemoryState = {
  funds: Array<{ id: string; cnpj: string; name: string; status: string }>;
  entries: EntryRow[];
  batches: BatchRow[];
  remittances: RemittanceRow[];
  exclusions: ExclusionRow[];
  reconciliations: ReconciliationRow[];
  allocations: AllocationRow[];
  adjustments: AdjustmentRow[];
  differenceTitles: DifferenceTitleRow[];
  otherDifferences: OtherDifferenceRow[];
  events: EventRow[];
};

type QueryArgs = {
  where?: {
    id?: string | { in?: string[] };
    reconciliationId?: string;
    status?: string | { in?: string[]; not?: string };
    fundId?: string;
    transactionDate?: Date;
    batch?: { status?: { not?: string } };
  };
  data?: Record<string, unknown>;
  include?: Record<string, unknown>;
  select?: Record<string, unknown>;
  orderBy?: unknown;
  take?: number;
};

function cloneValue<T>(value: T): T {
  if (value instanceof Prisma.Decimal) return new Prisma.Decimal(value) as T;
  if (value instanceof Date) return new Date(value) as T;
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)])) as T;
  }
  return value;
}

function decimal(value: unknown) {
  return new Prisma.Decimal(String(value));
}

function idsFrom(args: QueryArgs) {
  const id = args.where?.id;
  return typeof id === "object" ? id.in : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

class MemoryBankDatabase {
  state: MemoryState;
  lastIsolationLevel: unknown;
  failOnEvent = false;
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(state: MemoryState) {
    this.state = cloneValue(state);
  }

  fund = {
    findMany: async () => cloneValue(this.state.funds.filter((item) => item.status === "ACTIVE")),
  };

  consignadoBankCreditEntry = {
    findMany: async (args: QueryArgs) => {
      const ids = idsFrom(args);
      const status = record(args.where?.status);
      return cloneValue(this.state.entries.filter((item) => (
        (!ids || ids.includes(item.id))
        && (!args.where?.fundId || item.fundId === args.where.fundId)
        && (!status?.not || item.status !== status.not)
        && (!args.where?.transactionDate || item.transactionDate.getTime() === args.where.transactionDate.getTime())
      )));
    },
    update: async (args: QueryArgs) => {
      const row = this.state.entries.find((item) => item.id === args.where?.id);
      if (!row) throw new Error("Entrada não encontrada no store em memória.");
      Object.assign(row, args.data);
      return cloneValue(row);
    },
    aggregate: async (args: QueryArgs) => {
      const rows = await this.consignadoBankCreditEntry.findMany(args);
      return {
        _count: { _all: rows.length },
        _sum: {
          amount: rows.reduce((sum, item) => sum.add(item.amount), decimal(0)),
          allocatedAmount: rows.reduce((sum, item) => sum.add(item.allocatedAmount), decimal(0)),
          adjustedAmount: rows.reduce((sum, item) => sum.add(item.adjustedAmount), decimal(0)),
        },
      };
    },
  };

  consignadoRemittance = {
    findMany: async (args: QueryArgs) => {
      const ids = idsFrom(args);
      const statuses = record(args.where?.status)?.in as string[] | undefined;
      const exclusionsInclude = record(args.include?.exclusions);
      const exclusionsWhere = record(exclusionsInclude?.where);
      const differenceTitlesFilter = record(exclusionsWhere?.differenceTitles);
      const noneFilter = record(differenceTitlesFilter?.none);
      return cloneValue(this.state.remittances
        .filter((item) => (
          (!ids || ids.includes(item.id))
          && (!args.where?.fundId || item.fundId === args.where.fundId)
          && (!statuses || statuses.includes(item.status))
          && (!args.where?.batch?.status?.not || this.state.batches.some((batch) => (
            batch.id === item.batchId && batch.status !== args.where?.batch?.status?.not
          )))
        ))
        .map((item) => ({
          ...item,
          batch: this.state.batches.find((batch) => batch.id === item.batchId),
          ...(exclusionsInclude ? {
            exclusions: this.state.exclusions
              .filter((exclusion) => exclusion.remittanceId === item.id)
              .filter((exclusion) => {
                if (!noneFilter) return true;
                return !this.state.differenceTitles.some((title) => (
                  title.remittanceExclusionId === exclusion.id
                  && this.state.reconciliations.some((reconciliation) => (
                    reconciliation.id === title.reconciliationId && reconciliation.status === "ACTIVE"
                  ))
                ));
              })
              .map((exclusion) => ({ ...exclusion, settlementItem: exclusion.settlementItem })),
          } : {}),
        })));
    },
    update: async (args: QueryArgs) => {
      const row = this.state.remittances.find((item) => item.id === args.where?.id);
      if (!row) throw new Error("Remessa não encontrada no store em memória.");
      Object.assign(row, args.data);
      return cloneValue(row);
    },
  };

  consignadoRemittanceExclusion = {
    findMany: async (args: QueryArgs) => {
      const ids = idsFrom(args);
      return cloneValue(this.state.exclusions
        .filter((item) => !ids || ids.includes(item.id))
        .map((item) => {
          const remittance = this.state.remittances.find((candidate) => candidate.id === item.remittanceId);
          if (!remittance) throw new Error("Remessa da exclusão não encontrada.");
          const batch = this.state.batches.find((candidate) => candidate.id === remittance.batchId);
          return {
            ...item,
            remittance: { fundId: remittance.fundId, status: remittance.status, batch },
            differenceTitles: this.state.differenceTitles
              .filter((title) => title.remittanceExclusionId === item.id)
              .filter((title) => this.state.reconciliations.some((reconciliation) => (
                reconciliation.id === title.reconciliationId && reconciliation.status === "ACTIVE"
              )))
              .map((title) => ({ reconciliationId: title.reconciliationId })),
          };
        }));
    },
  };

  consignadoBankReconciliation = {
    create: async (args: QueryArgs) => {
      const data = args.data ?? {};
      const row: ReconciliationRow = {
        id: `reconciliation-${this.state.reconciliations.length + 1}`,
        createdByUserId: String(data.createdByUserId),
        undoneByUserId: null,
        status: "ACTIVE",
        totalAmount: decimal(data.totalAmount),
        entryTotalAmount: decimal(data.entryTotalAmount),
        remittanceTotalAmount: decimal(data.remittanceTotalAmount),
        differenceAmount: decimal(data.differenceAmount),
        differenceReason: data.differenceReason ? String(data.differenceReason) : null,
        note: data.note ? String(data.note) : null,
        createdAt: new Date("2026-08-20T12:00:00.000Z"),
        undoneAt: null,
      };
      this.state.reconciliations.push(row);
      return cloneValue(row);
    },
    findFirstOrThrow: async (args: QueryArgs) => {
      const row = this.state.reconciliations.find((item) => (
        item.id === args.where?.id && (!args.where?.status || item.status === args.where.status)
      ));
      if (!row) throw new Error("Conciliação ativa não encontrada.");
      return cloneValue({
        ...row,
        ...(args.include?.allocations ? {
          allocations: this.state.allocations.filter((item) => item.reconciliationId === row.id),
        } : {}),
        ...(args.include?.adjustments ? {
          adjustments: this.state.adjustments.filter((item) => item.reconciliationId === row.id),
        } : {}),
        ...(args.include?.differenceTitles ? {
          differenceTitles: this.state.differenceTitles.filter((item) => item.reconciliationId === row.id),
        } : {}),
        ...(args.include?.otherDifferences ? {
          otherDifferences: this.state.otherDifferences.filter((item) => item.reconciliationId === row.id),
        } : {}),
      });
    },
    findMany: async (args: QueryArgs) => cloneValue(this.state.reconciliations.map((row) => {
      const differenceTitlesInclude = record(args.include?.differenceTitles);
      const otherDifferencesInclude = record(args.include?.otherDifferences);
      return {
        ...row,
        ...(args.include?.createdBy ? { createdBy: { name: "Operador" } } : {}),
        ...(args.include?.undoneBy ? { undoneBy: row.undoneByUserId ? { name: "Operador" } : null } : {}),
        ...(args.include?.allocations ? {
          allocations: this.state.allocations.filter((item) => item.reconciliationId === row.id),
        } : {}),
        ...(args.include?.adjustments ? {
          adjustments: this.state.adjustments.filter((item) => item.reconciliationId === row.id),
        } : {}),
        ...(differenceTitlesInclude ? {
          differenceTitles: this.state.differenceTitles
            .filter((item) => item.reconciliationId === row.id)
            .map((item) => {
              const exclusion = this.state.exclusions.find((candidate) => candidate.id === item.remittanceExclusionId);
              const remittance = exclusion
                ? this.state.remittances.find((candidate) => candidate.id === exclusion.remittanceId)
                : undefined;
              const batch = remittance
                ? this.state.batches.find((candidate) => candidate.id === remittance.batchId)
                : undefined;
              return {
                ...item,
                remittanceExclusion: exclusion ? {
                  ...exclusion,
                  settlementItem: exclusion.settlementItem,
                  remittance: remittance ? { id: remittance.id, fileName: remittance.fileName, batch } : null,
                } : null,
              };
            }),
        } : {}),
        ...(otherDifferencesInclude ? {
          otherDifferences: this.state.otherDifferences
            .filter((item) => item.reconciliationId === row.id)
            .map((item) => ({ ...item, createdBy: { name: "Operador" }, resolvedBy: null })),
        } : {}),
      };
    })),
    update: async (args: QueryArgs) => {
      const row = this.state.reconciliations.find((item) => item.id === args.where?.id);
      if (!row) throw new Error("Conciliação não encontrada no store em memória.");
      Object.assign(row, args.data);
      return cloneValue(row);
    },
  };

  consignadoBankAllocation = {
    createMany: async (args: { data: Array<Record<string, unknown>> }) => {
      this.state.allocations.push(...args.data.map((item) => ({
        reconciliationId: String(item.reconciliationId),
        bankEntryId: String(item.bankEntryId),
        remittanceId: String(item.remittanceId),
        amount: decimal(item.amount),
      })));
      return { count: args.data.length };
    },
  };

  consignadoBankDifferenceTitle = {
    createMany: async (args: { data: Array<Record<string, unknown>> }) => {
      this.state.differenceTitles.push(...args.data.map((item) => ({
        reconciliationId: String(item.reconciliationId),
        remittanceExclusionId: String(item.remittanceExclusionId),
        amount: decimal(item.amount),
      })));
      return { count: args.data.length };
    },
  };

  consignadoBankOtherDifference = {
    createMany: async (args: { data: Array<Record<string, unknown>> }) => {
      this.state.otherDifferences.push(...args.data.map((item) => ({
        id: String(item.id),
        reconciliationId: String(item.reconciliationId),
        createdByUserId: String(item.createdByUserId),
        category: String(item.category),
        direction: String(item.direction),
        amount: decimal(item.amount),
        reason: String(item.reason),
        status: "OPEN",
        cancelledAt: null,
      })));
      return { count: args.data.length };
    },
    updateMany: async (args: QueryArgs) => {
      const rows = this.state.otherDifferences.filter((item) => item.reconciliationId === args.where?.reconciliationId);
      rows.forEach((row) => Object.assign(row, args.data));
      return { count: rows.length };
    },
  };

  consignadoBankAdjustment = {
    createMany: async (args: { data: Array<Record<string, unknown>> }) => {
      this.state.adjustments.push(...args.data.map((item) => ({
        reconciliationId: String(item.reconciliationId),
        ...(item.bankEntryId ? { bankEntryId: String(item.bankEntryId) } : {}),
        ...(item.remittanceId ? { remittanceId: String(item.remittanceId) } : {}),
        amount: decimal(item.amount),
      })));
      return { count: args.data.length };
    },
  };

  consignadoSettlementBatch = {
    update: async (args: QueryArgs) => {
      const row = this.state.batches.find((item) => item.id === args.where?.id);
      if (!row) throw new Error("Lote não encontrado no store em memória.");
      Object.assign(row, args.data);
      return cloneValue(row);
    },
  };

  consignadoStatusEvent = {
    create: async (args: QueryArgs) => {
      if (this.failOnEvent) throw new Error("falha de auditoria");
      const data = args.data ?? {};
      const row: EventRow = {
        userId: data.userId ? String(data.userId) : null,
        entityType: String(data.entityType),
        entityId: String(data.entityId),
        ...(data.fromStatus ? { fromStatus: String(data.fromStatus) } : {}),
        toStatus: String(data.toStatus),
        ...(data.metadata ? { metadata: cloneValue(data.metadata as Record<string, unknown>) } : {}),
      };
      this.state.events.push(row);
      return cloneValue(row);
    },
  };

  consignadoBankStatementImport = {
    findMany: async () => [],
  };

  async $transaction<T>(
    callback: (transaction: unknown) => Promise<T>,
    options?: { isolationLevel?: unknown },
  ): Promise<T> {
    let resolveQueue!: () => void;
    const queued = new Promise<void>((resolve) => { resolveQueue = resolve; });
    const previous = this.transactionTail;
    this.transactionTail = queued;
    await previous;
    this.lastIsolationLevel = options?.isolationLevel;
    const transaction = new MemoryBankDatabase(this.state);
    transaction.failOnEvent = this.failOnEvent;
    try {
      const result = await callback(transaction);
      this.state = transaction.state;
      return result;
    } finally {
      resolveQueue();
    }
  }
}

function seedState(): MemoryState {
  const date = new Date("2026-08-20T00:00:00.000Z");
  return {
    funds: [{ id: "fund-1", cnpj: "54842157000193", name: "Consignado", status: "ACTIVE" }],
    entries: [{
      id: "entry-1",
      fundId: "fund-1",
      amount: decimal("100.00"),
      allocatedAmount: decimal("0"),
      adjustedAmount: decimal("0"),
      status: "PENDING",
      transactionDate: date,
      createdAt: date,
    }],
    batches: [{ id: "batch-1", status: "GENERATED", fileName: "batch.csv" }],
    remittances: [{
      id: "remittance-1",
      fundId: "fund-1",
      batchId: "batch-1",
      totalAmount: decimal("90.00"),
      allocatedAmount: decimal("0"),
      adjustedAmount: decimal("0"),
      status: "GENERATED",
      generatedAt: date,
      fileName: "remittance.rem",
    }],
    exclusions: [{
      id: "exclusion-1",
      remittanceId: "remittance-1",
      paidAmount: decimal("7.00"),
      titleAmount: decimal("8.00"),
      createdAt: date,
      settlementItem: { id: "item-1", contractNumber: "contract-1" },
    }],
    reconciliations: [],
    allocations: [],
    adjustments: [],
    differenceTitles: [],
    otherDifferences: [],
    events: [],
  };
}

const input = {
  userId: "user-1",
  entryIds: ["entry-1"],
  remittanceIds: ["remittance-1"],
  exclusionIds: ["exclusion-1"],
  otherDifferences: [{
    category: "VALUE_DIFFERENCE" as const,
    amount: "3.00",
    reason: "Crédito complementar",
  }],
};

type CreateWithDependencies = (
  payload: typeof input,
  dependencies: { database: unknown; createId: () => string },
) => Promise<{ id: string }>;

async function createWithDependencies() {
  const service = await import("./consignado-bank-service");
  const operation = (service as unknown as {
    createBankReconciliationWithDependencies?: CreateWithDependencies;
  }).createBankReconciliationWithDependencies;
  assert.ok(operation, "createBankReconciliationWithDependencies ainda não foi implementada");
  return operation;
}

test("cria a conciliação com snapshots do tx, vínculos, Outros identificados e auditoria", async () => {
  const database = new MemoryBankDatabase(seedState());
  const create = await createWithDependencies();

  const result = await create(input, { database, createId: () => "other-1" });

  assert.equal(result.id, "reconciliation-1");
  assert.equal(database.lastIsolationLevel, Prisma.TransactionIsolationLevel.Serializable);
  assert.deepEqual(database.state.allocations.map((item) => ({
    entryId: item.bankEntryId,
    remittanceId: item.remittanceId,
    amount: item.amount.toFixed(2),
  })), [{ entryId: "entry-1", remittanceId: "remittance-1", amount: "90.00" }]);
  assert.deepEqual(database.state.differenceTitles.map((item) => ({
    exclusionId: item.remittanceExclusionId,
    amount: item.amount.toFixed(2),
  })), [{ exclusionId: "exclusion-1", amount: "7.00" }]);
  assert.deepEqual(database.state.otherDifferences.map((item) => ({
    id: item.id,
    amount: item.amount.toFixed(2),
    direction: item.direction,
    status: item.status,
  })), [{ id: "other-1", amount: "3.00", direction: "ENTRY_EXCESS", status: "OPEN" }]);
  assert.deepEqual(database.state.events[0]?.metadata, {
    allocatedTotal: "90",
    entryTotal: "100",
    remittanceTotal: "90",
    signedDifference: "10",
    difference: "10",
    direction: "ENTRY_EXCESS",
    titleDifferenceTotal: "7",
    otherDifferenceTotal: "3",
    differenceReason: "1 título(s) fora da remessa: 7.00; 1 outro(s) ajuste(s): 3.00",
    entryIds: ["entry-1"],
    remittanceIds: ["remittance-1"],
    exclusionIds: ["exclusion-1"],
    otherDifferenceIds: ["other-1"],
  });
});

test("reverte toda a transação quando a auditoria falha", async () => {
  const database = new MemoryBankDatabase(seedState());
  database.failOnEvent = true;
  const before = JSON.stringify(database.state);
  const create = await createWithDependencies();

  await assert.rejects(
    create(input, { database, createId: () => "other-rollback" }),
    /falha de auditoria/,
  );

  assert.equal(JSON.stringify(database.state), before);
});

test("revalida uso ativo em tentativas concorrentes serializadas", async () => {
  const database = new MemoryBankDatabase(seedState());
  const create = await createWithDependencies();

  const attempts = await Promise.allSettled([
    create(input, { database, createId: () => "other-a" }),
    create(input, { database, createId: () => "other-b" }),
  ]);

  assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((item) => item.status === "rejected").length, 1);
  assert.equal(database.state.reconciliations.length, 1);
  assert.equal(database.state.differenceTitles.length, 1);
  assert.equal(database.state.otherDifferences.length, 1);
});

function nToNState(): MemoryState {
  const state = seedState();
  const date = new Date("2026-08-20T00:00:00.000Z");
  state.entries = [
    { ...state.entries[0], id: "entry-1", amount: decimal("70.00") },
    { ...state.entries[0], id: "entry-2", amount: decimal("50.00") },
  ];
  state.batches = [
    { id: "batch-1", status: "GENERATED", fileName: "batch-1.csv" },
    { id: "batch-2", status: "GENERATED", fileName: "batch-2.csv" },
    { id: "batch-locked", status: "GENERATED", fileName: "batch-locked.csv" },
  ];
  state.remittances = [
    { ...state.remittances[0], id: "remittance-1", batchId: "batch-1", totalAmount: decimal("40.00") },
    { ...state.remittances[0], id: "remittance-2", batchId: "batch-2", totalAmount: decimal("60.00") },
    { ...state.remittances[0], id: "remittance-locked", batchId: "batch-locked", totalAmount: decimal("1.00") },
  ];
  state.exclusions = [
    { ...state.exclusions[0], id: "exclusion-1", paidAmount: decimal("10.00") },
    {
      ...state.exclusions[0],
      id: "exclusion-locked",
      remittanceId: "remittance-locked",
      paidAmount: decimal("1.00"),
      settlementItem: { id: "item-locked", contractNumber: "contract-locked" },
    },
  ];
  state.reconciliations = [{
    id: "reconciliation-locked",
    createdByUserId: "user-1",
    undoneByUserId: null,
    status: "ACTIVE",
    totalAmount: decimal("0"),
    entryTotalAmount: decimal("1"),
    remittanceTotalAmount: decimal("0"),
    differenceAmount: decimal("1"),
    differenceReason: "1 título",
    note: null,
    createdAt: date,
    undoneAt: null,
  }];
  state.differenceTitles = [{
    reconciliationId: "reconciliation-locked",
    remittanceExclusionId: "exclusion-locked",
    amount: decimal("1.00"),
  }];
  state.otherDifferences = [{
    id: "other-locked",
    reconciliationId: "reconciliation-locked",
    createdByUserId: "user-1",
    category: "OTHER",
    direction: "ENTRY_EXCESS",
    amount: decimal("1.00"),
    reason: "Ajuste histórico",
    status: "OPEN",
    cancelledAt: null,
  }];
  return state;
}

const nToNInput = {
  userId: "user-1",
  entryIds: ["entry-1", "entry-2"],
  remittanceIds: ["remittance-1", "remittance-2"],
  exclusionIds: ["exclusion-1"],
  otherDifferences: [{
    category: "VALUE_DIFFERENCE" as const,
    amount: "10.00",
    reason: "Crédito complementar",
  }],
};

type UndoWithDependencies = (
  reconciliationId: string,
  userId: string,
  dependencies: { database: unknown; now: () => Date },
) => Promise<void>;

type WorkspaceWithDependencies = (
  input: { transactionDate?: string },
  dependencies: { database: unknown },
) => Promise<{
  remittances: Array<{ id: string; exclusions: Array<{ id: string }> }>;
  reconciliations: Array<{
    id: string;
    status: string;
    undoneAt: string | null;
    differenceTitles: Array<{
      remittanceExclusionId: string;
      remittanceExclusion: {
        settlementItem: { contractNumber: string };
        remittance: { fileName: string; batch: { fileName: string } };
      };
    }>;
    otherDifferences: Array<{ id: string; status: string; cancelledAt: string | null }>;
  }>;
}>;

async function undoWithDependencies() {
  const service = await import("./consignado-bank-service");
  const operation = (service as unknown as {
    undoBankReconciliationWithDependencies?: UndoWithDependencies;
  }).undoBankReconciliationWithDependencies;
  assert.ok(operation, "undoBankReconciliationWithDependencies ainda não foi implementada");
  return operation;
}

async function workspaceWithDependencies() {
  const service = await import("./consignado-bank-service");
  const operation = (service as unknown as {
    getBankReconciliationWorkspaceWithDependencies?: WorkspaceWithDependencies;
  }).getBankReconciliationWorkspaceWithDependencies;
  assert.ok(operation, "getBankReconciliationWorkspaceWithDependencies ainda não foi implementada");
  return operation;
}

test("workspace oculta exclusão em uso ativo e retorna o histórico detalhado", async () => {
  const database = new MemoryBankDatabase(nToNState());
  const workspace = await workspaceWithDependencies();

  const result = await workspace({}, { database });

  const lockedRemittance = result.remittances.find((item) => item.id === "remittance-locked");
  assert.deepEqual(lockedRemittance?.exclusions, []);
  const history = result.reconciliations.find((item) => item.id === "reconciliation-locked");
  assert.equal(history?.differenceTitles[0]?.remittanceExclusion.settlementItem.contractNumber, "contract-locked");
  assert.equal(history?.differenceTitles[0]?.remittanceExclusion.remittance.fileName, "remittance.rem");
  assert.equal(history?.differenceTitles[0]?.remittanceExclusion.remittance.batch.fileName, "batch-locked.csv");
  assert.deepEqual(history?.otherDifferences.map((item) => ({ id: item.id, status: item.status })), [
    { id: "other-locked", status: "OPEN" },
  ]);
});

test("undo restaura N:N, cancela Outros no mesmo instante e libera o título sem apagar histórico", async () => {
  const database = new MemoryBankDatabase(nToNState());
  const create = await createWithDependencies();
  const undo = await undoWithDependencies();
  const workspace = await workspaceWithDependencies();
  const undoneAt = new Date("2026-08-20T18:30:00.000Z");

  const reconciliation = await create(nToNInput, { database, createId: () => "other-n-to-n" });
  assert.deepEqual(database.state.allocations
    .filter((item) => item.reconciliationId === reconciliation.id)
    .map((item) => `${item.bankEntryId}:${item.remittanceId}:${item.amount.toFixed(2)}`), [
    "entry-1:remittance-1:40.00",
    "entry-1:remittance-2:30.00",
    "entry-2:remittance-2:30.00",
  ]);

  const beforeUndo = await workspace({}, { database });
  const activeHistory = beforeUndo.reconciliations.find((item) => item.id === reconciliation.id);
  assert.equal(activeHistory?.status, "ACTIVE");
  assert.equal(activeHistory?.differenceTitles.length, 1);
  assert.deepEqual(activeHistory?.otherDifferences.map((item) => item.id), ["other-n-to-n"]);

  await undo(reconciliation.id, "user-undo", { database, now: () => undoneAt });

  assert.deepEqual(database.state.entries.map((item) => ({
    id: item.id,
    allocated: item.allocatedAmount.toFixed(2),
    adjusted: item.adjustedAmount.toFixed(2),
    status: item.status,
  })), [
    { id: "entry-1", allocated: "0.00", adjusted: "0.00", status: "PENDING" },
    { id: "entry-2", allocated: "0.00", adjusted: "0.00", status: "PENDING" },
  ]);
  assert.deepEqual(database.state.remittances
    .filter((item) => ["remittance-1", "remittance-2"].includes(item.id))
    .map((item) => ({
      id: item.id,
      allocated: item.allocatedAmount.toFixed(2),
      adjusted: item.adjustedAmount.toFixed(2),
      status: item.status,
    })), [
    { id: "remittance-1", allocated: "0.00", adjusted: "0.00", status: "GENERATED" },
    { id: "remittance-2", allocated: "0.00", adjusted: "0.00", status: "GENERATED" },
  ]);
  assert.deepEqual(database.state.batches
    .filter((item) => ["batch-1", "batch-2"].includes(item.id))
    .map((item) => ({ id: item.id, status: item.status })), [
    { id: "batch-1", status: "GENERATED" },
    { id: "batch-2", status: "GENERATED" },
  ]);
  const other = database.state.otherDifferences.find((item) => item.id === "other-n-to-n");
  const undone = database.state.reconciliations.find((item) => item.id === reconciliation.id);
  assert.equal(other?.status, "CANCELLED");
  assert.equal(other?.cancelledAt?.getTime(), undoneAt.getTime());
  assert.equal(undone?.undoneAt?.getTime(), undoneAt.getTime());
  assert.equal(database.state.differenceTitles.some((item) => (
    item.reconciliationId === reconciliation.id && item.remittanceExclusionId === "exclusion-1"
  )), true);
  const undoEvent = database.state.events.find((item) => (
    item.entityId === reconciliation.id && item.toStatus === "UNDONE"
  ));
  assert.deepEqual(undoEvent?.metadata, {
    exclusionIds: ["exclusion-1"],
    otherDifferenceIds: ["other-n-to-n"],
  });

  const afterUndo = await workspace({}, { database });
  const releasedRemittance = afterUndo.remittances.find((item) => item.id === "remittance-1");
  const stillLockedRemittance = afterUndo.remittances.find((item) => item.id === "remittance-locked");
  assert.deepEqual(releasedRemittance?.exclusions.map((item) => item.id), ["exclusion-1"]);
  assert.deepEqual(stillLockedRemittance?.exclusions, []);
  const undoneHistory = afterUndo.reconciliations.find((item) => item.id === reconciliation.id);
  assert.equal(undoneHistory?.status, "UNDONE");
  assert.equal(undoneHistory?.differenceTitles[0]?.remittanceExclusionId, "exclusion-1");
  assert.deepEqual(undoneHistory?.otherDifferences.map((item) => ({
    id: item.id,
    status: item.status,
    cancelledAt: item.cancelledAt,
  })), [{ id: "other-n-to-n", status: "CANCELLED", cancelledAt: undoneAt.toISOString() }]);
});
