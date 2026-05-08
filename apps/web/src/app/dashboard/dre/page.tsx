import { Download } from "lucide-react";
import { prisma } from "@/lib/prisma";

type DrePageProps = {
  searchParams?: {
    fundId?: string;
    period?: string;
    from?: string;
    to?: string;
  };
};

type DreRow = {
  label: string;
  kind?: "section" | "subtotal" | "pl";
  valueType?: "currency" | "decimal" | "percent";
  values?: Map<string, number>;
};

const assetClasses = {
  investedFunds: "OutrosFundos",
  srp: "SRP",
  mezan: "MEZAN",
  ntnb: "NTN-B",
};

const expenseRows = [
  ["taxa_gestao", "Taxa de Gestão"],
  ["taxa_administracao", "Taxa de Administração"],
  ["taxa_custodia", "Taxa de Custódia"],
  ["auditoria", "Auditoria"],
  ["servicos_cobranca", "Serviços de Cobrança"],
  ["iof", "IOF"],
  ["cetip", "CETIP"],
  ["selic", "SELIC"],
  ["consultoria", "Consultoria"],
  ["rating", "Rating"],
  ["outras_despesas", "Outras Despesas"],
] as const;

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const decimalFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 6,
  maximumFractionDigits: 6,
});

const percentFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const dateHeaderFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseInputDate(value?: string) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function startOfUtcMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function endOfUtcMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0));
}

function getPeriodRange(searchParams?: DrePageProps["searchParams"]) {
  const today = new Date();
  const currentDay = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  const period = searchParams?.period ?? "last30";

  if (period === "last7") {
    return { period, startDate: addDays(currentDay, -6), endDate: currentDay };
  }

  if (period === "currentMonth") {
    return {
      period,
      startDate: startOfUtcMonth(currentDay),
      endDate: currentDay,
    };
  }

  if (period === "previousMonth") {
    const previousMonth = new Date(
      Date.UTC(currentDay.getUTCFullYear(), currentDay.getUTCMonth() - 1, 1)
    );

    return {
      period,
      startDate: startOfUtcMonth(previousMonth),
      endDate: endOfUtcMonth(previousMonth),
    };
  }

  if (period === "custom") {
    return {
      period,
      startDate: parseInputDate(searchParams?.from) ?? addDays(currentDay, -29),
      endDate: parseInputDate(searchParams?.to) ?? currentDay,
    };
  }

  return { period: "last30", startDate: addDays(currentDay, -29), endDate: currentDay };
}

