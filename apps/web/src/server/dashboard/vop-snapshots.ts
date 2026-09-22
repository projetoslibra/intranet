export type VopFundKey = "APUAMA" | "BRISTOL";

export type NewVopSnapshot = {
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

type StoredSnapshot = NewVopSnapshot;

export type VopSnapshotRepository = {
  listActiveFunds(): Promise<ActiveFund[]>;
  findLatestStockReferenceDate(fundKey: VopFundKey): Promise<Date | null>;
  listStockPositions(
    fundKey: VopFundKey,
    start: Date,
    end: Date
  ): Promise<StockPosition[]>;
  listExistingSnapshotDates(
    fundId: string,
    start: Date,
    end: Date
  ): Promise<Date[]>;
  sumAcquisitionValue(
    fundKey: VopFundKey,
    referenceDate: Date
  ): Promise<string>;
  createSnapshots(rows: NewVopSnapshot[]): Promise<void>;
  findLatestSnapshot(fundId: string): Promise<StoredSnapshot | null>;
  sumSnapshots(fundId: string, start: Date, end: Date): Promise<string>;
};

export type VopFundSyncResult = {
  fundKey: VopFundKey;
  fundId?: string;
  createdDates: string[];
  existingDates: string[];
  waitingDates: string[];
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
};

const SUPPORTED_FUNDS: VopFundKey[] = ["APUAMA", "BRISTOL"];
const STABILITY_WINDOW_MS = 10 * 60 * 1000;

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

async function getPrismaRepository(): Promise<VopSnapshotRepository> {
  const { prisma } = await import("@/lib/prisma");

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

  async listExistingSnapshotDates(fundId, start, end) {
    const rows = await prisma.fundVopSnapshot.findMany({
      where: { fundId, referenceDate: { gte: start, lte: end } },
      select: { referenceDate: true },
    });
    return rows.map((row) => row.referenceDate);
  },

  async sumAcquisitionValue(fundKey, referenceDate) {
    const result = await prisma.fidcEstoque.aggregate({
      where: vopStockWhere(fundKey, referenceDate),
      _sum: { valorAquisicao: true },
    });
    return result._sum.valorAquisicao?.toString() ?? "0";
  },

  async createSnapshots(rows) {
    if (!rows.length) return;
    await prisma.fundVopSnapshot.createMany({ data: rows, skipDuplicates: true });
  },

  async findLatestSnapshot(fundId) {
    const row = await prisma.fundVopSnapshot.findFirst({
      where: { fundId },
      orderBy: { referenceDate: "desc" },
      select: { fundId: true, referenceDate: true, amount: true },
    });
    return row ? { ...row, amount: row.amount.toString() } : null;
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
        fundKey,
        createdDates: [],
        existingDates: [],
        waitingDates: [],
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
          fundKey,
          fundId: fund.id,
          createdDates: [],
          existingDates: [],
          waitingDates: [],
          message: "Nenhuma posição de estoque disponível.",
        });
        continue;
      }

      const { start, end } = monthBounds(latestDate);
      const [positions, existingDates] = await Promise.all([
        repository.listStockPositions(fundKey, start, end),
        repository.listExistingSnapshotDates(fund.id, start, end),
      ]);
      const existingKeys = new Set(existingDates.map(dateKey));
      const rows: NewVopSnapshot[] = [];
      const waitingDates: string[] = [];

      for (const position of positions) {
        const key = dateKey(position.referenceDate);
        if (existingKeys.has(key)) continue;
        if (!isStablePosition(position.latestCreatedAt, now)) {
          waitingDates.push(key);
          continue;
        }
        rows.push({
          fundId: fund.id,
          referenceDate: position.referenceDate,
          amount: await repository.sumAcquisitionValue(
            fundKey,
            position.referenceDate
          ),
        });
      }

      await repository.createSnapshots(rows);
      funds.push({
        fundKey,
        fundId: fund.id,
        createdDates: rows.map((row) => dateKey(row.referenceDate)),
        existingDates: existingDates.map(dateKey),
        waitingDates,
      });
    } catch (error) {
      funds.push({
        fundKey,
        fundId: fund.id,
        createdDates: [],
        existingDates: [],
        waitingDates: [],
        error: error instanceof Error ? error.message : "Erro desconhecido.",
      });
    }
  }

  return { ok: funds.every((fund) => !fund.error), funds };
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
  };
}
