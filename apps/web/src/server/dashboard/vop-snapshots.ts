import { Prisma } from "@prisma/client";
import {
  calculateOperationIndicators,
  weightedAverageFromComponents,
  type OperationIndicatorCalculation,
} from "./operation-indicators";

export type VopFundKey = "APUAMA" | "BRISTOL";

export type SnapshotIndicatorValues = {
  operationCount: number | null;
  termWeightedValue: string | null;
  termWeightAmount: string | null;
  monthlyRateWeightedValue: string | null;
  monthlyRateWeightAmount: string | null;
  indicatorsCalculatedAt: Date | null;
};

export type NewVopSnapshot = SnapshotIndicatorValues & {
  fundId: string;
  referenceDate: Date;
  amount: string;
};

type ActiveFund = {
  id: string;
  name: string;
  shortName: string;
};

type StockPosition = {
  referenceDate: Date;
  latestCreatedAt: Date;
};

export type StockOperation = {
  acquisitionValue: string;
  termDays: number | null;
  annualAssignmentRate: string | null;
};

type StoredSnapshot = NewVopSnapshot;

export type VopSnapshotRepository = {
  listActiveFunds(): Promise<ActiveFund[]>;
  findLatestStockReferenceDate(fundKey: VopFundKey): Promise<Date | null>;
  listStockPositions(
    fundKey: VopFundKey,
    start: Date,
    end: Date
  ): Promise<StockPosition[]>;
  listExistingSnapshots(
    fundId: string,
    start: Date,
    end: Date
  ): Promise<StoredSnapshot[]>;
  listPendingSnapshots(fundId: string, limit: number): Promise<StoredSnapshot[]>;
  loadStockOperations(
    fundKey: VopFundKey,
    referenceDate: Date
  ): Promise<StockOperation[]>;
  createSnapshots(rows: NewVopSnapshot[]): Promise<void>;
  completeSnapshotIndicatorsOnce(
    fundId: string,
    referenceDate: Date,
    values: SnapshotIndicatorValues
  ): Promise<boolean>;
  findLatestSnapshot(fundId: string): Promise<StoredSnapshot | null>;
  sumSnapshots(fundId: string, start: Date, end: Date): Promise<string>;
};

export type VopFundSyncResult = {
  fundKey: VopFundKey;
  fundId?: string;
  createdDates: string[];
  completedDates: string[];
  existingDates: string[];
  waitingDates: string[];
  incompleteDates: string[];
  message?: string;
  error?: string;
};

export type VopSyncResult = {
  ok: boolean;
  funds: VopFundSyncResult[];
};

export type FundVopSummary = {
  referenceDate: Date;
  dailyAmount: number;
  monthlyAmount: number;
  weightedAverageTermDays: number | null;
  weightedAverageMonthlyRate: number | null;
};

const SUPPORTED_FUNDS: VopFundKey[] = ["APUAMA", "BRISTOL"];
const STABILITY_WINDOW_MS = 10 * 60 * 1000;
const PENDING_BACKFILL_LIMIT = 100;

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function emptyFundResult(fundKey: VopFundKey, fundId?: string) {
  return {
    fundKey,
    fundId,
    createdDates: [],
    completedDates: [],
    existingDates: [],
    waitingDates: [],
    incompleteDates: [],
  } satisfies VopFundSyncResult;
}

export function resolveVopFundKey(
  name: string,
  shortName: string
): VopFundKey | null {
  const label = normalizeName(`${name} ${shortName}`);
  if (label.includes("APUAMA")) return "APUAMA";
  if (label.includes("BRISTOL")) return "BRISTOL";
  return null;
}

export function monthBounds(value: Date) {
  return {
    start: new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1)),
    end: new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1) - 1
    ),
  };
}

export function isStablePosition(latestCreatedAt: Date, now: Date) {
  return latestCreatedAt.getTime() <= now.getTime() - STABILITY_WINDOW_MS;
}

export function vopStockWhere(fundKey: VopFundKey, referenceDate: Date) {
  return {
    nomeFundo: { contains: fundKey, mode: "insensitive" as const },
    dataReferencia: referenceDate,
    dataAquisicao: referenceDate,
  };
}

function serializeIndicators(
  calculation: OperationIndicatorCalculation,
  calculatedAt: Date
): SnapshotIndicatorValues {
  if (calculation.status === "invalid") {
    return {
      operationCount: null,
      termWeightedValue: null,
      termWeightAmount: null,
      monthlyRateWeightedValue: null,
      monthlyRateWeightAmount: null,
      indicatorsCalculatedAt: null,
    };
  }

  return {
    operationCount: calculation.operationCount,
    termWeightedValue: calculation.termWeightedValue?.toString() ?? null,
    termWeightAmount: calculation.termWeightAmount?.toString() ?? null,
    monthlyRateWeightedValue:
      calculation.monthlyRateWeightedValue?.toString() ?? null,
    monthlyRateWeightAmount:
      calculation.monthlyRateWeightAmount?.toString() ?? null,
    indicatorsCalculatedAt: calculatedAt,
  };
}

