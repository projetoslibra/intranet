"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";

export type PddMatrixDate = {
  key: string;
  label: string;
  isBase: boolean;
  isHistorical?: boolean;
};

export type PddDebtorMatrixRow = {
  key: string;
  name: string;
  document: string | null;
  titleCount: number;
  presentValue: number;
  currentPdd: number;
  values: Record<string, number>;
};

export type PddCedentMatrixRow = {
  key: string;
  name: string;
  document: string | null;
  titleCount: number;
  debtorCount: number;
  presentValue: number;
  currentPdd: number;
  values: Record<string, number>;
  debtors: PddDebtorMatrixRow[];
};

export type PddTurnover = {
  date: string;
  dateLabel: string;
  cedentName: string;
  debtorName: string;
  debtorDocument: string | null;
  previousRange: string;
  nextRange: string;
  value: number;
  presentValue: number;
};

export type PddSummary = {
  referenceDateLabel: string;
  fundName: string;
  titleCount: number;
  cedentCount: number;
  debtorCount: number;
  presentValue: number;
  currentPdd: number;
  projectedSevenDaysPdd: number;
  projectedFifteenDaysPdd: number;
};

export type PddDailySummaryItem = {
  cedente: string;
  sacado: string;
  documentoSacado: string | null;
  valorAnterior: number;
  valorAtual: number;
  delta: number;
};

export type PddDailyTurnover = {
  data: string;
  cedente: string;
  sacado: string;
  documentoSacado: string | null;
  faixaAnterior: string;
  faixaNova: string;
  valorPresente: number;
  valorVirada: number;
};

export type PddDailySummaryJson = {
  pddAtual: number;
  pddAnterior: number | null;
  deltaPdd: number | null;
  aumentos: PddDailySummaryItem[];
  reversoes: PddDailySummaryItem[];
  viradasProximos7Dias: PddDailyTurnover[];
  semComparativoAnterior: boolean;
  snapshotAnteriorData: string | null;
};

export type PddDailySummaryCard = {
  analiseJson: PddDailySummaryJson;
  dataReferenciaLabel: string;
  updatedAtLabel: string;
};

type PddDashboardProps = {
  dailySummary: PddDailySummaryCard | null;
  dates: PddMatrixDate[];
  historicalDates: PddMatrixDate[];
  historicalRows: PddCedentMatrixRow[];
  rows: PddCedentMatrixRow[];
  summary: PddSummary;
  turnovers: PddTurnover[];
};

type MatrixSortMode = "alpha" | "pdd_desc";

function formatSignedCurrency(value: number) {
  if (Math.abs(value) < 0.005) {
    return formatCurrency(0);
  }

  return `${value > 0 ? "+" : ""}${formatCurrency(value)}`;
}

function compactDocument(value: string | null) {
  return value || "-";
}

function slugifyFilePart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toExcelNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const normalized = value
      .replace(/\s/g, "")
      .replace(/R\$/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
    const number = Number(normalized);

    return Number.isFinite(number) ? number : 0;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
}

function buildMatrixExcelData({
  dates,
  fundName,
  referenceDateLabel,
  rows,
  showPast,
}: {
  dates: PddMatrixDate[];
  fundName: string;
  referenceDateLabel: string;
  rows: PddCedentMatrixRow[];
  showPast: boolean;
}) {
  const header = [
    "Tipo",
    "Cedente / Sacado",
    "Documento",
    "Titulos",
    "Valor presente",
    ...dates.map((date) => date.label),
  ];
  const bodyRows = rows
    .flatMap((row) => [
      { kind: "Cedente", level: 0, item: row },
      ...row.debtors.map((debtor) => ({
        kind: "Sacado",
        level: 1,
        item: debtor,
      })),
    ])
    .map(({ item, kind, level }) => [
      kind,
      `${level === 1 ? "  " : ""}${item.name}`,
      compactDocument(item.document),
      toExcelNumber(item.titleCount),
      toExcelNumber(item.presentValue),
      ...dates.map((date) => toExcelNumber(item.values[date.key] ?? 0)),
    ]);

  return [
    ["Matriz de PDD"],
    [
      `${fundName} - base ${referenceDateLabel} - ${
        showPast ? "historico mensal + projecao" : "projecao futura"
      }`,
    ],
    [],
    header,
    ...bodyRows,
  ];
}

