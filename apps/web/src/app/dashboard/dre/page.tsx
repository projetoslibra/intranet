import { Download } from "lucide-react";
import { prisma } from "@/lib/prisma";

type DrePageProps = {
  searchParams?: {
    fundId?: string;
    period?: string;
    from?: string;
    to?: string;
    view?: string;
  };
};

type DreRow = {
  label: string;
  kind?: "section" | "subtotal" | "pl";
  valueType?: "currency" | "decimal" | "percent";
  values?: Map<string, number>;
  isDelta?: boolean;
};

const assetClasses = {
  creditRights: "direitos_creditorios",
  otherFunds: "outros_fundos",
  senior: "senior",
  mezzanine: "mezanino",
  ntnb: "ntnb",
  pdd: "pdd",
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

function liabilityDeltaMap(
  dates: string[],
  values: Map<string, number>,
  redemptions: Map<string, number>
) {
  const result = new Map<string, number>();

  for (let index = 1; index < dates.length; index += 1) {
    const key = dates[index];
    const previousKey = dates[index - 1];
    result.set(
      key,
      (values.get(key) ?? 0) -
        (values.get(previousKey) ?? 0) +
        (redemptions.get(key) ?? 0)
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

function formatCellValue(row: DreRow, value: number | undefined) {
  if (row.isDelta && (value === undefined || Math.abs(value) < 0.005)) {
    return "—";
  }

  return formatValue(value, row.valueType);
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
  if (row.isDelta) {
    if (value === undefined || Math.abs(value) < 0.005) {
      return "text-slate-400";
    }

    return value > 0 ? "text-emerald-700" : "text-red-700";
  }

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
  const selectedView = searchParams?.view === "variacao" ? "variacao" : "carteira";
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

  const [positions, dreEntries, quotes, cashFlows] = await Promise.all([
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
    prisma.fundCashFlow.findMany({
      where: {
        fundId: selectedFund.id,
        flowDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        flowDate: true,
        flowType: true,
        assetClass: true,
        amount: true,
      },
    }),
  ]);

  const dateSet = new Set<string>();
  positions.forEach((position) => dateSet.add(dateKey(position.positionDate)));
  dreEntries.forEach((entry) => dateSet.add(dateKey(entry.referenceDate)));
  quotes.forEach((quote) => dateSet.add(dateKey(quote.quoteDate)));
  cashFlows.forEach((flow) => dateSet.add(dateKey(flow.flowDate)));
  const dates = Array.from(dateSet).sort();

  const creditRights = new Map<string, number>();
  const otherFunds = new Map<string, number>();
  const senior = new Map<string, number>();
  const mezzanine = new Map<string, number>();
  const ntnb = new Map<string, number>();
  const pddPositions = new Map<string, number>();
  const applicationsByAssetClass = new Map<string, Map<string, number>>();
  const redemptionsByAssetClass = new Map<string, Map<string, number>>();
  const expensesByCode = new Map<string, Map<string, number>>();
  const quoteMaps = {
    netAssetValue: new Map<string, number>(),
    sharesQuantity: new Map<string, number>(),
    quotaValue: new Map<string, number>(),
    dailyReturn: new Map<string, number>(),
    monthReturn: new Map<string, number>(),
    yearReturn: new Map<string, number>(),
  };

  for (const [code] of expenseRows) {
    expensesByCode.set(code, new Map<string, number>());
  }

  for (const position of positions) {
    const key = dateKey(position.positionDate);
    const assetClass = normalizeAssetClass(position.assetClass);
    const value = Number(position.netValue);

    if (assetClass === normalizeAssetClass(assetClasses.creditRights)) {
      addToMap(creditRights, key, value);
    } else if (assetClass === normalizeAssetClass(assetClasses.otherFunds)) {
      addToMap(otherFunds, key, value);
    } else if (assetClass === normalizeAssetClass(assetClasses.senior)) {
      addToMap(senior, key, value);
    } else if (assetClass === normalizeAssetClass(assetClasses.mezzanine)) {
      addToMap(mezzanine, key, value);
    } else if (assetClass === normalizeAssetClass(assetClasses.ntnb)) {
      addToMap(ntnb, key, value);
    } else if (assetClass === normalizeAssetClass(assetClasses.pdd)) {
      addToMap(pddPositions, key, value);
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

  for (const flow of cashFlows) {
    const key = dateKey(flow.flowDate);
    const assetClass = normalizeAssetClass(flow.assetClass);
    const target =
      flow.flowType === "resgate" ? redemptionsByAssetClass : applicationsByAssetClass;
    const map = target.get(assetClass) ?? new Map<string, number>();
    addToMap(map, key, Number(flow.amount));
    target.set(assetClass, map);
  }

  const cashFlowMap = (
    maps: Map<string, Map<string, number>>,
    assetClass: string
  ) => maps.get(normalizeAssetClass(assetClass)) ?? new Map<string, number>();
  const expenseMaps = expenseRows.map(([code]) => expensesByCode.get(code) ?? new Map());
  const expenseDeltaMaps = expenseRows.map(([code]) =>
    deltaMap(dates, expensesByCode.get(code) ?? new Map<string, number>())
  );

  const creditRightsDelta = assetDeltaMap(
    dates,
    creditRights,
    cashFlowMap(applicationsByAssetClass, assetClasses.creditRights),
    cashFlowMap(redemptionsByAssetClass, assetClasses.creditRights)
  );
  const otherFundsDelta = assetDeltaMap(
    dates,
    otherFunds,
    cashFlowMap(applicationsByAssetClass, assetClasses.otherFunds),
    cashFlowMap(redemptionsByAssetClass, assetClasses.otherFunds)
  );
  const ntnbDelta = deltaMap(dates, ntnb);
  const seniorDelta = liabilityDeltaMap(
    dates,
    senior,
    cashFlowMap(redemptionsByAssetClass, assetClasses.senior)
  );
  const mezzanineDelta = liabilityDeltaMap(
    dates,
    mezzanine,
    cashFlowMap(redemptionsByAssetClass, assetClasses.mezzanine)
  );
  const pddDelta = deltaMap(dates, pddPositions);

  const portfolioRows: DreRow[] = [
    { label: "ATIVOS", kind: "section" },
    { label: "Direitos Creditórios", values: creditRights },
    { label: "Outros Fundos Investidos", values: otherFunds },
    { label: "Renda Fixa — NTN-B", values: ntnb },
    {
      label: "Total Ativos",
      kind: "subtotal",
      values: sumMaps(dates, [creditRights, otherFunds, ntnb]),
    },
    { label: "SUPERIORES", kind: "section" },
    { label: "Cotas Sênior", values: senior },
    { label: "Cotas Mezanino", values: mezzanine },
    {
      label: "Total Superiores",
      kind: "subtotal",
      values: sumMaps(dates, [senior, mezzanine]),
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
      values: pddPositions,
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
  const variationRows: DreRow[] = [
    { label: "ATIVOS", kind: "section" },
    { label: "Direitos Creditórios", values: creditRightsDelta, isDelta: true },
    { label: "Outros Fundos Investidos", values: otherFundsDelta, isDelta: true },
    { label: "Renda Fixa — NTN-B", values: ntnbDelta, isDelta: true },
    {
      label: "Total Ativos",
      kind: "subtotal",
      values: sumMaps(dates, [creditRightsDelta, otherFundsDelta, ntnbDelta]),
      isDelta: true,
    },
    { label: "SUPERIORES", kind: "section" },
    { label: "Cotas Sênior", values: seniorDelta, isDelta: true },
    { label: "Cotas Mezanino", values: mezzanineDelta, isDelta: true },
    {
      label: "Total Superiores",
      kind: "subtotal",
      values: sumMaps(dates, [seniorDelta, mezzanineDelta]),
      isDelta: true,
    },
    { label: "DESPESAS OPERACIONAIS", kind: "section" },
    ...expenseRows.map(([code, label]) => ({
      label,
      values: deltaMap(dates, expensesByCode.get(code) ?? new Map<string, number>()),
      isDelta: true,
    })),
    {
      label: "Total Despesas",
      kind: "subtotal",
      values: sumMaps(dates, expenseDeltaMaps),
      isDelta: true,
    },
    { label: "RESULTADO", kind: "section" },
    {
      label: "PDD — Provisão para Devedores Duvidosos",
      values: pddDelta,
      isDelta: true,
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
  const rows = selectedView === "variacao" ? variationRows : portfolioRows;
  const viewHref = (view: "carteira" | "variacao") => {
    const params = new URLSearchParams();
    params.set("fundId", selectedFund.id);
    params.set("period", period);
    params.set("from", dateKey(startDate));
    params.set("to", dateKey(endDate));
    params.set("view", view);
    return `/dashboard/dre?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
        <form className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_190px_160px_160px_auto] lg:items-end">
          <input name="view" type="hidden" value={selectedView} />
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

        <div className="flex border-b border-slate-200 px-5 pt-3">
          {[
            ["carteira", "Carteira"],
            ["variacao", "DRE / Variação"],
          ].map(([view, label]) => (
            <a
              className={`border-b-2 px-4 py-2 text-sm font-semibold transition ${
                selectedView === view
                  ? "border-primary text-primary"
                  : "border-transparent text-slate-500 hover:text-slate-900"
              }`}
              href={viewHref(view as "carteira" | "variacao")}
              key={view}
            >
              {label}
            </a>
          ))}
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
                          {row.kind === "section" ? "" : formatCellValue(row, value)}
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
