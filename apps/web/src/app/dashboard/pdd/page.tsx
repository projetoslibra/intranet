import { findDefaultFund, sortFundsByDisplayPriority } from "@/lib/fund-order";
import {
  pddDaysLate,
  pddDebtorKey,
  pddRangeLabelForDelay,
  pddRateForDelay,
} from "@/lib/logica-pdd";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  PddDashboard,
  type PddCedentMatrixRow,
  type PddDailySummaryCard,
  type PddDailySummaryJson,
  type PddMatrixDate,
  type PddSummary,
  type PddTurnover,
} from "@/features/pdd/components/PddDashboard";

type PddPageProps = {
  searchParams?: {
    fundId?: string;
  };
};

type StockTitle = {
  id: string;
  cedentName: string;
  cedentDocument: string | null;
  debtorName: string;
  debtorDocument: string | null;
  dueDate: string;
  presentValue: number;
  currentPdd: number;
};

type HistoricalStockTitle = StockTitle & {
  referenceDate: string;
};

type DebtorProjection = {
  key: string;
  maxDelay: number;
  rate: number;
  range: string;
  totalPdd: number;
  titles: StockTitle[];
};

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

const longDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
  year: "numeric",
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

function startOfMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function formatDateKey(value: string) {
  return dateFormatter.format(parseDateKey(value));
}

