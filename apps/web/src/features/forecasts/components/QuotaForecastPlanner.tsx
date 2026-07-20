"use client";

import { useMemo, useState } from "react";
import { Info } from "lucide-react";

type FundOption = {
  id: string;
  name: string;
  shortName: string;
};

type HistoricalRow = {
  date: string;
  patrimonio: number;
  creditRights: number;
  creditRightsVariation: number;
  pdd: number;
  variacaoMensal: number;
  variacaoAnual: number;
};

type ForecastInput = {
  pddDelta: number;
};

type QuotaForecastPlannerProps = {
  funds: FundOption[];
  selectedFundId: string;
  historicalRows: HistoricalRow[];
  baseShareQuantity: number;
};

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

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseDateKey(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function isBusinessDay(value: Date) {
  const day = value.getUTCDay();
  return day !== 0 && day !== 6;
}

function nextBusinessDay(value: Date) {
  let date = addDays(value, 1);

  while (!isBusinessDay(date)) {
    date = addDays(date, 1);
  }

  return date;
}

function buildFutureDates(startKey: string | null, endKey: string) {
  if (!startKey || !endKey) {
    return [];
  }

  const result: string[] = [];
  let cursor = nextBusinessDay(parseDateKey(startKey));
  const end = parseDateKey(endKey);

  while (cursor <= end) {
    if (isBusinessDay(cursor)) {
      result.push(dateKey(cursor));
    }

    cursor = addDays(cursor, 1);
  }

  return result;
}

function formatDate(value: string) {
  return dateFormatter.format(parseDateKey(value));
}

function toInputNumber(value: string) {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function formatSignedCurrency(value: number) {
  if (Math.abs(value) < 0.005) {
    return currencyFormatter.format(0);
  }

  return `${value > 0 ? "+" : ""}${currencyFormatter.format(value)}`;
}

function calculateAverageCreditRightsRevenue(rows: HistoricalRow[]) {
  const lastDeltas = rows
    .slice(1)
    .map((row) => row.creditRightsVariation)
    .slice(-15);

  if (lastDeltas.length === 0) {
    return 0;
  }

  return lastDeltas.reduce((total, value) => total + value, 0) / lastDeltas.length;
}

export function QuotaForecastPlanner({
  funds,
  selectedFundId,
  historicalRows,
  baseShareQuantity,
}: QuotaForecastPlannerProps) {
  const lastHistorical = historicalRows.at(-1) ?? null;
  const defaultViewDate = lastHistorical
    ? dateKey(addDays(parseDateKey(lastHistorical.date), 10))
    : dateKey(new Date());
  const [viewDate, setViewDate] = useState(defaultViewDate);
  const [shareQuantity, setShareQuantity] = useState(baseShareQuantity);
  const [inputs, setInputs] = useState<Record<string, ForecastInput>>({});
  const averageCreditRightsRevenue = useMemo(
    () => calculateAverageCreditRightsRevenue(historicalRows),
    [historicalRows]
  );
  const lastPatrimonio = lastHistorical?.patrimonio ?? 0;
  const lastCreditRights = lastHistorical?.creditRights ?? 0;
  const lastPdd = lastHistorical?.pdd ?? 0;
  const lastMonthlyReturn = lastHistorical?.variacaoMensal ?? 0;
  const lastYearlyReturn = lastHistorical?.variacaoAnual ?? 0;

  const futureDates = useMemo(
    () => buildFutureDates(lastHistorical?.date ?? null, viewDate),
    [lastHistorical?.date, viewDate]
  );

  const projections = useMemo(() => {
    let previousPl = lastPatrimonio;
    let previousCreditRights = lastCreditRights;
    let previousPdd = lastPdd;
    const quantity = shareQuantity > 0 ? shareQuantity : 0;
    let previousReturnBase =
      quantity > 0 ? lastPatrimonio / quantity : lastPatrimonio;
    const baseReturnValue = previousReturnBase;
    const baseMonthReturn = lastMonthlyReturn / 100;
    const baseYearReturn = lastYearlyReturn / 100;

    return futureDates.map((date) => {
      const input = inputs[date] ?? { pddDelta: 0 };
      previousCreditRights += averageCreditRightsRevenue;
      previousPdd -= input.pddDelta;
      previousPl = previousPl + averageCreditRightsRevenue - input.pddDelta;
      const quotaValue = quantity > 0 ? previousPl / quantity : 0;
      const returnBase = quantity > 0 ? quotaValue : previousPl;
      const dailyReturn =
        previousReturnBase > 0 ? ((returnBase / previousReturnBase) - 1) * 100 : 0;
      const returnFromBase =
        baseReturnValue > 0 ? (returnBase / baseReturnValue) - 1 : 0;
      const monthlyReturn =
        ((1 + baseMonthReturn) * (1 + returnFromBase) - 1) * 100;
      const yearlyReturn =
        ((1 + baseYearReturn) * (1 + returnFromBase) - 1) * 100;
      previousReturnBase = returnBase;

      return {
        date,
        creditRights: previousCreditRights,
        creditRightsRevenue: averageCreditRightsRevenue,
        pdd: previousPdd,
        patrimonio: previousPl,
        quotaValue,
        dailyReturn,
        monthlyReturn,
        yearlyReturn,
        pddDelta: input.pddDelta,
      };
    });
  }, [
    averageCreditRightsRevenue,
    futureDates,
    inputs,
    lastCreditRights,
    lastMonthlyReturn,
    lastPatrimonio,
    lastPdd,
    lastYearlyReturn,
    shareQuantity,
  ]);

  const finalProjection = projections.at(-1);
  const baseQuota =
    shareQuantity > 0 && lastHistorical ? lastHistorical.patrimonio / shareQuantity : 0;
  const projectedQuota = finalProjection?.quotaValue ?? baseQuota;

  function updatePddInput(date: string, value: string) {
    setInputs((current) => ({
      ...current,
      [date]: {
        pddDelta: toInputNumber(value),
      },
    }));
  }

  const projectedDailyReturn = finalProjection?.dailyReturn ?? 0;
  const projectedMonthlyReturn =
    finalProjection?.monthlyReturn ?? lastMonthlyReturn;
  const projectedYearlyReturn =
    finalProjection?.yearlyReturn ?? lastYearlyReturn;

  return (
    <div className="space-y-6">
      <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
        <form className="grid gap-4 md:grid-cols-[minmax(220px,1fr)_180px_220px_auto] md:items-end">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="fundId">
              Fundo
            </label>
            <select
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              defaultValue={selectedFundId}
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
            <label className="text-sm font-medium text-slate-700" htmlFor="viewDate">
              Data de Visualização
            </label>
            <input
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              id="viewDate"
              min={lastHistorical?.date}
              onChange={(event) => setViewDate(event.target.value)}
              type="date"
              value={viewDate}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="shareQuantity">
              Quantidade de cotas
            </label>
            <input
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              id="shareQuantity"
              onChange={(event) => setShareQuantity(toInputNumber(event.target.value))}
              step="0.000001"
              type="number"
              value={shareQuantity || ""}
            />
          </div>

          <button
            className="h-10 rounded bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
            type="submit"
          >
            Aplicar
          </button>
        </form>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
        {[
          ["PL base", currencyFormatter.format(lastHistorical?.patrimonio ?? 0)],
          ["Cota base", decimalFormatter.format(baseQuota)],
          ["Receita média DC", formatSignedCurrency(averageCreditRightsRevenue)],
          ["PL projetado", currencyFormatter.format(finalProjection?.patrimonio ?? lastHistorical?.patrimonio ?? 0)],
          ["Cota projetada", decimalFormatter.format(projectedQuota)],
          ["Rent. diária", `${percentFormatter.format(projectedDailyReturn)}%`],
          ["Rent. mensal acum.", `${percentFormatter.format(projectedMonthlyReturn)}%`],
          ["Rent. anual acum.", `${percentFormatter.format(projectedYearlyReturn)}%`],
        ].map(([label, value]) => (
          <article
            className="rounded-lg p-5"
            key={label}
            style={{ background: "var(--color-background-secondary, #f8fafc)" }}
          >
            <p className="text-sm font-medium text-slate-500">{label}</p>
            <p className="mt-3 text-xl font-semibold tracking-normal text-slate-950">
              {value}
            </p>
          </article>
        ))}
      </section>

      <section className="rounded border border-slate-200 bg-white shadow-executive">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">
            DRE histórica
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Última base real: {lastHistorical ? formatDate(lastHistorical.date) : "-"}
          </p>
        </div>

        {historicalRows.length === 0 ? (
          <p className="px-5 py-8 text-sm text-slate-500">
            Nenhum dado histórico encontrado para o fundo selecionado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="px-4 py-3 text-left font-semibold">Data</th>
                  <th className="px-4 py-3 text-right font-semibold">Patrimônio</th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Direitos Creditórios
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Variação real DC
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">PDD</th>
                  <th className="px-4 py-3 text-right font-semibold">Rent. mensal</th>
                  <th className="px-4 py-3 text-right font-semibold">Cota</th>
                </tr>
              </thead>
              <tbody>
                {historicalRows.map((row) => (
                  <tr className="border-b border-slate-100 last:border-0" key={row.date}>
                    <td className="px-4 py-3 text-slate-700">{formatDate(row.date)}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-950">
                      {currencyFormatter.format(row.patrimonio)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {currencyFormatter.format(row.creditRights)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {formatSignedCurrency(row.creditRightsVariation)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {currencyFormatter.format(row.pdd)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {percentFormatter.format(row.variacaoMensal)}%
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {decimalFormatter.format(
                        shareQuantity > 0 ? row.patrimonio / shareQuantity : 0
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded border border-slate-200 bg-white shadow-executive">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">
            Previsão diária
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {futureDates.length} datas futuras até {viewDate ? formatDate(viewDate) : "-"}
          </p>
        </div>

        {futureDates.length === 0 ? (
          <p className="px-5 py-8 text-sm text-slate-500">
            Escolha uma data posterior à última base real.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1320px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="px-4 py-3 text-left font-semibold">Data</th>
                  <th className="px-4 py-3 text-right font-semibold">
                    <span
                      className="inline-flex items-center justify-end gap-1"
                      title="Valor positivo aumenta a PDD/provisão, deixa a PDD projetada mais negativa e reduz o PL. Valor negativo representa reversão de PDD, deixa a PDD menos negativa e aumenta o PL."
                    >
                      Variação PDD
                      <Info className="h-3.5 w-3.5 text-slate-400" />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">
                    <span
                      className="inline-flex items-center justify-end gap-1"
                      title="Média aritmética dos últimos 15 valores de Direitos Creditórios da DRE/Variação: DC de hoje menos DC de ontem, menos compras e mais liquidações. Esse valor é replicado em cada data futura da projeção."
                    >
                      Receita média DC
                      <Info className="h-3.5 w-3.5 text-slate-400" />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">DC projetado</th>
                  <th className="px-4 py-3 text-right font-semibold">PDD projetada</th>
                  <th className="px-4 py-3 text-right font-semibold">PL projetado</th>
                  <th className="px-4 py-3 text-right font-semibold">Cota projetada</th>
                  <th className="px-4 py-3 text-right font-semibold">Rent. diária</th>
                  <th className="px-4 py-3 text-right font-semibold">Rent. mensal acum.</th>
                  <th className="px-4 py-3 text-right font-semibold">Rent. anual acum.</th>
                </tr>
              </thead>
              <tbody>
                {projections.map((row) => (
                  <tr className="border-b border-slate-100 last:border-0" key={row.date}>
                    <td className="px-4 py-3 font-medium text-slate-700">
                      {formatDate(row.date)}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        className="h-9 w-full rounded border border-slate-200 px-3 text-right text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                        onChange={(event) =>
                          updatePddInput(row.date, event.target.value)
                        }
                        placeholder="0,00"
                        type="text"
                      />
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-700">
                      {formatSignedCurrency(row.creditRightsRevenue)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {currencyFormatter.format(row.creditRights)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {currencyFormatter.format(row.pdd)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-950">
                      {currencyFormatter.format(row.patrimonio)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-950">
                      {decimalFormatter.format(row.quotaValue)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {percentFormatter.format(row.dailyReturn)}%
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {percentFormatter.format(row.monthlyReturn)}%
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {percentFormatter.format(row.yearlyReturn)}%
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-950">
                  <td className="px-4 py-3">Total</td>
                  <td className="px-4 py-3 text-right">
                    {formatSignedCurrency(
                      projections.reduce((total, row) => total + row.pddDelta, 0)
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatSignedCurrency(
                      projections.reduce(
                        (total, row) => total + row.creditRightsRevenue,
                        0
                      )
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {currencyFormatter.format(
                      finalProjection?.creditRights ??
                        lastHistorical?.creditRights ??
                        0
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {currencyFormatter.format(finalProjection?.pdd ?? lastHistorical?.pdd ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {currencyFormatter.format(
                      finalProjection?.patrimonio ?? lastHistorical?.patrimonio ?? 0
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {decimalFormatter.format(projectedQuota)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {percentFormatter.format(projectedDailyReturn)}%
                  </td>
                  <td className="px-4 py-3 text-right">
                    {percentFormatter.format(projectedMonthlyReturn)}%
                  </td>
                  <td className="px-4 py-3 text-right">
                    {percentFormatter.format(projectedYearlyReturn)}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
