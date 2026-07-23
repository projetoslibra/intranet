import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const percentFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

type FundDashboardData = {
  id: string;
  name: string;
  cnpj: string;
  dataLabel: string;
  averageMonthlyRevenue: number;
  averageMonthlyCost: number;
  monthlyRevenueTotal: number;
  monthlyCostTotal: number;
  monthlyPeriods: number;
  seniorValue: number;
  mezzanineValue: number;
  juniorValue: number;
  totalPl: number;
  dailyReturn: number;
  monthReturn: number;
  yearReturn: number;
};

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

function normalizeCarteiraAtivo(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function classifyCarteiraAtivo(value: string) {
  const ativo = normalizeCarteiraAtivo(value);

  if (ativo === "PATRIMONIO") {
    return "patrimonio";
  }

  if (ativo === "VARIACAO DIARIA") {
    return "variacao_diaria";
  }

  if (ativo === "VARIACAO MENSAL") {
    return "variacao_mensal";
  }

  if (ativo === "VARIACAO ANUAL") {
    return "variacao_anual";
  }

  if (ativo.includes("PDD")) {
    return "pdd";
  }

  if (ativo === "SRP" || ativo.includes("SENIOR")) {
    return "senior";
  }

  if (ativo === "MEZAN" || ativo.includes("MEZANINO")) {
    return "mezzanine";
  }

  if (
    ativo.includes("A VENCER") ||
    ativo.includes("VENCIDOS") ||
    ativo === "DIR"
  ) {
    return "creditRights";
  }

  if (
    ativo.includes("NTN") ||
    ativo.includes("LFT") ||
    ativo.includes("SELIC")
  ) {
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

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function monthStart(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function addToMap(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function sumMapValuesForDates(map: Map<string, number>, dates: string[]) {
  return dates.reduce((total, key) => total + (map.get(key) ?? 0), 0);
}

function sumPositiveMapValuesForDates(map: Map<string, number>, dates: string[]) {
  return dates.reduce((total, key) => {
    const value = map.get(key) ?? 0;

    return value > 0 ? total + value : total;
  }, 0);
}

function sumNegativeMapValuesForDates(map: Map<string, number>, dates: string[]) {
  return dates.reduce((total, key) => {
    const value = map.get(key) ?? 0;

    return value < 0 ? total + value : total;
  }, 0);
}

function sumMaps(dates: string[], maps: Array<Map<string, number>>) {
  const result = new Map<string, number>();

  for (const key of dates) {
    result.set(
      key,
      maps.reduce((total, map) => total + (map.get(key) ?? 0), 0)
    );
  }

  return result;
}

function deltaMap(dates: string[], values: Map<string, number>) {
  const result = new Map<string, number>();

  for (let index = 1; index < dates.length; index += 1) {
    const key = dates[index];
    const previousKey = dates[index - 1];
    result.set(key, (values.get(key) ?? 0) - (values.get(previousKey) ?? 0));
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

function caixaFlowType(value: string) {
  const descricao = normalizeCarteiraAtivo(value);

  if (descricao.startsWith("APLICACAO NO FUNDO")) {
    return "aplicacao";
  }

  if (descricao.startsWith("RESGATE DO FUNDO")) {
    return "resgate";
  }

  return null;
}

function classifyCaixaAssetClass(
  descricao: string,
  historicoTraduzido: string | null,
  clienteId: string
) {
  const text = normalizeCarteiraAtivo(
    `${descricao} ${historicoTraduzido ?? ""} ${clienteId}`
  );

  if (
    text.includes("MZ") ||
    text.includes("MEZ") ||
    text.includes("MEZAN") ||
    text.includes("MEZANINO")
  ) {
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

function calculateMonthlyAverages(params: {
  carteiras: Array<{
    ativo: string;
    valor: unknown;
    dataAnalise: Date;
  }>;
  caixas: Array<{
    dataAnalise: Date;
    descricao: string;
    historicoTraduzido: string | null;
    clienteId: string;
    entradas: unknown;
    saidas: unknown;
  }>;
}) {
  const dateSet = new Set<string>();
  const creditRights = new Map<string, number>();
  const senior = new Map<string, number>();
  const mezzanine = new Map<string, number>();
  const expenses = new Map<string, number>();
  const applicationsByAssetClass = new Map<string, Map<string, number>>();
  const redemptionsByAssetClass = new Map<string, Map<string, number>>();

  for (const carteira of params.carteiras) {
    const key = dateKey(carteira.dataAnalise);
    const value = Number(carteira.valor);
    const category = classifyCarteiraAtivo(carteira.ativo);
    dateSet.add(key);

    if (category === "creditRights") {
      addToMap(creditRights, key, value);
    } else if (category === "senior") {
      addToMap(senior, key, value);
    } else if (category === "mezzanine") {
      addToMap(mezzanine, key, value);
    } else if (category === "expense") {
      addToMap(expenses, key, value);
    }
  }

  for (const caixa of params.caixas) {
    const flowType = caixaFlowType(caixa.descricao);

    if (!flowType) {
      continue;
    }

    const key = dateKey(caixa.dataAnalise);
    const assetClass = classifyCaixaAssetClass(
      caixa.descricao,
      caixa.historicoTraduzido,
      caixa.clienteId
    );
    const amount =
      flowType === "aplicacao"
        ? Math.abs(Number(caixa.saidas))
        : Math.abs(Number(caixa.entradas));

    if (amount === 0) {
      continue;
    }

    dateSet.add(key);
    const target =
      flowType === "resgate" ? redemptionsByAssetClass : applicationsByAssetClass;
    const map = target.get(assetClass) ?? new Map<string, number>();
    addToMap(map, key, amount);
    target.set(assetClass, map);
  }

  const dates = Array.from(dateSet).sort();
  const calculationDates = dates.slice(1, -1);
  const periods = calculationDates.length;

  if (periods === 0) {
    return {
      averageMonthlyRevenue: 0,
      averageMonthlyCost: 0,
      monthlyRevenueTotal: 0,
      monthlyCostTotal: 0,
      monthlyPeriods: 0,
    };
  }

  const applications = (assetClass: string) =>
    applicationsByAssetClass.get(assetClass) ?? new Map<string, number>();
  const redemptions = (assetClass: string) =>
    redemptionsByAssetClass.get(assetClass) ?? new Map<string, number>();
  const revenueByDate = sumMaps(dates, [
    creditRightsDeltaMap(
      dates,
      creditRights,
      applications("creditRights"),
      redemptions("creditRights")
    ),
  ]);
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
  const monthlyRevenueTotal = sumPositiveMapValuesForDates(
    revenueByDate,
    calculationDates
  );
  const monthlySuperiorTotal = sumMapValuesForDates(
    sumMaps(dates, [seniorDelta, mezzanineDelta]),
    calculationDates
  );
  const monthlyExpenseTotal = sumNegativeMapValuesForDates(
    expensesDelta,
    calculationDates
  );
  const monthlyCostTotal = -(monthlySuperiorTotal + monthlyExpenseTotal);

  return {
    averageMonthlyRevenue: monthlyRevenueTotal / periods,
    averageMonthlyCost: monthlyCostTotal / periods,
    monthlyRevenueTotal,
    monthlyCostTotal,
    monthlyPeriods: periods,
  };
}

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function formatReturn(value: number) {
  return `${percentFormatter.format(value)}%`;
}

function formatShare(value: number, total: number) {
  if (total === 0) {
    return "0,0000%";
  }

  return `${percentFormatter.format((value / total) * 100)}%`;
}

function returnClassName(value: number) {
  if (value > 0) {
    return "text-[#0F6E56]";
  }

  if (value < 0) {
    return "text-[#993C1D]";
  }

  return "text-slate-500";
}

export default async function DashboardPage() {
  const canView = await hasPermission("dashboard.view");

  if (!canView) {
    return (
      <section className="rounded border border-slate-200 bg-white p-6 shadow-executive">
        <h2 className="text-lg font-semibold text-slate-950">Dashboard</h2>
        <p className="mt-2 text-sm text-slate-500">
          Voce nao tem permissao para visualizar o dashboard.
        </p>
      </section>
    );
  }

  const activeFunds = await prisma.fund.findMany({
    where: {
      status: "ACTIVE",
      cnpj: {
        not: "00.000.000/0001-00",
      },
    },
    orderBy: {
      name: "asc",
    },
    select: {
      id: true,
      name: true,
      cnpj: true,
      shortName: true,
    },
  });

  const fundsData = await Promise.all(
    activeFunds.map(async (fund) => {
      const carteiraFundo = resolveCarteiraFundo(fund);
      const latestCarteira = carteiraFundo
        ? await prisma.carteira.findFirst({
            where: { fundo: carteiraFundo },
            orderBy: { dataAnalise: "desc" },
            select: { dataAnalise: true },
          })
        : null;
      const carteiras =
        carteiraFundo && latestCarteira
          ? await prisma.carteira.findMany({
              where: {
                fundo: carteiraFundo,
                dataAnalise: latestCarteira.dataAnalise,
              },
              select: {
                ativo: true,
                valor: true,
              },
            })
          : [];
      const monthlyStart = latestCarteira ? monthStart(latestCarteira.dataAnalise) : null;
      const [monthlyCarteiras, monthlyCaixas] =
        carteiraFundo && latestCarteira && monthlyStart
          ? await Promise.all([
              prisma.carteira.findMany({
                where: {
                  fundo: carteiraFundo,
                  dataAnalise: {
                    gte: monthlyStart,
                    lte: latestCarteira.dataAnalise,
                  },
                },
                select: {
                  ativo: true,
                  valor: true,
                  dataAnalise: true,
                },
              }),
              prisma.caixaSingulare.findMany({
                where: {
                  dataAnalise: {
                    gte: monthlyStart,
                    lte: latestCarteira.dataAnalise,
                  },
                  OR: [
                    { clienteId: { contains: carteiraFundo, mode: "insensitive" } },
                    { clienteNome: { contains: carteiraFundo, mode: "insensitive" } },
                  ],
                },
                select: {
                  dataAnalise: true,
                  descricao: true,
                  historicoTraduzido: true,
                  clienteId: true,
                  entradas: true,
                  saidas: true,
                },
              }),
            ])
          : [[], []];
      const monthlyAverages = calculateMonthlyAverages({
        carteiras: monthlyCarteiras,
        caixas: monthlyCaixas,
      });

      let seniorValue = 0;
      let mezzanineValue = 0;
      let juniorValue = 0;
      let dailyReturn = 0;
      let monthReturn = 0;
      let yearReturn = 0;

      for (const carteira of carteiras) {
        const value = Number(carteira.valor);
        const category = classifyCarteiraAtivo(carteira.ativo);

        if (category === "patrimonio") {
          juniorValue += Math.abs(value);
        } else if (category === "senior") {
          seniorValue += Math.abs(value);
        } else if (category === "mezzanine") {
          mezzanineValue += Math.abs(value);
        } else if (category === "variacao_diaria") {
          dailyReturn += value;
        } else if (category === "variacao_mensal") {
          monthReturn += value;
        } else if (category === "variacao_anual") {
          yearReturn += value;
        }
      }

      const totalPl = seniorValue + mezzanineValue + juniorValue;

      return {
        id: fund.id,
        name: fund.name,
        cnpj: fund.cnpj,
        dataLabel: latestCarteira
          ? `Dados de ${dateFormatter.format(latestCarteira.dataAnalise)}`
          : "Sem dados na CARTEIRAS",
        ...monthlyAverages,
        seniorValue,
        mezzanineValue,
        juniorValue,
        totalPl,
        dailyReturn,
        monthReturn,
        yearReturn,
      };
    })
  );

  const consolidatedPl = fundsData.reduce((total, fund) => total + fund.totalPl, 0);

  const kpis = [
    {
      label: "PL Total Consolidado",
      value: formatCurrency(consolidatedPl),
    },
    {
      label: "Fundos ativos",
      value: String(activeFunds.length),
    },
  ];

  return (
    <div className="space-y-7">
      <section className="grid gap-4 md:grid-cols-2">
        {kpis.map((kpi) => (
          <article
            className="rounded-lg p-5"
            key={kpi.label}
            style={{ background: "var(--color-background-secondary, #f8fafc)" }}
          >
            <p className="text-sm font-medium text-slate-500">{kpi.label}</p>
            <p className="mt-3 text-2xl font-semibold tracking-normal text-slate-950">
              {kpi.value}
            </p>
          </article>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        {fundsData.map((fund) => (
          <article
            className="bg-white p-5"
            key={fund.id}
            style={{
              border: "0.5px solid var(--color-border-tertiary, #cbd5e1)",
              borderRadius: "var(--border-radius-lg, 0.5rem)",
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-950">
                  {fund.name}
                </h2>
                <p className="mt-1 text-sm text-slate-500">{fund.cnpj}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="rounded bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-[#0F6E56]">
                  ATIVO
                </span>
                <span className="text-xs font-medium text-slate-500">
                  {fund.dataLabel}
                </span>
              </div>
            </div>

            <div className="mt-6">
              <p className="text-sm font-medium text-slate-500">
                Patrimônio Total
              </p>
              <p className="mt-2 text-3xl font-semibold tracking-normal text-slate-950">
                {formatCurrency(fund.totalPl)}
              </p>
            </div>

            <div className="mt-6 grid grid-cols-3 overflow-hidden border-y border-slate-200">
              {[
                ["Sênior", fund.seniorValue],
                ["Mezanino", fund.mezzanineValue],
                ["Júnior", fund.juniorValue],
              ].map(([label, value], index) => (
                <div
                  className={`py-4 ${index > 0 ? "border-l border-slate-200 pl-4" : "pr-4"}`}
                  key={label}
                >
                  <p className="text-xs font-semibold uppercase text-slate-500">
                    {label}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-slate-950">
                    {formatCurrency(Number(value))}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatShare(Number(value), fund.totalPl)}
                  </p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3">
              {[
                ["Rent. diária", fund.dailyReturn],
                ["Rent. mensal", fund.monthReturn],
                ["Rent. anual", fund.yearReturn],
              ].map(([label, value], index) => (
                <div
                  className={`pt-4 ${index > 0 ? "border-l border-slate-200 pl-4" : "pr-4"}`}
                  key={label}
                >
                  <p className="text-xs font-semibold uppercase text-slate-500">
                    {label}
                  </p>
                  <p
                    className={`mt-2 text-sm font-semibold ${returnClassName(Number(value))}`}
                  >
                    {formatReturn(Number(value))}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-3 border-t border-slate-200 pt-4 md:grid-cols-2">
              {[
                [
                  "Receita media do mes",
                  fund.averageMonthlyRevenue,
                  fund.monthlyRevenueTotal,
                ],
                [
                  "Custo medio do mes",
                  fund.averageMonthlyCost,
                  fund.monthlyCostTotal,
                ],
              ].map(([label, average, total]) => (
                <div className="rounded border border-slate-200 p-4" key={label}>
                  <p className="text-xs font-semibold uppercase text-slate-500">
                    {label}
                  </p>
                  <p className="mt-2 text-lg font-semibold tracking-normal text-slate-950">
                    {formatCurrency(Number(average))}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Total {formatCurrency(Number(total))} / {fund.monthlyPeriods} periodos
                  </p>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