function MatrixValue({
  changed,
  previousValue,
  value,
}: {
  changed: boolean;
  previousValue: number;
  value: number;
}) {
  const className = value > 0 ? "font-semibold text-red-700" : "font-medium text-slate-500";

  return (
    <span
      className={className}
      title={
        changed
          ? `Alterou ${formatSignedCurrency(value - previousValue)} vs. dia anterior`
          : undefined
      }
    >
      {formatCurrency(value)}
    </span>
  );
}

function matrixCellClass(changed: boolean) {
  return changed
    ? "border-b border-amber-200 bg-amber-50 px-4 py-3 text-right"
    : "border-b border-slate-100 px-4 py-3 text-right";
}

function SummaryMetricCard({
  accent,
  caption,
  detail,
  hoverItems,
  title,
  value,
}: {
  accent: "amber" | "green" | "red" | "slate";
  caption?: string;
  detail?: string;
  hoverItems?: string[];
  title: string;
  value: string;
}) {
  const accentClasses = {
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    green: "border-emerald-200 bg-emerald-50 text-emerald-800",
    red: "border-red-200 bg-red-50 text-red-700",
    slate: "border-slate-200 bg-slate-50 text-slate-900",
  };

  return (
    <div
      className={`group relative rounded border px-4 py-3 ${accentClasses[accent]}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide">{title}</p>
      <p className="mt-2 text-lg font-semibold">{value}</p>
      {caption ? (
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-700">
          {caption}
        </p>
      ) : null}
      {detail ? <p className="mt-1 text-xs text-slate-500">{detail}</p> : null}
      {hoverItems?.length ? (
        <div className="pointer-events-none absolute left-0 top-[calc(100%+8px)] z-40 hidden w-[min(520px,calc(100vw-48px))] rounded border border-slate-200 bg-white p-3 text-slate-700 shadow-xl group-hover:block">
          <p className="text-xs font-semibold uppercase text-slate-500">
            Composicao
          </p>
          <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
            {hoverItems.map((item, index) => (
              <p className="text-xs leading-5" key={`${item}-${index}`}>
                {item}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildSummaryItemsTooltip(
  items: PddDailySummaryItem[],
  emptyLabel: string
) {
  if (!items.length) {
    return [emptyLabel];
  }

  return items.map(
    (item, index) =>
      `${index + 1}. ${formatSignedCurrency(item.delta)} - ${item.cedente} / ${item.sacado} (antes ${formatCurrency(item.valorAnterior)}, atual ${formatCurrency(item.valorAtual)})`
  );
}

function buildTurnoverTooltip(items: PddDailyTurnover[]) {
  if (!items.length) {
    return ["Sem viradas previstas nos proximos 7 dias."];
  }

  return items.map(
    (item, index) =>
      `${index + 1}. ${formatSignedCurrency(item.valorVirada)} - ${item.data} - ${item.cedente} / ${item.sacado} (${item.faixaAnterior} para ${item.faixaNova})`
  );
}

function rowHasMonthlyChange(row: PddCedentMatrixRow, dates: PddMatrixDate[]) {
  const baseMonth = dates[0]?.key.slice(0, 7);

  if (!baseMonth) {
    return false;
  }

  return dates.some((date, index) => {
    if (index === 0 || !date.key.startsWith(baseMonth)) {
      return false;
    }

    const previousDate = dates[index - 1];
    const value = row.values[date.key] ?? 0;
    const previousValue = row.values[previousDate.key] ?? 0;

    return Math.abs(value - previousValue) >= 0.005;
  });
}

export function PddDashboard({
  dailySummary,
  dates,
  historicalDates,
  historicalRows,
  rows,
  summary,
  turnovers,
}: PddDashboardProps) {
  const [expandedCedents, setExpandedCedents] = useState<Set<string>>(
    () => new Set()
  );
  const [isTurnoversOpen, setIsTurnoversOpen] = useState(false);
  const [matrixSortMode, setMatrixSortMode] =
    useState<MatrixSortMode>("alpha");
  const [showOnlyMonthTurnovers, setShowOnlyMonthTurnovers] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const pddDeltaSevenDays = summary.projectedSevenDaysPdd - summary.currentPdd;
  const pddDeltaFifteenDays =
    summary.projectedFifteenDaysPdd - summary.currentPdd;
  const hasAnyExpansion = expandedCedents.size > 0;
  const activeDates = showPast ? historicalDates : dates;
  const activeRows = showPast ? historicalRows : rows;
  const topIncrease = dailySummary?.analiseJson.aumentos[0] ?? null;
  const topReversal = dailySummary?.analiseJson.reversoes[0] ?? null;
  const topTurnover =
    dailySummary?.analiseJson.viradasProximos7Dias[0] ?? null;
  const increaseTooltipItems = dailySummary
    ? buildSummaryItemsTooltip(
        dailySummary.analiseJson.aumentos,
        "Sem aumentos relevantes no dia."
      )
    : [];
  const reversalTooltipItems = dailySummary
    ? buildSummaryItemsTooltip(
        dailySummary.analiseJson.reversoes,
        "Sem reversoes relevantes no dia."
      )
    : [];
  const turnoverTooltipItems = dailySummary
    ? buildTurnoverTooltip(dailySummary.analiseJson.viradasProximos7Dias)
    : [];

  function toggleCedent(key: string) {
    setExpandedCedents((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  }

  function expandAll() {
    setExpandedCedents(new Set(visibleRows.map((row) => row.key)));
  }

  function collapseAll() {
    setExpandedCedents(new Set());
  }

  async function exportExcel() {
    const XLSX = await import("xlsx");
    const worksheet = XLSX.utils.aoa_to_sheet(excelData);
    const range = XLSX.utils.decode_range(worksheet["!ref"] ?? "A1:A1");

    worksheet["!cols"] = [
      { wch: 12 },
      { wch: 46 },
      { wch: 22 },
      { wch: 12 },
      { wch: 18 },
      ...activeDates.map(() => ({ wch: 14 })),
    ];

    for (let rowIndex = 4; rowIndex <= range.e.r; rowIndex += 1) {
      for (let columnIndex = 3; columnIndex <= range.e.c; columnIndex += 1) {
        const address = XLSX.utils.encode_cell({
          c: columnIndex,
          r: rowIndex,
        });
        const cell = worksheet[address];

        if (cell) {
          cell.v = toExcelNumber(cell.v);
          cell.t = "n";
          cell.z = columnIndex === 3 ? "0" : "0.00";
          delete cell.w;
        }
      }
    }

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "Matriz PDD");
    XLSX.writeFile(workbook, excelFileName);
  }

  const sortedTurnovers = useMemo(
    () => [...turnovers].sort((left, right) => right.value - left.value),
    [turnovers]
  );
  const visibleRows = useMemo(() => {
    const filteredRows = showOnlyMonthTurnovers
      ? activeRows.filter((row) => rowHasMonthlyChange(row, activeDates))
      : activeRows;

    return filteredRows.slice().sort((left, right) => {
      if (matrixSortMode === "pdd_desc") {
        const pddDifference = right.currentPdd - left.currentPdd;

        if (Math.abs(pddDifference) >= 0.005) {
          return pddDifference;
        }
      }

      return left.name.localeCompare(right.name, "pt-BR");
    });
  }, [activeDates, activeRows, matrixSortMode, showOnlyMonthTurnovers]);
  const excelData = useMemo(
    () =>
      buildMatrixExcelData({
        dates: activeDates,
        fundName: summary.fundName,
        referenceDateLabel: summary.referenceDateLabel,
        rows: visibleRows,
        showPast,
      }),
    [activeDates, showPast, summary.fundName, summary.referenceDateLabel, visibleRows]
  );
  const excelFileName = `matriz-pdd-${slugifyFilePart(summary.fundName)}-${slugifyFilePart(summary.referenceDateLabel)}${showPast ? "-historico" : ""}.xlsx`;

  return (
    <div className="space-y-6">
      <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-primary">PDD</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">
              Painel de provisao dos FIDCs
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {summary.fundName} · base {summary.referenceDateLabel}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase text-slate-500">PDD atual</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">
                {formatCurrency(summary.currentPdd)}
              </p>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase text-slate-500">Viradas 7 dias</p>
              <p className="mt-1 text-lg font-semibold text-red-700">
                {formatSignedCurrency(pddDeltaSevenDays)}
              </p>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase text-slate-500">PDD em 15 dias</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">
                {formatCurrency(summary.projectedFifteenDaysPdd)}
              </p>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase text-slate-500">Estoque analisado</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">
                {summary.titleCount.toLocaleString("pt-BR")} titulos
              </p>
              <p className="text-xs text-slate-500">
                {summary.cedentCount} cedentes · {summary.debtorCount} sacados
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-primary">
              Resumo diario
            </p>
            <h2 className="mt-1 text-base font-semibold text-slate-950">
              Analise automatica de PDD
            </h2>
          </div>
          {dailySummary ? (
            <p className="text-xs text-slate-500">
              Base {dailySummary.dataReferenciaLabel} · atualizado em{" "}
              {dailySummary.updatedAtLabel}
            </p>
          ) : null}
        </div>
        {dailySummary ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SummaryMetricCard
              accent={
                (dailySummary.analiseJson.deltaPdd ?? 0) > 0
                  ? "red"
                  : (dailySummary.analiseJson.deltaPdd ?? 0) < 0
                    ? "green"
                    : "slate"
              }
              detail={
                dailySummary.analiseJson.snapshotAnteriorData
                  ? `vs. ${dailySummary.analiseJson.snapshotAnteriorData}`
                  : "sem snapshot anterior"
              }
              hoverItems={[
                `PDD anterior: ${
                  dailySummary.analiseJson.pddAnterior === null
                    ? "-"
                    : formatCurrency(dailySummary.analiseJson.pddAnterior)
                }`,
                `PDD atual: ${formatCurrency(dailySummary.analiseJson.pddAtual)}`,
                `Aumentos listados: ${dailySummary.analiseJson.aumentos.length}`,
                `Reversoes listadas: ${dailySummary.analiseJson.reversoes.length}`,
              ]}
              title="Delta do dia"
              value={
                dailySummary.analiseJson.deltaPdd === null
                  ? "-"
                  : formatSignedCurrency(dailySummary.analiseJson.deltaPdd)
              }
            />
            <SummaryMetricCard
              accent="red"
              caption={
                topIncrease
                  ? `${topIncrease.cedente} / ${topIncrease.sacado}`
                  : "Sem aumento relevante"
              }
              detail={
                topIncrease
                  ? `Anterior ${formatCurrency(topIncrease.valorAnterior)} · atual ${formatCurrency(topIncrease.valorAtual)}`
                  : undefined
              }
              hoverItems={increaseTooltipItems}
              title="Maior aumento"
              value={topIncrease ? formatSignedCurrency(topIncrease.delta) : "-"}
            />
            <SummaryMetricCard
              accent="green"
              caption={
                topReversal
                  ? `${topReversal.cedente} / ${topReversal.sacado}`
                  : "Sem reversao relevante"
              }
              detail={
                topReversal
                  ? `Anterior ${formatCurrency(topReversal.valorAnterior)} · atual ${formatCurrency(topReversal.valorAtual)}`
                  : undefined
              }
              hoverItems={reversalTooltipItems}
              title="Maior reversao"
              value={topReversal ? formatSignedCurrency(topReversal.delta) : "-"}
            />
            <SummaryMetricCard
              accent="amber"
              caption={
                topTurnover
                  ? `${topTurnover.cedente} / ${topTurnover.sacado}`
                  : "Sem virada prevista"
              }
              detail={
                topTurnover
                  ? `${topTurnover.data} · ${topTurnover.faixaAnterior} para ${topTurnover.faixaNova}`
                  : undefined
              }
              hoverItems={turnoverTooltipItems}
              title="Maior virada 7d"
              value={
                topTurnover ? formatSignedCurrency(topTurnover.valorVirada) : "-"
              }
            />
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">
            Nenhum resumo diario foi gerado para este fundo ainda. O N8N deve chamar
            o endpoint de resumo apos concluir a ingestao do estoque.
          </p>
        )}
      </section>

      <section className="rounded border border-slate-200 bg-white shadow-executive">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                Viradas dos proximos 7 dias
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Cedentes e sacados que mudam de faixa pela logica PDD. O valor
                Virada PDD e o delta incremental daquela data.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="rounded border border-red-200 bg-red-50 px-4 py-2 text-sm">
                <span className="text-slate-600">Viradas 7 dias: </span>
                <span className="font-semibold text-red-700">
                  {formatSignedCurrency(pddDeltaSevenDays)}
                </span>
              </div>
              <button
                className="h-9 rounded border border-slate-200 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                onClick={() => setIsTurnoversOpen((current) => !current)}
                type="button"
              >
                {isTurnoversOpen ? "Guardar tabela" : "Abrir tabela"}
              </button>
            </div>
          </div>
        </div>

        {isTurnoversOpen && sortedTurnovers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="px-4 py-3 text-left font-semibold">Data</th>
                  <th className="px-4 py-3 text-left font-semibold">Cedente</th>
                  <th className="px-4 py-3 text-left font-semibold">Sacado</th>
                  <th className="px-4 py-3 text-left font-semibold">Faixa</th>
                  <th className="px-4 py-3 text-right font-semibold">Valor presente</th>
                  <th
                    className="px-4 py-3 text-right font-semibold"
                    title="Delta incremental de PDD gerado nesta data pela mudanca de faixa."
                  >
                    Virada PDD
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedTurnovers.slice(0, 20).map((item) => (
                  <tr
                    className="border-b border-slate-100 last:border-0"
                    key={`${item.date}-${item.cedentName}-${item.debtorName}-${item.value}`}
                  >
                    <td className="px-4 py-3 font-medium text-slate-700">
                      {item.dateLabel}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{item.cedentName}</td>
                    <td className="px-4 py-3 text-slate-700">
                      <span className="block font-medium text-slate-950">
                        {item.debtorName}
                      </span>
                      <span className="text-xs text-slate-500">
                        {compactDocument(item.debtorDocument)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {item.previousRange} para {item.nextRange}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {formatCurrency(item.presentValue)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-red-700">
                      {formatCurrency(item.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : isTurnoversOpen ? (
          <p className="px-5 py-8 text-sm text-slate-500">
            Nenhuma virada de faixa prevista nos proximos 7 dias.
          </p>
        ) : (
          <p className="px-5 py-4 text-sm text-slate-500">
            Tabela guardada para manter a tela limpa.
          </p>
        )}
      </section>

      <section className="rounded border border-slate-200 bg-white shadow-executive">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                Matriz de PDD por cedente
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Linhas por cedente, explosao por sacado e colunas por data projetada.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <span>Ordenar</span>
                <select
                  className="h-9 rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  onChange={(event) =>
                    setMatrixSortMode(event.target.value as MatrixSortMode)
                  }
                  value={matrixSortMode}
                >
                  <option value="alpha">A-Z</option>
                  <option value="pdd_desc">Maior PDD</option>
                </select>
              </label>
              <label className="flex h-9 items-center gap-2 rounded border border-slate-200 px-3 text-sm font-medium text-slate-700">
                <input
                  checked={showOnlyMonthTurnovers}
                  className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                  onChange={(event) =>
                    setShowOnlyMonthTurnovers(event.target.checked)
                  }
                  type="checkbox"
                />
                Viram no mes
              </label>
              <button
                className={
                  showPast
                    ? "h-9 rounded border border-primary bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
                    : "h-9 rounded border border-slate-200 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                }
                onClick={() => setShowPast((current) => !current)}
                type="button"
              >
                {showPast ? "Ocultar passado" : "Mostrar passado"}
              </button>
              <button
                className="h-9 rounded border border-slate-200 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                onClick={hasAnyExpansion ? collapseAll : expandAll}
                type="button"
              >
                {hasAnyExpansion ? "Recolher todos" : "Expandir todos"}
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                onClick={exportExcel}
                type="button"
              >
                <Download className="h-4 w-4" />
                Exportar Excel
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1280px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <th className="sticky left-0 z-30 min-w-[380px] max-w-[380px] border-b border-slate-200 bg-slate-50 px-4 py-3 text-left font-semibold shadow-[10px_0_16px_-16px_rgba(15,23,42,0.45)]">
                  Cedente / Sacado
                </th>
                <th className="border-b border-slate-200 px-4 py-3 text-right font-semibold">Titulos</th>
                <th className="border-b border-slate-200 px-4 py-3 text-right font-semibold">Valor presente</th>
                {activeDates.map((date) => (
                  <th className="border-b border-slate-200 px-4 py-3 text-right font-semibold" key={date.key}>
                    <span
                      className={
                        date.isBase
                          ? "text-primary"
                          : date.isHistorical
                            ? "text-slate-700"
                            : undefined
                      }
                    >
                      {date.label}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const isExpanded = expandedCedents.has(row.key);

                return (
                  <Fragment key={row.key}>
                    <tr
                      className="group bg-white hover:bg-slate-50"
                      key={row.key}
                    >
                      <td className="sticky left-0 z-20 min-w-[380px] max-w-[380px] border-b border-slate-100 bg-white px-4 py-3 shadow-[10px_0_16px_-16px_rgba(15,23,42,0.45)] group-hover:bg-slate-50">
                        <button
                          className="flex w-full items-start gap-2 text-left"
                          onClick={() => toggleCedent(row.key)}
                          type="button"
                        >
                          {isExpanded ? (
                            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                          ) : (
                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                          )}
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-slate-950">
                              {row.name}
                            </span>
                            <span className="block text-xs text-slate-500">
                              {row.debtorCount} sacados · {compactDocument(row.document)}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3 text-right text-slate-700">
                        {row.titleCount.toLocaleString("pt-BR")}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3 text-right text-slate-700">
                        {formatCurrency(row.presentValue)}
                      </td>
                      {activeDates.map((date, index) => {
                        const value = row.values[date.key] ?? 0;
                        const previousValue =
                          index > 0
                            ? row.values[activeDates[index - 1].key] ?? 0
                            : value;
                        const changed =
                          index > 0 && Math.abs(value - previousValue) >= 0.005;

                        return (
                          <td className={matrixCellClass(changed)} key={date.key}>
                            <MatrixValue
                              changed={changed}
                              previousValue={previousValue}
                              value={value}
                            />
                          </td>
                        );
                      })}
                    </tr>

                    {isExpanded
                      ? row.debtors.map((debtor) => (
                          <tr
                            className="bg-slate-50"
                            key={`${row.key}-${debtor.key}`}
                          >
                            <td className="sticky left-0 z-20 min-w-[380px] max-w-[380px] border-b border-slate-100 bg-slate-50 px-4 py-3 pl-10 shadow-[10px_0_16px_-16px_rgba(15,23,42,0.45)]">
                              <span className="block truncate font-medium text-slate-800">
                                {debtor.name}
                              </span>
                              <span className="block text-xs text-slate-500">
                                {compactDocument(debtor.document)}
                              </span>
                            </td>
                            <td className="border-b border-slate-100 px-4 py-3 text-right text-slate-600">
                              {debtor.titleCount.toLocaleString("pt-BR")}
                            </td>
                            <td className="border-b border-slate-100 px-4 py-3 text-right text-slate-600">
                              {formatCurrency(debtor.presentValue)}
                            </td>
                            {activeDates.map((date, index) => {
                              const value = debtor.values[date.key] ?? 0;
                              const previousValue =
                                index > 0
                                  ? debtor.values[activeDates[index - 1].key] ?? 0
                                  : value;
                              const changed =
                                index > 0 &&
                                Math.abs(value - previousValue) >= 0.005;

                              return (
                                <td className={matrixCellClass(changed)} key={date.key}>
                                  <MatrixValue
                                    changed={changed}
                                    previousValue={previousValue}
                                    value={value}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        ))
                      : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
