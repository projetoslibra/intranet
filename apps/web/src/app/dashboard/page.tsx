import { prisma } from "@/lib/prisma";

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
  seniorValue: number;
  mezzanineValue: number;
  juniorValue: number;
  totalPl: number;
  dailyReturn: number;
  monthReturn: number;
  yearReturn: number;
};

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

function weightedAverage(
  funds: FundDashboardData[],
  field: "dailyReturn" | "monthReturn"
) {
  const weightedTotal = funds.reduce(
    (total, fund) => total + fund[field] * fund.totalPl,
    0
  );
  const totalPl = funds.reduce((total, fund) => total + fund.totalPl, 0);

  return totalPl === 0 ? 0 : weightedTotal / totalPl;
}

export default async function DashboardPage() {
  const activeFunds = await prisma.fund.findMany({
    where: {
      status: "ACTIVE",
    },
    orderBy: {
      name: "asc",
    },
    select: {
      id: true,
      name: true,
      cnpj: true,
    },
  });

  const fundsData = await Promise.all(
    activeFunds.map(async (fund) => {
      const [latestQuote, seniorPosition, mezzaninePosition] = await Promise.all([
        prisma.fundQuote.findFirst({
          where: { fundId: fund.id },
          orderBy: { quoteDate: "desc" },
        }),
        prisma.financialPosition.findFirst({
          where: { fundId: fund.id, assetClass: "senior" },
          orderBy: { positionDate: "desc" },
        }),
        prisma.financialPosition.findFirst({
          where: { fundId: fund.id, assetClass: "mezanino" },
          orderBy: { positionDate: "desc" },
        }),
      ]);

      const seniorValue = Math.abs(Number(seniorPosition?.netValue ?? 0));
      const mezzanineValue = Math.abs(Number(mezzaninePosition?.netValue ?? 0));
      const juniorValue = Number(latestQuote?.netAssetValue ?? 0);
      const totalPl = seniorValue + mezzanineValue + juniorValue;

      return {
        id: fund.id,
        name: fund.name,
        cnpj: fund.cnpj,
        dataLabel: latestQuote
          ? `Dados de ${dateFormatter.format(latestQuote.quoteDate)}`
          : "Sem dados de cota",
        seniorValue,
        mezzanineValue,
        juniorValue,
        totalPl,
        dailyReturn: Number(latestQuote?.dailyReturn ?? 0),
        monthReturn: Number(latestQuote?.monthReturn ?? 0),
        yearReturn: Number(latestQuote?.yearReturn ?? 0),
      };
    })
  );

  const consolidatedPl = fundsData.reduce((total, fund) => total + fund.totalPl, 0);
  const averageDailyReturn = weightedAverage(fundsData, "dailyReturn");
  const averageMonthReturn = weightedAverage(fundsData, "monthReturn");

  const kpis = [
    {
      label: "PL Total Consolidado",
      value: formatCurrency(consolidatedPl),
    },
    {
      label: "Rent. diária média",
      value: formatReturn(averageDailyReturn),
    },
    {
      label: "Rent. mensal média",
      value: formatReturn(averageMonthReturn),
    },
    {
      label: "Fundos ativos",
      value: String(activeFunds.length),
    },
  ];

  return (
    <div className="space-y-7">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
                Patrimônio Líquido
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
          </article>
        ))}
      </section>
    </div>
  );
}
