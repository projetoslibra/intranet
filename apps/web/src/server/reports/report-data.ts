import { Prisma } from "@prisma/client";
import {
  ReportExportNotFoundError,
  type ReportExportFilters,
  type ReportPeriod,
  type ReportType,
} from "./report-export";

type QueryArgs = Record<string, unknown>;
type ExportRow = Record<string, unknown>;

type StockAvailabilityRow = { nomeFundo: string; dataReferencia: Date };
type SettledAvailabilityRow = { fundoNome: string; dataDaPosicao: Date };
type MovementAvailabilityRow = { nomeFundo: string; dataReferencia: Date; periodo: string };

export type ReportDateAvailability = { date: string; periods: ReportPeriod[] };
export type ReportFundAvailability = { fund: string; dates: ReportDateAvailability[] };
export type ReportAvailability = Record<ReportType, ReportFundAvailability[]>;

export type ReportsDatabase = {
  fidcEstoque: {
    groupBy(args: QueryArgs): Promise<StockAvailabilityRow[]>;
    findMany(args: QueryArgs): Promise<ExportRow[]>;
  };
  fidcLiquidadoBaixado: {
    groupBy(args: QueryArgs): Promise<SettledAvailabilityRow[]>;
    findMany(args: QueryArgs): Promise<ExportRow[]>;
  };
  fidcMovimentoAberto: {
    groupBy(args: QueryArgs): Promise<MovementAvailabilityRow[]>;
    findMany(args: QueryArgs): Promise<ExportRow[]>;
  };
};

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function groupedAvailability(rows: Array<{ fund: string; date: Date; period?: string }>) {
  const funds = new Map<string, Map<string, Set<ReportPeriod>>>();
  rows.forEach((row) => {
    const dates = funds.get(row.fund) ?? new Map<string, Set<ReportPeriod>>();
    const key = dateKey(row.date);
    const periods = dates.get(key) ?? new Set<ReportPeriod>();
    if (row.period === "MANHA" || row.period === "TARDE") periods.add(row.period);
    dates.set(key, periods);
    funds.set(row.fund, dates);
  });

  return Array.from(funds, ([fund, dates]) => ({
    fund,
    dates: Array.from(dates, ([date, periods]) => ({
      date,
      periods: Array.from(periods).sort((left, right) => left === right ? 0 : left === "MANHA" ? -1 : 1),
    })).sort((left, right) => right.date.localeCompare(left.date)),
  })).sort((left, right) => left.fund.localeCompare(right.fund, "pt-BR"));
}

export async function getReportAvailability() {
  const { prisma } = await import("@/lib/prisma");
  return getReportAvailabilityWithDependencies(prisma as unknown as ReportsDatabase);
}

export async function getReportAvailabilityWithDependencies(database: ReportsDatabase): Promise<ReportAvailability> {
  const [stock, settled, movements] = await Promise.all([
    database.fidcEstoque.groupBy({
      by: ["nomeFundo", "dataReferencia"],
      orderBy: [{ nomeFundo: "asc" }, { dataReferencia: "desc" }],
    }),
    database.fidcLiquidadoBaixado.groupBy({
      by: ["fundoNome", "dataDaPosicao"],
      orderBy: [{ fundoNome: "asc" }, { dataDaPosicao: "desc" }],
    }),
    database.fidcMovimentoAberto.groupBy({
      by: ["nomeFundo", "dataReferencia", "periodo"],
      orderBy: [{ nomeFundo: "asc" }, { dataReferencia: "desc" }, { periodo: "asc" }],
    }),
  ]);

  return {
    stock: groupedAvailability(stock.map((row) => ({ fund: row.nomeFundo, date: row.dataReferencia }))),
    settled: groupedAvailability(settled.map((row) => ({ fund: row.fundoNome, date: row.dataDaPosicao }))),
    "open-movements": groupedAvailability(movements.map((row) => ({ fund: row.nomeFundo, date: row.dataReferencia, period: row.periodo }))),
  };
}

const stockSelect = {
  nomeFundo: true,
  docFundo: true,
  dataFundo: true,
  nomeGestor: true,
  docGestor: true,
  nomeOriginador: true,
  docOriginador: true,
  nomeCedente: true,
  docCedente: true,
  nomeSacado: true,
  docSacado: true,
  seuNumero: true,
  numeroDocumento: true,
  tipoRecebivel: true,
  valorNominal: true,
  valorPresente: true,
  valorAquisicao: true,
  valorPdd: true,
  faixaPdd: true,
  dataReferencia: true,
  dataVencimentoOriginal: true,
  dataVencimentoAjustada: true,
  dataEmissao: true,
  dataAquisicao: true,
  prazo: true,
  prazoAnual: true,
  situacaoRecebivel: true,
  taxaCessao: true,
  taxaRecebivel: true,
  coobrigacao: true,
} satisfies Prisma.FidcEstoqueSelect;

const settledSelect = {
  fundoNome: true,
  fundoCnpj: true,
  dataDaPosicao: true,
  cedente: true,
  identificacaoCedente: true,
  sacado: true,
  identificacaoSacado: true,
  txAquisicao: true,
  idRecebivel: true,
  valorAquisicao: true,
  valorVencimento: true,
  dataAquisicao: true,
  dataVencimento: true,
  valorPago: true,
  stRecebivel: true,
  ajuste: true,
  numeroCorrespondente: true,
  seuNumero: true,
  documento: true,
  tipoRecebivel: true,
  tipoMovimento: true,
} satisfies Prisma.FidcLiquidadoBaixadoSelect;

const openMovementSelect = {
  nomeFundo: true,
  docFundo: true,
  dataMovimento: true,
  seuNumero: true,
  numeroDocumento: true,
  tipoMovimento: true,
  dataVencimento: true,
  valorAquisicao: true,
  valorNominal: true,
  valorMovimentacao: true,
  dataReferencia: true,
  periodo: true,
} satisfies Prisma.FidcMovimentoAbertoSelect;

export async function getReportRows(type: ReportType, filters: ReportExportFilters) {
  const { prisma } = await import("@/lib/prisma");
  return getReportRowsWithDependencies(type, filters, prisma as unknown as ReportsDatabase);
}

export async function getReportRowsWithDependencies(
  type: ReportType,
  filters: ReportExportFilters,
  database: ReportsDatabase,
) {
  const selectedDate = new Date(`${filters.date}T00:00:00.000Z`);
  let rows: ExportRow[];

  if (type === "stock") {
    rows = await database.fidcEstoque.findMany({
      where: { nomeFundo: filters.fund, dataReferencia: selectedDate },
      select: stockSelect,
      orderBy: [{ nomeCedente: "asc" }, { nomeSacado: "asc" }, { dataVencimentoOriginal: "asc" }, { numeroDocumento: "asc" }],
    });
  } else if (type === "settled") {
    rows = await database.fidcLiquidadoBaixado.findMany({
      where: { fundoNome: filters.fund, dataDaPosicao: selectedDate },
      select: settledSelect,
      orderBy: [{ cedente: "asc" }, { sacado: "asc" }, { dataVencimento: "asc" }, { documento: "asc" }],
    });
  } else {
    rows = await database.fidcMovimentoAberto.findMany({
      where: { nomeFundo: filters.fund, dataReferencia: selectedDate, periodo: filters.period },
      select: openMovementSelect,
      orderBy: [{ dataMovimento: "asc" }, { tipoMovimento: "asc" }, { numeroDocumento: "asc" }],
    });
  }

  if (!rows.length) throw new ReportExportNotFoundError("Não existem dados para os filtros selecionados.");
  return rows;
}
