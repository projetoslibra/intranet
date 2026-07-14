import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CashDailyBalance } from "@/features/cash/types/cash";

export type OperationalImportSummary = {
  id: string;
  module: string;
  fileName: string;
  status: string;
  referenceDate: string | null;
  importedRows: number;
  errorRows: number;
  createdAt: string;
  fundName: string | null;
};

export type ConcentrationRow = {
  name: string;
  document: string;
  value: number;
  share: number;
};

export type StockComplianceSummary = {
  fundId: string;
  fundName: string;
  referenceDate: string;
  pl: number;
  plDate: string | null;
  limits: {
    largestCedent: number;
    topCedents: number;
    largestDebtor: number;
    topDebtors: number;
    topDebtorsCount: number;
  };
  largestCedent: ConcentrationRow | null;
  topCedentsShare: number;
  largestDebtor: ConcentrationRow | null;
  topDebtorsShare: number;
  cedents: ConcentrationRow[];
  debtors: ConcentrationRow[];
};

export type RiskRow = {
  code: string | null;
  cedentName: string;
  commercial: string | null;
  groupName: string | null;
  limitUsed: number;
  limitAvailable: number;
  overdueAmount: number;
  performance: number;
  identified: boolean;
};

export type OperationDeskData = {
  selectedDate: string;
  availableDates: string[];
  cashBalances: CashDailyBalance[];
  imports: OperationalImportSummary[];
  stockSummaries: StockComplianceSummary[];
  risk: {
    referenceDate: string | null;
    rows: RiskRow[];
    unidentifiedRows: number;
  };
};

const LIMITS: Record<
  string,
  {
    largestCedent: number;
    topCedents: number;
    largestDebtor: number;
    topDebtors: number;
    topDebtorsCount: number;
  }
