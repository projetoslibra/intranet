import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fundDisplayPriority } from "@/lib/fund-order";
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

export type StockComplianceFilters = {
  cedent?: string;
  debtor?: string;
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

const SPECIAL_CEDENTS = new Set(
  [
    "UY3 SOCIEDADE DE CREDITO DIRETO S/ A",
    "MONEY PLUS SOCIEDADE DE CREDITO AO MICROEMPREENDED",
    "MONEY PLUS SOCIEDADE DE CREDITO AO MICRO",
    "BMP MONEY PLUS SOCIEDADE DE CRÉDITO DIRETO SA",
  ].map(normalizeAtivo)
);

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

function concentrationKey(document: string | null, name: string) {
  return document?.trim() || normalizeAtivo(name);
}

function matchesConcentrationFilter(row: ConcentrationRow, filter?: string) {
  const normalizedFilter = normalizeAtivo(filter ?? "");
  if (!normalizedFilter) {
    return true;
  }

  return normalizeAtivo(`${row.name} ${row.document}`).includes(normalizedFilter);
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
  const [cashDates, stockDates, riskDates] = await Promise.all([
    prisma.companyCashDailyBalance.findMany({
      distinct: ["referenceDate"],
      orderBy: { referenceDate: "desc" },
      select: { referenceDate: true },
    }),
    prisma.fidcEstoque.findMany({
      distinct: ["dataReferencia"],
      orderBy: { dataReferencia: "desc" },
      select: { dataReferencia: true },
    }),
    prisma.importBatch.findMany({
      distinct: ["referenceDate"],
      where: {
        referenceDate: { not: null },
        module: "RISK_LIMITS",
        status: "COMPLETED",
      },
      orderBy: { referenceDate: "desc" },
      select: { referenceDate: true },
    }),
  ]);

  return Array.from(
    new Set([
      ...cashDates.map((row) => dateKey(row.referenceDate)),
      ...stockDates.map((row) => dateKey(row.dataReferencia)),
      ...riskDates.flatMap((row) => (row.referenceDate ? [dateKey(row.referenceDate)] : [])),
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

async function getStockSummaries(
  referenceDate: Date,
  filters: StockComplianceFilters = {}
): Promise<StockComplianceSummary[]> {
  const latestDatesByFund = await prisma.fidcEstoque.groupBy({
    by: ["nomeFundo"],
    where: { dataReferencia: { lte: referenceDate } },
    _max: { dataReferencia: true },
  });

  const summaries = await Promise.all(
    latestDatesByFund.map(async (snapshot) => {
      const stockDate = snapshot._max.dataReferencia;
      if (!stockDate) {
        return null;
      }

      const positions = await prisma.fidcEstoque.findMany({
        where: {
          nomeFundo: snapshot.nomeFundo,
          dataReferencia: stockDate,
        },
        select: {
          nomeCedente: true,
          docCedente: true,
          nomeSacado: true,
          docSacado: true,
          valorNominal: true,
        },
      });

      const fundKey =
        resolveCarteiraFundo({ name: snapshot.nomeFundo, shortName: snapshot.nomeFundo }) ??
        snapshot.nomeFundo;
      const fund = {
        name: snapshot.nomeFundo,
        shortName: fundKey,
      };
      const { pl, plDate } = await getPlForFund(fund, stockDate);
      const cedents = new Map<string, { name: string; document: string; value: number }>();
      const debtors = new Map<string, { name: string; document: string; value: number }>();

      for (const position of positions) {
        const replaceCedent = SPECIAL_CEDENTS.has(normalizeAtivo(position.nomeCedente));
        const cedentName = replaceCedent ? position.nomeSacado : position.nomeCedente;
        const cedentDocument = replaceCedent ? position.docSacado : position.docCedente;

        addConcentration(
          cedents,
          concentrationKey(cedentDocument, cedentName),
          cedentName,
          cedentDocument ?? "",
          toNumber(position.valorNominal)
        );
        addConcentration(
          debtors,
          concentrationKey(position.docSacado, position.nomeSacado),
          position.nomeSacado,
          position.docSacado ?? "",
          toNumber(position.valorNominal)
        );
      }

      const limits = LIMITS[fundKey] ?? LIMITS.APUAMA;
      const cedentRows = toRows(cedents, pl);
      const debtorRows = toRows(debtors, pl);

      const summary: StockComplianceSummary = {
        fundId: `fidc:${normalizeAtivo(snapshot.nomeFundo)}`,
        fundName: fundKey,
        referenceDate: dateKey(stockDate),
        pl,
        plDate,
        limits,
        largestCedent: cedentRows[0] ?? null,
        topCedentsShare: cedentRows.slice(0, 5).reduce((sum, row) => sum + row.share, 0),
        largestDebtor: debtorRows[0] ?? null,
        topDebtorsShare: debtorRows
          .slice(0, limits.topDebtorsCount)
          .reduce((sum, row) => sum + row.share, 0),
        cedents: cedentRows.filter((row) => matchesConcentrationFilter(row, filters.cedent)).slice(0, 10),
        debtors: debtorRows.filter((row) => matchesConcentrationFilter(row, filters.debtor)).slice(0, 10),
      };

      return summary;
    })
  );

  return summaries
    .filter((summary): summary is StockComplianceSummary => summary !== null)
    .sort((a, b) => {
      const priorityDifference =
        fundDisplayPriority({ name: a.fundName }) -
        fundDisplayPriority({ name: b.fundName });

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      return a.fundName.localeCompare(b.fundName, "pt-BR");
    });
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

export async function getOperationDeskData(
  date?: string,
  stockFilters: StockComplianceFilters = {}
): Promise<OperationDeskData> {
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
    getStockSummaries(referenceDate, stockFilters),
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
