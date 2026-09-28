import { calculateFlatAverage } from "@/lib/flat-average";
import { sortFundsByDisplayPriority } from "@/lib/fund-order";
import { fundListWhere } from "@/lib/fund-modules";
import { resolveVopFundKey } from "./vop-snapshots";
import {
  buildDashboardOverview,
  type DashboardFundInput,
  type DashboardOverview,
  type DashboardSnapshotInput,
} from "./dashboard-overview";

type FundRecord = {
  id: string;
  name: string;
  shortName: string;
  cnpj: string;
};

type FundRange = {
  fundKey: string;
  start: Date;
  end: Date;
};

type CarteiraRecord = {
  fundKey: string;
  referenceDate: Date;
  ativo: string;
  valor: string;
};

type CaixaRecord = {
  fundKey: string;
  referenceDate: Date;
  descricao: string;
  historicoTraduzido: string | null;
  clienteId: string;
  entradas: string;
  saidas: string;
};

export type DashboardDataRepository = {
  listDashboardFunds(): Promise<FundRecord[]>;
  listLatestCarteiraDates(
    fundKeys: string[]
  ): Promise<Array<{ fundKey: string; referenceDate: Date }>>;
  listCarteirasForRanges(ranges: FundRange[]): Promise<CarteiraRecord[]>;
  listCaixasForRanges(ranges: FundRange[]): Promise<CaixaRecord[]>;
  listVopSnapshots(fundIds: string[]): Promise<DashboardSnapshotInput[]>;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function resolveCarteiraFundKey(fund: Pick<FundRecord, "name" | "shortName">) {
  const label = normalize(`${fund.shortName} ${fund.name}`);
  for (const key of ["APUAMA", "BRISTOL", "CONSIGNADO", "ANTENA"]) {
    if (label.includes(key)) return key;
  }
  return null;
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function monthStart(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function classifyCarteiraAtivo(value: string) {
  const ativo = normalize(value);
  if (ativo === "PATRIMONIO") return "patrimonio";
  if (ativo === "VARIACAO DIARIA") return "variacao_diaria";
  if (ativo === "VARIACAO MENSAL") return "variacao_mensal";
  if (ativo === "VARIACAO ANUAL") return "variacao_anual";
  if (ativo.includes("PDD")) return "pdd";
  if (ativo === "SRP" || ativo.includes("SENIOR")) return "senior";
  if (ativo === "MEZAN" || ativo.includes("MEZANINO")) return "mezzanine";
  if (ativo.includes("A VENCER") || ativo.includes("VENCIDOS") || ativo === "DIR") {
    return "creditRights";
  }
  if (ativo.includes("NTN") || ativo.includes("LFT") || ativo.includes("SELIC")) {
    return "ntnb";
  }
  if (
    ativo.includes("TAXA") ||
    ativo.includes("DESPESA") ||
    ativo.includes("DIFERIMENTO") ||
    ativo.includes("AUDITORIA") ||
    ativo.includes("CETIP") ||
    ativo.includes("CUSTO") ||
    ativo.includes("CONSULTORIA") ||
    ativo.includes("RATING")
  ) {
    return "expense";
  }
  return "outros";
}

function caixaFlowType(value: string) {
  const description = normalize(value);
  if (description.startsWith("APLICACAO NO FUNDO")) return "aplicacao";
  if (description.startsWith("RESGATE DO FUNDO")) return "resgate";
  return null;
}

function classifyCaixaAssetClass(record: CaixaRecord) {
  const text = normalize(
    `${record.descricao} ${record.historicoTraduzido ?? ""} ${record.clienteId}`
  );
  if (text.includes("MZ") || text.includes("MEZ") || text.includes("MEZAN")) {
    return "mezzanine";
  }
  if (text.includes(" SR") || text.includes("SRP") || text.includes("SENIOR")) {
    return "senior";
  }
  if (
    text.includes("A VENCER") ||
    text.includes("VENCIDOS") ||
    text.includes("BRISVENC") ||
    text.includes("BRISAVE") ||
    text.includes("APULBAV") ||
    text.includes("APULBVE")
  ) {
    return "creditRights";
  }
  if (text.includes("NTN") || text.includes("LFT") || text.includes("SELIC")) {
    return "ntnb";
  }
  return "otherFunds";
}

function addToMap(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function deltaMap(dates: string[], values: Map<string, number>) {
  const result = new Map<string, number>();
  for (let index = 1; index < dates.length; index += 1) {
    result.set(
      dates[index],
      (values.get(dates[index]) ?? 0) - (values.get(dates[index - 1]) ?? 0)
    );
  }
  return result;
}

function assetDeltaMap(
  dates: string[],
  values: Map<string, number>,
  applications: Map<string, number>,
  redemptions: Map<string, number>
) {
  const result = new Map<string, number>();
  for (let index = 1; index < dates.length; index += 1) {
    const key = dates[index];
    const previousKey = dates[index - 1];
    result.set(
      key,
      (values.get(key) ?? 0) -
        (values.get(previousKey) ?? 0) -
        (applications.get(key) ?? 0) +
        (redemptions.get(key) ?? 0)
    );
  }
  return result;
}

function creditRightsDeltaMap(
  dates: string[],
  values: Map<string, number>,
  purchases: Map<string, number>,
  liquidations: Map<string, number>
) {
  const result = new Map<string, number>();
  for (let index = 1; index < dates.length; index += 1) {
    const key = dates[index];
    const previousKey = dates[index - 1];
    result.set(
      key,
      (values.get(key) ?? 0) -
        (values.get(previousKey) ?? 0) -
        (purchases.get(key) ?? 0) +
        (liquidations.get(key) ?? 0)
    );
  }
  return result;
}

function calculateMonthlyAverages(
  carteiras: CarteiraRecord[],
  caixas: CaixaRecord[]
) {
  const dateSet = new Set<string>();
  const creditRights = new Map<string, number>();
  const senior = new Map<string, number>();
  const mezzanine = new Map<string, number>();
  const expenses = new Map<string, number>();
  const applicationsByAssetClass = new Map<string, Map<string, number>>();
  const redemptionsByAssetClass = new Map<string, Map<string, number>>();

  for (const row of carteiras) {
    const key = dateKey(row.referenceDate);
    const value = Number(row.valor);
    const category = classifyCarteiraAtivo(row.ativo);
    dateSet.add(key);
    if (category === "creditRights") addToMap(creditRights, key, value);
    else if (category === "senior") addToMap(senior, key, value);
    else if (category === "mezzanine") addToMap(mezzanine, key, value);
    else if (category === "expense") addToMap(expenses, key, value);
  }

  for (const row of caixas) {
    const flowType = caixaFlowType(row.descricao);
    if (!flowType) continue;
    const amount =
      flowType === "aplicacao"
        ? Math.abs(Number(row.saidas))
        : Math.abs(Number(row.entradas));
    if (amount === 0) continue;
    const key = dateKey(row.referenceDate);
    const assetClass = classifyCaixaAssetClass(row);
    const target =
      flowType === "resgate" ? redemptionsByAssetClass : applicationsByAssetClass;
    const values = target.get(assetClass) ?? new Map<string, number>();
    addToMap(values, key, amount);
    target.set(assetClass, values);
    dateSet.add(key);
  }

  const dates = Array.from(dateSet).sort();
  const calculationDates = dates.slice(1, -1);
  if (calculationDates.length === 0) {
    return {
      averageMonthlyRevenue: 0,
      averageMonthlyCost: 0,
      monthlyRevenueTotal: 0,
      monthlyCostTotal: 0,
      monthlyRevenuePeriods: 0,
      monthlyCostPeriods: 0,
    };
  }

  const applications = (assetClass: string) =>
    applicationsByAssetClass.get(assetClass) ?? new Map<string, number>();
  const redemptions = (assetClass: string) =>
    redemptionsByAssetClass.get(assetClass) ?? new Map<string, number>();
  const revenueByDate = creditRightsDeltaMap(
    dates,
    creditRights,
    applications("creditRights"),
    redemptions("creditRights")
  );
  const seniorDelta = assetDeltaMap(
    dates,
    senior,
    applications("senior"),
    redemptions("senior")
  );
  const mezzanineDelta = assetDeltaMap(
    dates,
    mezzanine,
    applications("mezzanine"),
    redemptions("mezzanine")
  );
  const expensesDelta = deltaMap(dates, expenses);
  const revenueAverage = calculateFlatAverage(
    calculationDates.map((key) => revenueByDate.get(key) ?? 0)
  );
  const costAverage = calculateFlatAverage(
    calculationDates.map((key) => {
      const superior =
        (seniorDelta.get(key) ?? 0) + (mezzanineDelta.get(key) ?? 0);
      return -(superior + Math.min(expensesDelta.get(key) ?? 0, 0));
    })
  );

  return {
    averageMonthlyRevenue: revenueAverage.average,
    averageMonthlyCost: costAverage.average,
    monthlyRevenueTotal: revenueAverage.total,
    monthlyCostTotal: costAverage.total,
    monthlyRevenuePeriods: revenueAverage.periods,
    monthlyCostPeriods: costAverage.periods,
  };
}

function emptyFinancials(
  fund: FundRecord,
  vopIntegrated: boolean
): DashboardFundInput {
  return {
    ...fund,
    positionDate: null,
    totalPl: null,
    seniorValue: 0,
    mezzanineValue: 0,
    juniorValue: 0,
    dailyReturn: 0,
    monthReturn: 0,
    yearReturn: 0,
    monthlyReturnHistory: [],
    averageMonthlyRevenue: 0,
    averageMonthlyCost: 0,
    monthlyRevenueTotal: 0,
    monthlyCostTotal: 0,
    monthlyRevenuePeriods: 0,
    monthlyCostPeriods: 0,
    economicsStatus: "no_data",
    vopIntegrated,
  };
}

async function getPrismaRepository(): Promise<DashboardDataRepository> {
  const { prisma } = await import("@/lib/prisma");

  return {
    listDashboardFunds() {
      return prisma.fund.findMany({
        where: fundListWhere("DASHBOARD"),
        select: { id: true, name: true, shortName: true, cnpj: true },
      });
    },
    async listLatestCarteiraDates(fundKeys) {
      if (fundKeys.length === 0) return [];
      const rows = await prisma.carteira.groupBy({
        by: ["fundo"],
        where: { fundo: { in: fundKeys } },
        _max: { dataAnalise: true },
      });
      return rows.flatMap((row) =>
        row._max.dataAnalise
          ? [{ fundKey: row.fundo, referenceDate: row._max.dataAnalise }]
          : []
      );
    },
    async listCarteirasForRanges(ranges) {
      if (ranges.length === 0) return [];
      const rows = await prisma.carteira.findMany({
        where: {
          OR: ranges.map((range) => ({
            fundo: range.fundKey,
            dataAnalise: { gte: range.start, lte: range.end },
          })),
        },
        select: { fundo: true, dataAnalise: true, ativo: true, valor: true },
      });
      return rows.map((row) => ({
        fundKey: row.fundo,
        referenceDate: row.dataAnalise,
        ativo: row.ativo,
        valor: row.valor.toString(),
      }));
    },
    async listCaixasForRanges(ranges) {
      if (ranges.length === 0) return [];
      const rows = await prisma.caixaSingulare.findMany({
        where: {
          OR: ranges.flatMap((range) => [
            {
              dataAnalise: { gte: range.start, lte: range.end },
              clienteId: { contains: range.fundKey, mode: "insensitive" as const },
            },
            {
              dataAnalise: { gte: range.start, lte: range.end },
              clienteNome: { contains: range.fundKey, mode: "insensitive" as const },
            },
          ]),
        },
        select: {
          dataAnalise: true,
          descricao: true,
          historicoTraduzido: true,
          clienteId: true,
          clienteNome: true,
          entradas: true,
          saidas: true,
        },
      });
      return rows.flatMap((row) => {
        const text = normalize(`${row.clienteId} ${row.clienteNome}`);
        const range = ranges.find(
          (candidate) =>
            text.includes(normalize(candidate.fundKey)) &&
            row.dataAnalise >= candidate.start &&
            row.dataAnalise <= candidate.end
        );
        return range
          ? [
              {
                fundKey: range.fundKey,
                referenceDate: row.dataAnalise,
                descricao: row.descricao,
                historicoTraduzido: row.historicoTraduzido,
                clienteId: row.clienteId,
                entradas: row.entradas.toString(),
                saidas: row.saidas.toString(),
              },
            ]
          : [];
      });
    },
    async listVopSnapshots(fundIds) {
      if (fundIds.length === 0) return [];
      const rows = await prisma.fundVopSnapshot.findMany({
        where: { fundId: { in: fundIds } },
        select: {
          fundId: true,
          referenceDate: true,
          amount: true,
          operationCount: true,
          termWeightedValue: true,
          termWeightAmount: true,
          monthlyRateWeightedValue: true,
          monthlyRateWeightAmount: true,
          indicatorsCalculatedAt: true,
        },
      });
      return rows.map((row) => ({
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
      }));
    },
  };
}

export async function loadDashboardOverview(options?: {
  repository?: DashboardDataRepository;
}): Promise<DashboardOverview> {
  const repository = options?.repository ?? (await getPrismaRepository());
  const funds = sortFundsByDisplayPriority(await repository.listDashboardFunds());
  const fundKeys = Array.from(
    new Set(funds.map(resolveCarteiraFundKey).filter((key): key is string => key !== null))
  );
  const integratedFundIds = funds
    .filter((fund) => resolveVopFundKey(fund.name, fund.shortName) !== null)
    .map((fund) => fund.id);

  const [latestResult, snapshotsResult] = await Promise.allSettled([
    repository.listLatestCarteiraDates(fundKeys),
    repository.listVopSnapshots(integratedFundIds),
  ]);
  const latestDates = latestResult.status === "fulfilled" ? latestResult.value : [];
  const ranges = latestDates.map((row) => ({
    fundKey: row.fundKey,
    start: monthStart(row.referenceDate),
    end: row.referenceDate,
  }));
  const [carteirasResult, caixasResult] = await Promise.allSettled([
    repository.listCarteirasForRanges(ranges),
    repository.listCaixasForRanges(ranges),
  ]);
  const carteiras = carteirasResult.status === "fulfilled" ? carteirasResult.value : [];
  const caixas = caixasResult.status === "fulfilled" ? caixasResult.value : [];
  const latestByKey = new Map(latestDates.map((row) => [row.fundKey, row.referenceDate]));

  const dashboardFunds = funds.map<DashboardFundInput>((fund) => {
    const fundKey = resolveCarteiraFundKey(fund);
    const vopIntegrated = resolveVopFundKey(fund.name, fund.shortName) !== null;
    if (!fundKey || latestResult.status === "rejected" || carteirasResult.status === "rejected") {
      return emptyFinancials(fund, vopIntegrated);
    }
    const positionDate = latestByKey.get(fundKey);
    if (!positionDate) return emptyFinancials(fund, vopIntegrated);

    const fundCarteiras = carteiras.filter((row) => row.fundKey === fundKey);
    const latestRows = fundCarteiras.filter(
      (row) => dateKey(row.referenceDate) === dateKey(positionDate)
    );
    if (latestRows.length === 0) return emptyFinancials(fund, vopIntegrated);

    let seniorValue = 0;
    let mezzanineValue = 0;
    let juniorValue = 0;
    let dailyReturn = 0;
    let monthReturn = 0;
    let yearReturn = 0;
    for (const row of latestRows) {
      const value = Number(row.valor);
      const category = classifyCarteiraAtivo(row.ativo);
      if (category === "patrimonio") juniorValue += Math.abs(value);
      else if (category === "senior") seniorValue += Math.abs(value);
      else if (category === "mezzanine") mezzanineValue += Math.abs(value);
      else if (category === "variacao_diaria") dailyReturn += value;
      else if (category === "variacao_mensal") monthReturn += value;
      else if (category === "variacao_anual") yearReturn += value;
    }
    const monthlyReturnsByDate = new Map<string, number>();
    for (const row of fundCarteiras) {
      if (classifyCarteiraAtivo(row.ativo) !== "variacao_mensal") continue;
      addToMap(monthlyReturnsByDate, dateKey(row.referenceDate), Number(row.valor));
    }
    const monthlyReturnHistory = Array.from(monthlyReturnsByDate.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, value]) => ({
        referenceDate: new Date(`${date}T00:00:00.000Z`),
        value,
      }));
    const economicsStatus =
      caixasResult.status === "fulfilled" ? "ready" : "no_data";
    const averages =
      economicsStatus === "ready"
        ? calculateMonthlyAverages(
            fundCarteiras,
            caixas.filter((row) => row.fundKey === fundKey)
          )
        : calculateMonthlyAverages([], []);

    return {
      ...fund,
      positionDate,
      totalPl: seniorValue + mezzanineValue + juniorValue,
      seniorValue,
      mezzanineValue,
      juniorValue,
      dailyReturn,
      monthReturn,
      yearReturn,
      monthlyReturnHistory,
      ...averages,
      economicsStatus,
      vopIntegrated,
    };
  });

  return buildDashboardOverview({
    funds: dashboardFunds,
    snapshots:
      snapshotsResult.status === "fulfilled" ? snapshotsResult.value : [],
  });
}
