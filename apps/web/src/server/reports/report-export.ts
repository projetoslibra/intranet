import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";

export type ReportType = "stock" | "settled" | "open-movements";
export type ReportPeriod = "MANHA" | "TARDE";
export type ReportExportFilters = {
  fund: string;
  date: string;
  period?: ReportPeriod;
};

type ExportRow = Record<string, unknown>;

export class ReportExportInputError extends Error {}
export class ReportExportNotFoundError extends Error {}

function requiredText(params: URLSearchParams, key: string, message: string) {
  const value = params.get(key)?.trim();
  if (!value) throw new ReportExportInputError(message);
  return value;
}

function validDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

export function parseReportExportFilters(type: ReportType, params: URLSearchParams): ReportExportFilters {
  const fund = requiredText(params, "fund", "Selecione um fundo.");
  const date = requiredText(params, "date", "Informe uma data válida.");
  if (!validDateKey(date)) throw new ReportExportInputError("Informe uma data válida.");

  if (type !== "open-movements") return { fund, date };

  const period = params.get("period")?.trim().toUpperCase();
  if (period !== "MANHA" && period !== "TARDE") {
    throw new ReportExportInputError("Selecione o período Manhã ou Tarde.");
  }
  return { fund, date, period };
}

const EXCEL_EPOCH_DAYS = 25_569;
const MILLISECONDS_PER_DAY = 86_400_000;

function dateCell(value: unknown) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()) / MILLISECONDS_PER_DAY + EXCEL_EPOCH_DAYS;
}

function decimalCell(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  const decimal = new Prisma.Decimal(value as Prisma.Decimal.Value);
  const canonical = decimal.toFixed(10);
  const numeric = Number(canonical);
  if (!Number.isFinite(numeric)) return canonical;
  return new Prisma.Decimal(numeric.toString()).toFixed(10) === canonical ? numeric : canonical;
}