function formatLongDateKey(value: string) {
  return longDateFormatter.format(parseDateKey(value));
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function resolveStockFundToken(fund: { name: string; shortName: string }) {
  const label = normalizeText(`${fund.shortName} ${fund.name}`);

  if (label.includes("APUAMA")) {
    return "APUAMA";
  }

  if (label.includes("BRISTOL")) {
    return "BRISTOL";
  }

  if (label.includes("ANTENA")) {
    return "ANTENA";
  }

  if (label.includes("CONSIGNADO")) {
    return "CONSIGNADO";
  }

  return fund.shortName || fund.name;
}

function buildDates(referenceDate: string): PddMatrixDate[] {
  const base = parseDateKey(referenceDate);

  return Array.from({ length: 16 }, (_, index) => {
    const key = dateKey(addDays(base, index));

    return {
      key,
      label: index === 0 ? `${formatDateKey(key)} atual` : formatDateKey(key),
      isBase: index === 0,
    };
  });
}

function buildHistoricalDates(
  referenceDate: string,
  historicalReferenceDates: string[]
): PddMatrixDate[] {
  const futureDates = buildDates(referenceDate).slice(1);
  const historicalDates = Array.from(new Set(historicalReferenceDates))
    .filter((key) => key <= referenceDate && key.slice(0, 7) === referenceDate.slice(0, 7))
    .sort()
    .map((key) => ({
      key,
      label: key === referenceDate ? `${formatDateKey(key)} atual` : formatDateKey(key),
      isBase: key === referenceDate,
      isHistorical: true,
    }));

  return [...historicalDates, ...futureDates];
}

function calculateDebtorProjection(date: string, titles: StockTitle[]) {
  const maxDelay = Math.max(
    0,
    ...titles.map((title) => pddDaysLate(date, title.dueDate))
  );
  const rate = pddRateForDelay(maxDelay);

  return {
    maxDelay,
    rate,
    range: pddRangeLabelForDelay(maxDelay),
    totalPdd: titles.reduce(
      (total, title) => total + title.presentValue * rate,
      0
    ),
  };
}

function groupTitlesByDebtor(titles: StockTitle[]) {
  const debtors = new Map<string, StockTitle[]>();

  titles.forEach((title) => {
    const key = pddDebtorKey({
      debtorDocument: title.debtorDocument,
      debtorName: title.debtorName,
    });
    const group = debtors.get(key) ?? [];

    group.push(title);
    debtors.set(key, group);
  });

  return debtors;
}

function buildDebtorProjections(date: string, titles: StockTitle[]) {
  const result = new Map<string, DebtorProjection>();
  const debtors = groupTitlesByDebtor(titles);

  debtors.forEach((debtorTitles, key) => {
    const projection = calculateDebtorProjection(date, debtorTitles);

    result.set(key, {
      key,
      titles: debtorTitles,
      ...projection,
    });
  });

  return result;
}

function addValue(target: Record<string, number>, date: string, value: number) {
  target[date] = (target[date] ?? 0) + value;
}

function buildMatrix(titles: StockTitle[], dates: PddMatrixDate[]) {
  const cedents = new Map<
    string,
    PddCedentMatrixRow & {
      debtorMap: Map<string, PddCedentMatrixRow["debtors"][number]>;
    }
  >();

  dates.forEach((date) => {
    const debtorProjections = buildDebtorProjections(date.key, titles);

    titles.forEach((title) => {
      const debtorKey = pddDebtorKey({
        debtorDocument: title.debtorDocument,
        debtorName: title.debtorName,
      });
      const titlePdd = date.isBase
        ? title.currentPdd
        : title.presentValue * (debtorProjections.get(debtorKey)?.rate ?? 0);
      const cedentKey = `${title.cedentDocument ?? ""}|${title.cedentName}`;
      const cedent = cedents.get(cedentKey) ?? {
        key: cedentKey,
        name: title.cedentName,
        document: title.cedentDocument,
        titleCount: 0,
        debtorCount: 0,
        presentValue: 0,
        currentPdd: 0,
        values: {},
        debtors: [],
        debtorMap: new Map(),
      };
      const debtor = cedent.debtorMap.get(debtorKey) ?? {
        key: debtorKey,
        name: title.debtorName,
        document: title.debtorDocument,
        titleCount: 0,
        presentValue: 0,
        currentPdd: 0,
        values: {},
      };

      addValue(cedent.values, date.key, titlePdd);
      addValue(debtor.values, date.key, titlePdd);

      if (date.isBase) {
        cedent.titleCount += 1;
        cedent.presentValue += title.presentValue;
        cedent.currentPdd += title.currentPdd;
        debtor.titleCount += 1;
        debtor.presentValue += title.presentValue;
        debtor.currentPdd += title.currentPdd;
      }

      cedent.debtorMap.set(debtorKey, debtor);
      cedents.set(cedentKey, cedent);
    });
  });

  return Array.from(cedents.values())
    .map((cedent) => ({
      ...cedent,
      debtorCount: cedent.debtorMap.size,
      debtors: Array.from(cedent.debtorMap.values()).sort(
        (left, right) => right.currentPdd - left.currentPdd
      ),
      debtorMap: undefined,
    }))
    .sort((left, right) => right.currentPdd - left.currentPdd);
}

function buildHistoricalMatrix(
  historicalTitles: HistoricalStockTitle[],
  latestTitles: StockTitle[],
  dates: PddMatrixDate[],
  referenceDate: string
) {
  const cedents = new Map<
    string,
    PddCedentMatrixRow & {
      debtorMap: Map<string, PddCedentMatrixRow["debtors"][number]>;
    }
  >();
  const historicalByDate = new Map<string, HistoricalStockTitle[]>();

  historicalTitles.forEach((title) => {
    const group = historicalByDate.get(title.referenceDate) ?? [];

    group.push(title);
    historicalByDate.set(title.referenceDate, group);
  });

  dates.forEach((date) => {
    const titlesForDate =
      date.key <= referenceDate && historicalByDate.has(date.key)
        ? historicalByDate.get(date.key) ?? []
        : latestTitles;
    const debtorProjections =
      date.key <= referenceDate && historicalByDate.has(date.key)
        ? null
        : buildDebtorProjections(date.key, latestTitles);

    titlesForDate.forEach((title) => {
      const debtorKey = pddDebtorKey({
        debtorDocument: title.debtorDocument,
        debtorName: title.debtorName,
      });
      const titlePdd = debtorProjections
        ? title.presentValue * (debtorProjections.get(debtorKey)?.rate ?? 0)
        : title.currentPdd;
      const cedentKey = `${title.cedentDocument ?? ""}|${title.cedentName}`;
      const cedent = cedents.get(cedentKey) ?? {
        key: cedentKey,
        name: title.cedentName,
        document: title.cedentDocument,
        titleCount: 0,
        debtorCount: 0,
        presentValue: 0,
        currentPdd: 0,
        values: {},
        debtors: [],
        debtorMap: new Map(),
      };
      const debtor = cedent.debtorMap.get(debtorKey) ?? {
        key: debtorKey,
        name: title.debtorName,
        document: title.debtorDocument,
        titleCount: 0,
        presentValue: 0,
        currentPdd: 0,
        values: {},
      };

      addValue(cedent.values, date.key, titlePdd);
      addValue(debtor.values, date.key, titlePdd);

      if (date.isBase) {
        cedent.titleCount += 1;
        cedent.presentValue += title.presentValue;
        cedent.currentPdd += title.currentPdd;
        debtor.titleCount += 1;
        debtor.presentValue += title.presentValue;
        debtor.currentPdd += title.currentPdd;
      }

      cedent.debtorMap.set(debtorKey, debtor);
      cedents.set(cedentKey, cedent);
    });
  });

  return Array.from(cedents.values())
    .map((cedent) => ({
      ...cedent,
      debtorCount: cedent.debtorMap.size,
      debtors: Array.from(cedent.debtorMap.values()).sort(
        (left, right) => right.currentPdd - left.currentPdd
      ),
      debtorMap: undefined,
    }))
    .sort((left, right) => right.currentPdd - left.currentPdd);
}

function buildTurnovers(titles: StockTitle[], dates: PddMatrixDate[]) {
  const result: PddTurnover[] = [];
  const nextSevenDates = dates.slice(1, 8);

  nextSevenDates.forEach((date, index) => {
    const previousDate = dates[index].key;
    const previousProjections = buildDebtorProjections(previousDate, titles);
    const nextProjections = buildDebtorProjections(date.key, titles);

    nextProjections.forEach((nextProjection, debtorKey) => {
      const previousProjection = previousProjections.get(debtorKey);
      const previousPdd = previousProjection?.totalPdd ?? 0;
      const delta = nextProjection.totalPdd - previousPdd;

      if (delta <= 0.005 || previousProjection?.rate === nextProjection.rate) {
        return;
      }

      const totalPresentValue = nextProjection.titles.reduce(
        (total, title) => total + title.presentValue,
        0
      );
      const byCedent = new Map<
        string,
        {
          cedentName: string;
          debtorName: string;
          debtorDocument: string | null;
          presentValue: number;
        }
      >();

      nextProjection.titles.forEach((title) => {
        const key = `${title.cedentDocument ?? ""}|${title.cedentName}`;
        const current = byCedent.get(key) ?? {
          cedentName: title.cedentName,
          debtorName: title.debtorName,
          debtorDocument: title.debtorDocument,
          presentValue: 0,
        };

        current.presentValue += title.presentValue;
        byCedent.set(key, current);
      });

      byCedent.forEach((item) => {
        const share =
          totalPresentValue > 0 ? item.presentValue / totalPresentValue : 0;

        result.push({
          date: date.key,
          dateLabel: formatLongDateKey(date.key),
          cedentName: item.cedentName,
          debtorName: item.debtorName,
          debtorDocument: item.debtorDocument,
          previousRange: previousProjection?.range ?? "Sem faixa",
          nextRange: nextProjection.range,
          value: delta * share,
          presentValue: item.presentValue,
        });
      });
    });
  });

  return result;
}

function sumMatrixDate(rows: PddCedentMatrixRow[], dateKeyValue: string) {
  return rows.reduce((total, row) => total + (row.values[dateKeyValue] ?? 0), 0);
}

function normalizeDailySummaryJson(value: unknown): PddDailySummaryJson | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const json = value as Partial<PddDailySummaryJson>;

  return {
    aumentos: Array.isArray(json.aumentos) ? json.aumentos : [],
    deltaPdd:
      typeof json.deltaPdd === "number" && Number.isFinite(json.deltaPdd)
        ? json.deltaPdd
        : null,
    pddAnterior:
      typeof json.pddAnterior === "number" && Number.isFinite(json.pddAnterior)
        ? json.pddAnterior
        : null,
    pddAtual:
      typeof json.pddAtual === "number" && Number.isFinite(json.pddAtual)
        ? json.pddAtual
        : 0,
    reversoes: Array.isArray(json.reversoes) ? json.reversoes : [],
    semComparativoAnterior: Boolean(json.semComparativoAnterior),
    snapshotAnteriorData:
      typeof json.snapshotAnteriorData === "string"
        ? json.snapshotAnteriorData
        : null,
    viradasProximos7Dias: Array.isArray(json.viradasProximos7Dias)
      ? json.viradasProximos7Dias
      : [],
  };
}