> = {
  APUAMA: {
    largestCedent: 10,
    topCedents: 40,
    largestDebtor: 10,
    topDebtors: 35,
    topDebtorsCount: 10,
  },
  BRISTOL: {
    largestCedent: 7,
    topCedents: 40,
    largestDebtor: 10,
    topDebtors: 25,
    topDebtorsCount: 5,
  },
};

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseDateKey(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function resolveCarteiraFundo(fund: { name: string; shortName: string }) {
  const label = `${fund.shortName} ${fund.name}`.toUpperCase();

  if (label.includes("APUAMA")) {
    return "APUAMA";
  }

  if (label.includes("BRISTOL")) {
    return "BRISTOL";
  }

  return null;
}

function normalizeAtivo(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function isPlAtivo(value: string) {
  const ativo = normalizeAtivo(value);
  return (
    ativo === "PATRIMONIO" ||
    ativo === "SRP" ||
    ativo.includes("SENIOR") ||
    ativo === "MEZAN" ||
    ativo.includes("MEZANINO")
  );
}

function toNumber(value: Prisma.Decimal | null | undefined): number {
  return Number(value ?? 0);
}

function computeCash(
  paymentBalance: Prisma.Decimal,
  reserveBalance: Prisma.Decimal,
  usedAmount: Prisma.Decimal
): Prisma.Decimal {
  return paymentBalance.minus(reserveBalance).minus(usedAmount);
}

function serializeCash(row: {
  fundId: string;
  referenceDate: Date;
  receivingBalance: Prisma.Decimal;
  reconciliationBalance: Prisma.Decimal;
  reserveBalance: Prisma.Decimal;
  paymentBalance: Prisma.Decimal;
  usedAmount: Prisma.Decimal;
  note: string | null;
  fund: { name: string; shortName: string };
}): CashDailyBalance {
  const cash = computeCash(row.paymentBalance, row.reserveBalance, row.usedAmount);

  return {
    fundId: row.fundId,
    fundName: row.fund.name,
    fundShortName: row.fund.shortName,
    referenceDate: dateKey(row.referenceDate),
    receivingBalance: row.receivingBalance.toFixed(2),
    reconciliationBalance: row.reconciliationBalance.toFixed(2),
    reserveBalance: row.reserveBalance.toFixed(2),
    paymentBalance: row.paymentBalance.toFixed(2),
    usedAmount: row.usedAmount.toFixed(2),
    cash: cash.toFixed(2),
    note: row.note,
  };
}

function addConcentration(
  map: Map<string, { name: string; document: string; value: number }>,
  key: string,
  name: string,
  document: string,
  value: number
) {
  const current = map.get(key);
  if (current) {
    current.value += value;
  } else {
    map.set(key, { name, document, value });
  }
}

function toRows(
  map: Map<string, { name: string; document: string; value: number }>,
  pl: number
): ConcentrationRow[] {
  return Array.from(map.values())
    .map((row) => ({
      ...row,
      share: pl > 0 ? (row.value / pl) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

async function getPlForFund(
  fund: { name: string; shortName: string },
  referenceDate: Date
): Promise<{ pl: number; plDate: string | null }> {
  const carteiraFundo = resolveCarteiraFundo(fund);
  if (!carteiraFundo) {
    return { pl: 0, plDate: null };
  }

  const latest = await prisma.carteira.findFirst({
    where: { fundo: carteiraFundo, dataAnalise: { lte: referenceDate } },
    orderBy: { dataAnalise: "desc" },
    select: { dataAnalise: true },
  });

  if (!latest) {
    return { pl: 0, plDate: null };
  }

  const rows = await prisma.carteira.findMany({
    where: { fundo: carteiraFundo, dataAnalise: latest.dataAnalise },
    select: { ativo: true, valor: true },
  });

  return {
    pl: rows.reduce((sum, row) => sum + (isPlAtivo(row.ativo) ? Math.abs(toNumber(row.valor)) : 0), 0),
    plDate: dateKey(latest.dataAnalise),
  };
}

async function getAvailableDates(): Promise<string[]> {
  const [cashDates, batchDates] = await Promise.all([
    prisma.companyCashDailyBalance.findMany({
      distinct: ["referenceDate"],
      orderBy: { referenceDate: "desc" },
      select: { referenceDate: true },
    }),
    prisma.importBatch.findMany({
      distinct: ["referenceDate"],
      where: {
        referenceDate: { not: null },
        module: { in: ["RECEIVABLE_STOCK", "RISK_LIMITS"] },
        status: "COMPLETED",
      },
      orderBy: { referenceDate: "desc" },
      select: { referenceDate: true },
    }),
  ]);

  return Array.from(
    new Set([
      ...cashDates.map((row) => dateKey(row.referenceDate)),
      ...batchDates.flatMap((row) => (row.referenceDate ? [dateKey(row.referenceDate)] : [])),
    ])
  ).sort((a, b) => b.localeCompare(a));
}

async function getLatestImports(): Promise<OperationalImportSummary[]> {
  const rows = await prisma.importBatch.findMany({
    where: { module: { in: ["RECEIVABLE_STOCK", "RISK_LIMITS", "CEDENT_DIMENSION"] } },
    orderBy: { createdAt: "desc" },
    take: 8,
    include: { fund: { select: { shortName: true, name: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    module: row.module,
    fileName: row.fileName,
    status: row.status,
    referenceDate: row.referenceDate ? dateKey(row.referenceDate) : null,
    importedRows: row.importedRows,
    errorRows: row.errorRows,
    createdAt: row.createdAt.toISOString(),
    fundName: row.fund?.shortName ?? row.fund?.name ?? null,
  }));
}

async function getStockSummaries(referenceDate: Date): Promise<StockComplianceSummary[]> {
  const batches = await prisma.importBatch.findMany({
    where: {
      module: "RECEIVABLE_STOCK",
      status: "COMPLETED",
      referenceDate: { lte: referenceDate },
      fundId: { not: null },
    },
    orderBy: [{ referenceDate: "desc" }, { completedAt: "desc" }],
    include: { fund: { select: { id: true, name: true, shortName: true } } },
  });

  const latestByFund = new Map<string, (typeof batches)[number]>();
  for (const batch of batches) {
    if (batch.fundId && !latestByFund.has(batch.fundId)) {
      latestByFund.set(batch.fundId, batch);
    }
  }

  const summaries = await Promise.all(
    Array.from(latestByFund.values()).map(async (batch) => {
      if (!batch.fund) {
        return null;
      }

      const positions = await prisma.receivableStockPosition.findMany({
        where: { batchId: batch.id },
        select: {
          cedentName: true,
          cedentDocument: true,
          debtorName: true,
          debtorDocument: true,
          nominalValue: true,
        },
      });

      const { pl, plDate } = await getPlForFund(batch.fund, batch.referenceDate ?? referenceDate);
      const cedents = new Map<string, { name: string; document: string; value: number }>();
      const debtors = new Map<string, { name: string; document: string; value: number }>();

      for (const position of positions) {
        addConcentration(
          cedents,
          position.cedentDocument,
          position.cedentName,
          position.cedentDocument,
          toNumber(position.nominalValue)
        );
        addConcentration(
          debtors,
          position.debtorDocument,
          position.debtorName,
          position.debtorDocument,
          toNumber(position.nominalValue)
        );
      }

      const fundKey = resolveCarteiraFundo(batch.fund) ?? batch.fund.shortName.toUpperCase();
      const limits = LIMITS[fundKey] ?? LIMITS.APUAMA;
      const cedentRows = toRows(cedents, pl);
      const debtorRows = toRows(debtors, pl);

      const summary: StockComplianceSummary = {
        fundId: batch.fund.id,
        fundName: batch.fund.shortName || batch.fund.name,
        referenceDate: batch.referenceDate ? dateKey(batch.referenceDate) : dateKey(referenceDate),
        pl,
        plDate,
        limits,
        largestCedent: cedentRows[0] ?? null,
        topCedentsShare: cedentRows.slice(0, 5).reduce((sum, row) => sum + row.share, 0),
        largestDebtor: debtorRows[0] ?? null,
        topDebtorsShare: debtorRows
          .slice(0, limits.topDebtorsCount)
          .reduce((sum, row) => sum + row.share, 0),
        cedents: cedentRows.slice(0, 10),
        debtors: debtorRows.slice(0, 10),
      };

      return summary;
    })
  );

  return summaries
    .filter((summary): summary is StockComplianceSummary => summary !== null)
    .sort((a, b) => a.fundName.localeCompare(b.fundName));
}

async function getRisk(referenceDate: Date): Promise<OperationDeskData["risk"]> {
  const batch = await prisma.importBatch.findFirst({
    where: {
      module: "RISK_LIMITS",
      status: "COMPLETED",
      referenceDate: { lte: referenceDate },
    },
    orderBy: [{ referenceDate: "desc" }, { completedAt: "desc" }],
  });

  if (!batch?.referenceDate) {
    return { referenceDate: null, rows: [], unidentifiedRows: 0 };
  }

  const positions = await prisma.riskLimitPosition.findMany({
    where: { batchId: batch.id },
    include: { cedentDimensionEntry: true },
    orderBy: { limitUsed: "desc" },
  });

  const filtered = positions.filter((row) => !row.limitUsed.equals(row.overdueAmount));
  const totalUsed = filtered.reduce((sum, row) => sum + toNumber(row.limitUsed), 0);
  const rows = filtered.map((row) => ({
    code: row.code,
    cedentName: row.cedentName,
    commercial: row.cedentDimensionEntry?.commercial ?? null,
    groupName: row.cedentDimensionEntry?.groupName ?? null,
    limitUsed: toNumber(row.limitUsed),
    limitAvailable: toNumber(row.limitAvailable),
    overdueAmount: toNumber(row.overdueAmount),
    performance: totalUsed > 0 ? toNumber(row.limitUsed) / totalUsed : 0,
    identified: Boolean(row.cedentDimensionEntryId),
  }));

  return {
    referenceDate: dateKey(batch.referenceDate),
    rows,
    unidentifiedRows: rows.filter((row) => !row.identified).length,
  };
}

export async function getOperationDeskData(date?: string): Promise<OperationDeskData> {
  const availableDates = await getAvailableDates();
  const selectedDate = date ?? availableDates[0] ?? new Date().toISOString().slice(0, 10);
  const referenceDate = parseDateKey(selectedDate);

  const [cashRows, imports, stockSummaries, risk] = await Promise.all([
    prisma.companyCashDailyBalance.findMany({
      where: { referenceDate },
      include: { fund: { select: { name: true, shortName: true } } },
      orderBy: { fund: { name: "asc" } },
    }),
    getLatestImports(),
    getStockSummaries(referenceDate),
    getRisk(referenceDate),
  ]);

  return {
    selectedDate,
    availableDates,
    cashBalances: cashRows.map(serializeCash),
    imports,
    stockSummaries,
    risk,
  };
}