function calculateStockOperations(rows: StockOperation[]) {
  return calculateOperationIndicators(
    rows.map((row) => ({
      acquisitionValue: new Prisma.Decimal(row.acquisitionValue),
      termDays: row.termDays,
      annualAssignmentRate:
        row.annualAssignmentRate === null
          ? null
          : new Prisma.Decimal(row.annualAssignmentRate),
    }))
  );
}

function serializeStoredSnapshot(row: {
  fundId: string;
  referenceDate: Date;
  amount: Prisma.Decimal;
  operationCount: number | null;
  termWeightedValue: Prisma.Decimal | null;
  termWeightAmount: Prisma.Decimal | null;
  monthlyRateWeightedValue: Prisma.Decimal | null;
  monthlyRateWeightAmount: Prisma.Decimal | null;
  indicatorsCalculatedAt: Date | null;
}): StoredSnapshot {
  return {
    fundId: row.fundId,
    referenceDate: row.referenceDate,
    amount: row.amount.toString(),
    operationCount: row.operationCount,
    termWeightedValue: row.termWeightedValue?.toString() ?? null,
    termWeightAmount: row.termWeightAmount?.toString() ?? null,
    monthlyRateWeightedValue:
      row.monthlyRateWeightedValue?.toString() ?? null,
    monthlyRateWeightAmount:
      row.monthlyRateWeightAmount?.toString() ?? null,
    indicatorsCalculatedAt: row.indicatorsCalculatedAt,
  };
}

async function getPrismaRepository(): Promise<VopSnapshotRepository> {
  const { prisma } = await import("@/lib/prisma");
  const snapshotSelect = {
    fundId: true,
    referenceDate: true,
    amount: true,
    operationCount: true,
    termWeightedValue: true,
    termWeightAmount: true,
    monthlyRateWeightedValue: true,
    monthlyRateWeightAmount: true,
    indicatorsCalculatedAt: true,
  } as const;

  return {
    async listActiveFunds() {
      return prisma.fund.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, name: true, shortName: true },
      });
    },

    async findLatestStockReferenceDate(fundKey) {
      const row = await prisma.fidcEstoque.findFirst({
        where: { nomeFundo: { contains: fundKey, mode: "insensitive" } },
        orderBy: { dataReferencia: "desc" },
        select: { dataReferencia: true },
      });
      return row?.dataReferencia ?? null;
    },

    async listStockPositions(fundKey, start, end) {
      const rows = await prisma.fidcEstoque.groupBy({
        by: ["dataReferencia"],
        where: {
          nomeFundo: { contains: fundKey, mode: "insensitive" },
          dataReferencia: { gte: start, lte: end },
        },
        _max: { createdAt: true },
        orderBy: { dataReferencia: "asc" },
      });
      return rows.flatMap((row) =>
        row._max.createdAt
          ? [{ referenceDate: row.dataReferencia, latestCreatedAt: row._max.createdAt }]
          : []
      );
    },

    async listExistingSnapshots(fundId, start, end) {
      const rows = await prisma.fundVopSnapshot.findMany({
        where: { fundId, referenceDate: { gte: start, lte: end } },
        select: snapshotSelect,
      });
      return rows.map(serializeStoredSnapshot);
    },

    async listPendingSnapshots(fundId, limit) {
      const rows = await prisma.fundVopSnapshot.findMany({
        where: { fundId, indicatorsCalculatedAt: null },
        orderBy: { referenceDate: "desc" },
        take: limit,
        select: snapshotSelect,
      });
      return rows.map(serializeStoredSnapshot);
    },

    async loadStockOperations(fundKey, referenceDate) {
      const rows = await prisma.fidcEstoque.findMany({
        where: vopStockWhere(fundKey, referenceDate),
        select: { valorAquisicao: true, prazo: true, taxaCessao: true },
      });
      return rows.map((row) => ({
        acquisitionValue: row.valorAquisicao.toString(),
        termDays: row.prazo,
        annualAssignmentRate: row.taxaCessao?.toString() ?? null,
      }));
    },

    async createSnapshots(rows) {
      if (!rows.length) return;
      await prisma.fundVopSnapshot.createMany({ data: rows, skipDuplicates: true });
    },

    async completeSnapshotIndicatorsOnce(fundId, referenceDate, values) {
      const result = await prisma.fundVopSnapshot.updateMany({
        where: { fundId, referenceDate, indicatorsCalculatedAt: null },
        data: values,
      });
      return result.count === 1;
    },

    async findLatestSnapshot(fundId) {
      const row = await prisma.fundVopSnapshot.findFirst({
        where: { fundId },
        orderBy: { referenceDate: "desc" },
        select: snapshotSelect,
      });
      return row ? serializeStoredSnapshot(row) : null;
    },

    async sumSnapshots(fundId, start, end) {
      const result = await prisma.fundVopSnapshot.aggregate({
        where: { fundId, referenceDate: { gte: start, lte: end } },
        _sum: { amount: true },
      });
      return result._sum.amount?.toString() ?? "0";
    },
  };
}