function addToMap(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
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

function formatValue(value: number | undefined, valueType: DreRow["valueType"]) {
  const safeValue = value ?? 0;

  if (valueType === "decimal") {
    return decimalFormatter.format(safeValue);
  }

  if (valueType === "percent") {
    return `${percentFormatter.format(safeValue)}%`;
  }

  return currencyFormatter.format(safeValue);
}

function formatDateHeader(key: string) {
  return dateHeaderFormatter.format(new Date(`${key}T00:00:00.000Z`));
}

function normalizeAssetClass(value: string) {
  return value.trim().toUpperCase();
}

function rowClassName(row: DreRow) {
  if (row.kind === "section") {
    return "bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600";
  }

  if (row.kind === "subtotal") {
    return "border-t-2 border-slate-300 bg-white font-bold text-slate-950";
  }

  if (row.kind === "pl") {
    return "bg-emerald-50 font-bold text-emerald-900";
  }

  return "bg-white text-slate-700";
}

function valueClassName(row: DreRow, value: number | undefined) {
  if (row.valueType === "percent") {
    if ((value ?? 0) > 0) {
      return "text-emerald-700";
    }

    if ((value ?? 0) < 0) {
      return "text-red-700";
    }
  }

  return "";
}

export default async function DrePage({ searchParams }: DrePageProps) {
  const { period, startDate, endDate } = getPeriodRange(searchParams);
  const funds = await prisma.fund.findMany({
    where: {
      status: "ACTIVE",
    },
    orderBy: {
      name: "asc",
    },
    select: {
      id: true,
      name: true,
      shortName: true,
    },
  });

  const selectedFund =
    funds.find((fund) => fund.id === searchParams?.fundId) ?? funds[0];

  if (!selectedFund) {
    return (
      <section className="rounded border border-slate-200 bg-white p-6 shadow-executive">
        <h2 className="text-lg font-semibold text-slate-950">DRE dos Fundos</h2>
        <p className="mt-2 text-sm text-slate-500">
          Nenhum fundo ativo encontrado para exibir a DRE.
        </p>
      </section>
    );
  }

  const [positions, dreEntries, quotes] = await Promise.all([
    prisma.financialPosition.findMany({
      where: {
        fundId: selectedFund.id,
        positionDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        positionDate: true,
        assetClass: true,
        netValue: true,
      },
    }),
    prisma.dreEntry.findMany({
      where: {
        fundId: selectedFund.id,
        referenceDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        referenceDate: true,
        amount: true,
        account: {
          select: {
            code: true,
          },
        },
      },
    }),
    prisma.fundQuote.findMany({
      where: {
        fundId: selectedFund.id,
        quoteDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: {
        quoteDate: "asc",
      },
      select: {
        quoteDate: true,
        netAssetValue: true,
        sharesQuantity: true,
        quotaValue: true,
        dailyReturn: true,
        monthReturn: true,
        yearReturn: true,
      },
    }),
  ]);

  const dateSet = new Set<string>();
  positions.forEach((position) => dateSet.add(dateKey(position.positionDate)));
  dreEntries.forEach((entry) => dateSet.add(dateKey(entry.referenceDate)));
  quotes.forEach((quote) => dateSet.add(dateKey(quote.quoteDate)));
  const dates = Array.from(dateSet).sort();

  const investedFunds = new Map<string, number>();
  const srp = new Map<string, number>();
  const mezan = new Map<string, number>();
  const ntnb = new Map<string, number>();
  const otherAssets = new Map<string, number>();
  const pddPositions = new Map<string, number>();
  const expensesByCode = new Map<string, Map<string, number>>();
  const quoteMaps = {
    netAssetValue: new Map<string, number>(),
    sharesQuantity: new Map<string, number>(),
    quotaValue: new Map<string, number>(),
    dailyReturn: new Map<string, number>(),
    monthReturn: new Map<string, number>(),
    yearReturn: new Map<string, number>(),
  };

  for (const [code] of [...expenseRows, ["pdd", "PDD"] as const]) {
    expensesByCode.set(code, new Map<string, number>());
  }

  for (const position of positions) {
    const key = dateKey(position.positionDate);
    const assetClass = normalizeAssetClass(position.assetClass);
    const value = Number(position.netValue);

    if (assetClass === normalizeAssetClass(assetClasses.investedFunds)) {
      addToMap(investedFunds, key, value);
    } else if (assetClass === normalizeAssetClass(assetClasses.srp)) {
      addToMap(srp, key, value);
    } else if (assetClass === normalizeAssetClass(assetClasses.mezan)) {
      addToMap(mezan, key, value);
    } else if (assetClass === normalizeAssetClass(assetClasses.ntnb)) {
      addToMap(ntnb, key, value);
    } else if (assetClass === "PDD" || assetClass === "PDDDIR") {
      addToMap(pddPositions, key, value);
    } else {
      addToMap(otherAssets, key, value);
    }
  }

  for (const entry of dreEntries) {
    const key = dateKey(entry.referenceDate);
    const code = entry.account.code;
    const map = expensesByCode.get(code) ?? new Map<string, number>();
    addToMap(map, key, Number(entry.amount));
    expensesByCode.set(code, map);
  }

  for (const quote of quotes) {
    const key = dateKey(quote.quoteDate);
    quoteMaps.netAssetValue.set(key, Number(quote.netAssetValue));
    quoteMaps.sharesQuantity.set(key, Number(quote.sharesQuantity));
    quoteMaps.quotaValue.set(key, Number(quote.quotaValue));
    quoteMaps.dailyReturn.set(key, Number(quote.dailyReturn));
    quoteMaps.monthReturn.set(key, Number(quote.monthReturn));
    quoteMaps.yearReturn.set(key, Number(quote.yearReturn));
  }

  const expenseMaps = expenseRows.map(([code]) => expensesByCode.get(code) ?? new Map());
  const pddEntries = expensesByCode.get("pdd") ?? new Map<string, number>();

  const rows: DreRow[] = [
    { label: "ATIVOS", kind: "section" },
    { label: "Fundos Investidos", values: investedFunds },
    { label: "Renda Fixa — SRP", values: srp },
    { label: "Renda Fixa — MEZAN", values: mezan },
    { label: "Renda Fixa — NTN-B", values: ntnb },
    { label: "Outros Ativos", values: otherAssets },
    {
      label: "Total Ativos",
      kind: "subtotal",
      values: sumMaps(dates, [investedFunds, srp, mezan, ntnb, otherAssets]),
    },
    { label: "DESPESAS OPERACIONAIS", kind: "section" },
    ...expenseRows.map(([code, label]) => ({
      label,
      values: expensesByCode.get(code) ?? new Map<string, number>(),
    })),
    {
      label: "Total Despesas",
      kind: "subtotal",
      values: sumMaps(dates, expenseMaps),
    },
    { label: "RESULTADO", kind: "section" },
    {
      label: "PDD — Provisão para Devedores Duvidosos",
      values: sumMaps(dates, [pddPositions, pddEntries]),
    },
    {
      label: "Patrimônio Líquido",
      kind: "pl",
      values: quoteMaps.netAssetValue,
    },
    { label: "COTAS", kind: "section" },
    {
      label: "Quantidade de Cotas",
      valueType: "decimal",
      values: quoteMaps.sharesQuantity,
    },
    {
      label: "Valor da Cota",
      valueType: "decimal",
      values: quoteMaps.quotaValue,
    },
    {
      label: "Rentabilidade Diária %",
      valueType: "percent",
      values: quoteMaps.dailyReturn,
    },
    {
      label: "Rentabilidade Mensal %",
      valueType: "percent",
      values: quoteMaps.monthReturn,
    },
    {
      label: "Rentabilidade Anual %",
      valueType: "percent",
      values: quoteMaps.yearReturn,
    },
  ];

  const hasData = dates.length > 0;

  return (
    <div className="space-y-6">
      <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
        <form className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_190px_160px_160px_auto] lg:items-end">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="fundId">
              Fundo
            </label>
            <select
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              defaultValue={selectedFund.id}
              id="fundId"
              name="fundId"
            >
              {funds.map((fund) => (
                <option key={fund.id} value={fund.id}>
                  {fund.shortName || fund.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="period">
              Período
            </label>
            <select
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              defaultValue={period}
              id="period"
              name="period"
            >
              <option value="last7">Últimos 7 dias</option>
              <option value="last30">Últimos 30 dias</option>
              <option value="currentMonth">Mês atual</option>
              <option value="previousMonth">Mês anterior</option>
              <option value="custom">Personalizado</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="from">
              De
            </label>
            <input
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              defaultValue={dateKey(startDate)}
              id="from"
              name="from"
              type="date"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="to">
              Até
            </label>
            <input
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              defaultValue={dateKey(endDate)}
              id="to"
              name="to"
              type="date"
            />
          </div>

          <div className="flex gap-2">
            <button
              className="h-10 rounded bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
              type="submit"
            >
              Aplicar
            </button>
            <button
              className="inline-flex h-10 items-center gap-2 rounded border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              type="button"
            >
              <Download className="h-4 w-4" />
              Exportar Excel
            </button>
          </div>
        </form>
      </section>

      <section className="rounded border border-slate-200 bg-white shadow-executive">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">
            DRE dos Fundos
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {selectedFund.name} · {dateKey(startDate)} a {dateKey(endDate)}
          </p>
        </div>

        {!hasData ? (
          <p className="px-5 py-8 text-sm text-slate-500">
            Nenhum dado encontrado para o período selecionado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="sticky left-0 z-20 min-w-[220px] border-r border-slate-200 bg-slate-50 px-4 py-3 text-left font-semibold">
                    Conta / Indicador
                  </th>
                  {dates.map((key) => (
                    <th
                      className="min-w-[130px] px-4 py-3 text-right font-semibold"
                      key={key}
                    >
                      {formatDateHeader(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr className={rowClassName(row)} key={row.label}>
                    <td
                      className={`sticky left-0 z-10 min-w-[220px] border-r border-slate-200 px-4 py-3 text-left ${rowClassName(row)}`}
                    >
                      {row.label}
                    </td>
                    {dates.map((key) => {
                      const value = row.values?.get(key);

                      return (
                        <td
                          className={`min-w-[130px] px-4 py-3 text-right ${valueClassName(row, value)}`}
                          key={key}
                        >
                          {row.kind === "section"
                            ? ""
                            : formatValue(value, row.valueType)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