export default async function PddPage({ searchParams }: PddPageProps) {
  const canView = await hasPermission("pdd.view");

  if (!canView) {
    return (
      <section className="rounded border border-slate-200 bg-white p-6 shadow-executive">
        <h2 className="text-lg font-semibold text-slate-950">PDD</h2>
        <p className="mt-2 text-sm text-slate-500">
          Voce nao tem permissao para visualizar o painel de PDD.
        </p>
      </section>
    );
  }

  const funds = sortFundsByDisplayPriority(
    await prisma.fund.findMany({
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
        shortName: true,
      },
    })
  );
  const selectedFund = findDefaultFund(funds, searchParams?.fundId);
  const stockFundToken = selectedFund ? resolveStockFundToken(selectedFund) : null;
  const latestStock = stockFundToken
    ? await prisma.fidcEstoque.findFirst({
        where: {
          nomeFundo: {
            contains: stockFundToken,
            mode: "insensitive",
          },
        },
        orderBy: {
          dataReferencia: "desc",
        },
        select: {
          nomeFundo: true,
          dataReferencia: true,
        },
      })
    : null;
  const stockRows = latestStock
    ? await prisma.fidcEstoque.findMany({
        where: {
          nomeFundo: latestStock.nomeFundo,
          dataReferencia: latestStock.dataReferencia,
        },
        orderBy: [
          { nomeCedente: "asc" },
          { nomeSacado: "asc" },
          { dataVencimentoOriginal: "asc" },
        ],
        select: {
          id: true,
          nomeCedente: true,
          docCedente: true,
          nomeSacado: true,
          docSacado: true,
          dataVencimentoOriginal: true,
          valorPresente: true,
          valorPdd: true,
        },
      })
    : [];
  const monthStart = latestStock ? startOfMonth(latestStock.dataReferencia) : null;
  const historicalStockRows =
    latestStock && monthStart
      ? await prisma.fidcEstoque.findMany({
          where: {
            nomeFundo: latestStock.nomeFundo,
            dataReferencia: {
              gte: monthStart,
              lte: latestStock.dataReferencia,
            },
          },
          orderBy: [
            { dataReferencia: "asc" },
            { nomeCedente: "asc" },
            { nomeSacado: "asc" },
            { dataVencimentoOriginal: "asc" },
          ],
          select: {
            id: true,
            nomeCedente: true,
            docCedente: true,
            nomeSacado: true,
            docSacado: true,
            dataReferencia: true,
            dataVencimentoOriginal: true,
            valorPresente: true,
            valorPdd: true,
          },
        })
      : [];

  const titles: StockTitle[] = stockRows
    .filter((row) => row.dataVencimentoOriginal)
    .map((row) => ({
      id: row.id,
      cedentName: row.nomeCedente,
      cedentDocument: row.docCedente,
      debtorName: row.nomeSacado,
      debtorDocument: row.docSacado,
      dueDate: dateKey(row.dataVencimentoOriginal),
      presentValue: Number(row.valorPresente),
      currentPdd: Math.max(0, Number(row.valorPdd)),
    }));
  const historicalTitles: HistoricalStockTitle[] = historicalStockRows
    .filter((row) => row.dataVencimentoOriginal)
    .map((row) => ({
      id: row.id,
      referenceDate: dateKey(row.dataReferencia),
      cedentName: row.nomeCedente,
      cedentDocument: row.docCedente,
      debtorName: row.nomeSacado,
      debtorDocument: row.docSacado,
      dueDate: dateKey(row.dataVencimentoOriginal),
      presentValue: Number(row.valorPresente),
      currentPdd: Math.max(0, Number(row.valorPdd)),
    }));
  const referenceDate = latestStock ? dateKey(latestStock.dataReferencia) : null;
  const dates = referenceDate ? buildDates(referenceDate) : [];
  const historicalDates = referenceDate
    ? buildHistoricalDates(
        referenceDate,
        historicalTitles.map((title) => title.referenceDate)
      )
    : [];
  const matrixRows = dates.length > 0 ? buildMatrix(titles, dates) : [];
  const historicalMatrixRows =
    referenceDate && historicalDates.length > 0
      ? buildHistoricalMatrix(historicalTitles, titles, historicalDates, referenceDate)
      : [];
  const turnovers = dates.length > 0 ? buildTurnovers(titles, dates) : [];
  let latestDailySummary: {
    analiseJson: unknown;
    dataReferencia: Date;
    updatedAt: Date;
  } | null = null;

  if (latestStock) {
    try {
      latestDailySummary = await prisma.pddResumoDiario.findFirst({
        where: {
          nomeFundo: latestStock.nomeFundo,
        },
        orderBy: {
          dataReferencia: "desc",
        },
        select: {
          analiseJson: true,
          dataReferencia: true,
          updatedAt: true,
        },
      });
    } catch {
      latestDailySummary = null;
    }
  }
  const dailySummary: PddDailySummaryCard | null = latestDailySummary
    ? (() => {
        const analiseJson = normalizeDailySummaryJson(
          latestDailySummary.analiseJson
        );

        return analiseJson
          ? {
              analiseJson,
              dataReferenciaLabel: formatLongDateKey(
                dateKey(latestDailySummary.dataReferencia)
              ),
              updatedAtLabel: dateTimeFormatter.format(
                latestDailySummary.updatedAt
              ),
            }
          : null;
      })()
    : null;
  const summary: PddSummary | null =
    latestStock && referenceDate && dates.length > 0
      ? {
          referenceDateLabel: formatLongDateKey(referenceDate),
          fundName: latestStock.nomeFundo,
          titleCount: titles.length,
          cedentCount: matrixRows.length,
          debtorCount: new Set(
            titles.map((title) =>
              pddDebtorKey({
                debtorDocument: title.debtorDocument,
                debtorName: title.debtorName,
              })
            )
          ).size,
          presentValue: titles.reduce((total, title) => total + title.presentValue, 0),
          currentPdd: sumMatrixDate(matrixRows, dates[0].key),
          projectedSevenDaysPdd: sumMatrixDate(matrixRows, dates[7]?.key ?? dates.at(-1)!.key),
          projectedFifteenDaysPdd: sumMatrixDate(matrixRows, dates.at(-1)!.key),
        }
      : null;

  return (
    <div className="space-y-6">
      <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
        <form className="grid gap-4 md:grid-cols-[minmax(220px,1fr)_auto] md:items-end">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="fundId">
              Fundo
            </label>
            <select
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              defaultValue={selectedFund?.id}
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
          <button
            className="h-10 rounded bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
            type="submit"
          >
            Aplicar
          </button>
        </form>
      </section>

      {summary ? (
        <PddDashboard
          dailySummary={dailySummary}
          dates={dates}
          historicalDates={historicalDates}
          historicalRows={historicalMatrixRows}
          rows={matrixRows}
          summary={summary}
          turnovers={turnovers}
        />
      ) : (
        <section className="rounded border border-slate-200 bg-white p-6 shadow-executive">
          <h2 className="text-lg font-semibold text-slate-950">
            Nenhum estoque encontrado
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            O fundo selecionado ainda nao possui registros na tabela FIDC_ESTOQUES.
          </p>
        </section>
      )}
    </div>
  );
}