export async function syncVopSnapshots(options?: {
  now?: Date;
  repository?: VopSnapshotRepository;
}): Promise<VopSyncResult> {
  const now = options?.now ?? new Date();
  const repository = options?.repository ?? (await getPrismaRepository());
  const activeFunds = await repository.listActiveFunds();
  const funds: VopFundSyncResult[] = [];

  for (const fundKey of SUPPORTED_FUNDS) {
    const matches = activeFunds.filter(
      (fund) => resolveVopFundKey(fund.name, fund.shortName) === fundKey
    );
    if (matches.length !== 1) {
      funds.push({
        ...emptyFundResult(fundKey),
        error:
          matches.length === 0
            ? `Fundo ativo ${fundKey} não encontrado.`
            : `Mais de um fundo ativo corresponde a ${fundKey}.`,
      });
      continue;
    }

    const fund = matches[0];
    try {
      const latestDate = await repository.findLatestStockReferenceDate(fundKey);
      if (!latestDate) {
        funds.push({
          ...emptyFundResult(fundKey, fund.id),
          message: "Nenhuma posição de estoque disponível.",
        });
        continue;
      }

      const { start, end } = monthBounds(latestDate);
      const [positions, existingSnapshots, pendingSnapshots] = await Promise.all([
        repository.listStockPositions(fundKey, start, end),
        repository.listExistingSnapshots(fund.id, start, end),
        repository.listPendingSnapshots(fund.id, PENDING_BACKFILL_LIMIT),
      ]);
      const existingByDate = new Map(
        existingSnapshots.map((snapshot) => [dateKey(snapshot.referenceDate), snapshot])
      );
      const rows: NewVopSnapshot[] = [];
      const completedDates: string[] = [];
      const waitingDates: string[] = [];
      const incompleteDates: string[] = [];

      for (const pending of pendingSnapshots) {
        const key = dateKey(pending.referenceDate);
        const calculation = calculateStockOperations(
          await repository.loadStockOperations(fundKey, pending.referenceDate)
        );
        if (
          calculation.status === "invalid" ||
          !new Prisma.Decimal(pending.amount).equals(calculation.amount)
        ) {
          incompleteDates.push(key);
          continue;
        }
        if (
          await repository.completeSnapshotIndicatorsOnce(
            fund.id,
            pending.referenceDate,
            serializeIndicators(calculation, now)
          )
        ) {
          completedDates.push(key);
        }
      }

      for (const position of positions) {
        const key = dateKey(position.referenceDate);
        const existing = existingByDate.get(key);
        if (existing) continue;
        if (!isStablePosition(position.latestCreatedAt, now)) {
          waitingDates.push(key);
          continue;
        }

        const calculation = calculateStockOperations(
          await repository.loadStockOperations(fundKey, position.referenceDate)
        );
        const indicatorValues = serializeIndicators(calculation, now);

        if (calculation.status === "invalid") {
          incompleteDates.push(key);
          continue;
        }

        rows.push({
          fundId: fund.id,
          referenceDate: position.referenceDate,
          amount: calculation.amount.toString(),
          ...indicatorValues,
        });
      }

      await repository.createSnapshots(rows);
      funds.push({
        fundKey,
        fundId: fund.id,
        createdDates: rows.map((row) => dateKey(row.referenceDate)),
        completedDates,
        existingDates: existingSnapshots.map((row) => dateKey(row.referenceDate)),
        waitingDates,
        incompleteDates,
      });
    } catch (error) {
      funds.push({
        ...emptyFundResult(fundKey, fund.id),
        error: error instanceof Error ? error.message : "Erro desconhecido.",
      });
    }
  }

  return { ok: funds.every((fund) => !fund.error), funds };
}

function weightedAverage(numerator: string | null, denominator: string | null) {
  if (numerator === null || denominator === null) return null;
  const result = weightedAverageFromComponents([
    {
      weightedValue: new Prisma.Decimal(numerator),
      weightAmount: new Prisma.Decimal(denominator),
    },
  ]);
  return result === null ? null : Number(result);
}

export async function loadFundVopSummary(
  fundId: string,
  providedRepository?: VopSnapshotRepository
): Promise<FundVopSummary | null> {
  const repository = providedRepository ?? (await getPrismaRepository());
  const latest = await repository.findLatestSnapshot(fundId);
  if (!latest) return null;
  const { start } = monthBounds(latest.referenceDate);
  const monthlyAmount = await repository.sumSnapshots(
    fundId,
    start,
    latest.referenceDate
  );
  return {
    referenceDate: latest.referenceDate,
    dailyAmount: Number(latest.amount),
    monthlyAmount: Number(monthlyAmount),
    weightedAverageTermDays: latest.indicatorsCalculatedAt
      ? weightedAverage(latest.termWeightedValue, latest.termWeightAmount)
      : null,
    weightedAverageMonthlyRate: latest.indicatorsCalculatedAt
      ? weightedAverage(
          latest.monthlyRateWeightedValue,
          latest.monthlyRateWeightAmount
        )
      : null,
  };
}