function textCell(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function stockRows(rows: ReadonlyArray<ExportRow>) {
  return rows.map((row) => ({
    Fundo: textCell(row.nomeFundo),
    "CNPJ do fundo": textCell(row.docFundo),
    "Data do fundo": dateCell(row.dataFundo),
    Gestor: textCell(row.nomeGestor),
    "Documento do gestor": textCell(row.docGestor),
    Originador: textCell(row.nomeOriginador),
    "Documento do originador": textCell(row.docOriginador),
    Cedente: textCell(row.nomeCedente),
    "Documento do cedente": textCell(row.docCedente),
    Sacado: textCell(row.nomeSacado),
    "Documento do sacado": textCell(row.docSacado),
    "Seu número": textCell(row.seuNumero),
    "Número do documento": textCell(row.numeroDocumento),
    "Tipo de recebível": textCell(row.tipoRecebivel),
    "Valor nominal": decimalCell(row.valorNominal),
    "Valor presente": decimalCell(row.valorPresente),
    "Valor de aquisição": decimalCell(row.valorAquisicao),
    "Valor PDD": decimalCell(row.valorPdd),
    "Faixa PDD": textCell(row.faixaPdd),
    "Data de referência": dateCell(row.dataReferencia),
    "Vencimento original": dateCell(row.dataVencimentoOriginal),
    "Vencimento ajustado": dateCell(row.dataVencimentoAjustada),
    "Data de emissão": dateCell(row.dataEmissao),
    "Data de aquisição": dateCell(row.dataAquisicao),
    Prazo: row.prazo ?? "",
    "Prazo anual": row.prazoAnual ?? "",
    "Situação do recebível": textCell(row.situacaoRecebivel),
    "Taxa de cessão": decimalCell(row.taxaCessao),
    "Taxa do recebível": decimalCell(row.taxaRecebivel),
    Coobrigação: textCell(row.coobrigacao),
  }));
}

function settledRows(rows: ReadonlyArray<ExportRow>) {
  return rows.map((row) => ({
    Fundo: textCell(row.fundoNome),
    "CNPJ do fundo": textCell(row.fundoCnpj),
    "Data da posição": dateCell(row.dataDaPosicao),
    Cedente: textCell(row.cedente),
    "Documento do cedente": textCell(row.identificacaoCedente),
    Sacado: textCell(row.sacado),
    "Documento do sacado": textCell(row.identificacaoSacado),
    "Taxa de aquisição": decimalCell(row.txAquisicao),
    "ID do recebível": textCell(row.idRecebivel),
    "Valor de aquisição": decimalCell(row.valorAquisicao),
    "Valor de vencimento": decimalCell(row.valorVencimento),
    "Data de aquisição": dateCell(row.dataAquisicao),
    "Data de vencimento": dateCell(row.dataVencimento),
    "Valor pago": decimalCell(row.valorPago),
    "Status do recebível": textCell(row.stRecebivel),
    Ajuste: decimalCell(row.ajuste),
    "Número correspondente": textCell(row.numeroCorrespondente),
    "Seu número": textCell(row.seuNumero),
    Documento: textCell(row.documento),
    "Tipo de recebível": textCell(row.tipoRecebivel),
    "Tipo de movimento": textCell(row.tipoMovimento),
  }));
}

function openMovementRows(rows: ReadonlyArray<ExportRow>) {
  return rows.map((row) => ({
    Fundo: textCell(row.nomeFundo),
    "CNPJ do fundo": textCell(row.docFundo),
    "Data do movimento": dateCell(row.dataMovimento),
    "Seu número": textCell(row.seuNumero),
    "Número do documento": textCell(row.numeroDocumento),
    "Tipo de movimento": textCell(row.tipoMovimento),
    "Data de vencimento": dateCell(row.dataVencimento),
    "Valor de aquisição": decimalCell(row.valorAquisicao),
    "Valor nominal": decimalCell(row.valorNominal),
    "Valor movimentado": decimalCell(row.valorMovimentacao),
    "Data de referência": dateCell(row.dataReferencia),
    Período: row.periodo === "MANHA" ? "Manhã" : row.periodo === "TARDE" ? "Tarde" : textCell(row.periodo),
  }));
}

const workbookDefinitions = {
  stock: {
    sheetName: "Estoque",
    mapRows: stockRows,
    dateColumns: [2, 19, 20, 21, 22, 23],
    moneyColumns: [14, 15, 16, 17],
    decimalColumns: [27, 28],
  },
  settled: {
    sheetName: "Liquidados",
    mapRows: settledRows,
    dateColumns: [2, 11, 12],
    moneyColumns: [9, 10, 13, 15],
    decimalColumns: [7],
  },
  "open-movements": {
    sheetName: "Movimentos em aberto",
    mapRows: openMovementRows,
    dateColumns: [2, 6, 10],
    moneyColumns: [7, 8, 9],
    decimalColumns: [],
  },
} satisfies Record<ReportType, {
  sheetName: string;
  mapRows: (rows: ReadonlyArray<ExportRow>) => Array<Record<string, unknown>>;
  dateColumns: number[];
  moneyColumns: number[];
  decimalColumns: number[];
}>;

function formatColumn(sheet: XLSX.WorkSheet, columnIndex: number, rowCount: number, format: string) {
  const column = XLSX.utils.encode_col(columnIndex);
  for (let row = 2; row <= rowCount + 1; row += 1) {
    const cell = sheet[`${column}${row}`];
    if (cell && typeof cell.v === "number") cell.z = format;
  }
}

function columnWidths(headers: string[]) {
  return headers.map((header) => ({ wch: Math.min(38, Math.max(14, header.length + 2)) }));
}

export function buildReportWorkbook(type: ReportType, sourceRows: ReadonlyArray<ExportRow>): Buffer {
  const definition = workbookDefinitions[type];
  const rows = definition.mapRows(sourceRows);
  const sheet = XLSX.utils.json_to_sheet(rows);
  const headers = rows.length ? Object.keys(rows[0]) : [];

  definition.dateColumns.forEach((column) => formatColumn(sheet, column, rows.length, "dd/mm/yyyy"));
  definition.moneyColumns.forEach((column) => formatColumn(sheet, column, rows.length, "#,##0.00"));
  definition.decimalColumns.forEach((column) => formatColumn(sheet, column, rows.length, "#,##0.0000000000"));
  sheet["!cols"] = columnWidths(headers);
  if (sheet["!ref"]) sheet["!autofilter"] = { ref: sheet["!ref"] };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, definition.sheetName);
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}

export async function resolveReportExportAccess(
  userId: string | null | undefined,
  checkPermission: (permission: "reports.export") => Promise<boolean>,
) {
  if (!userId) return { status: 401, message: "Sessão expirada." } as const;
  if (!(await checkPermission("reports.export"))) {
    return { status: 403, message: "Sem permissão para exportar relatórios." } as const;
  }
  return null;
}

export function classifyReportExportError(error: unknown) {
  if (error instanceof ReportExportInputError) return { status: 400, message: error.message, internal: false } as const;
  if (error instanceof ReportExportNotFoundError) return { status: 404, message: error.message, internal: false } as const;
  return { status: 500, message: "Erro interno ao gerar o relatório.", internal: true } as const;
}
