import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { z } from "zod";
import { parseDateOnly, saoPauloDayRange } from "./consignado-date";
import { excelMoneyCellValue, excelSaoPauloDateTimeSerial } from "./consignado-exclusion-report";

export const differenceCategories = ["BANK_FEE", "UNIDENTIFIED_CREDIT", "VALUE_DIFFERENCE", "ROUNDING", "TIMING_DIFFERENCE", "OTHER"] as const;
export const differenceDirections = ["ENTRY_EXCESS", "REMITTANCE_EXCESS"] as const;
export const differenceStatuses = ["OPEN", "RESOLVED", "CANCELLED"] as const;
export const DIFFERENCE_REPORT_DEFAULT_LIMIT = 50;
export const DIFFERENCE_REPORT_MAX_LIMIT = 100;
export const DIFFERENCE_SCAN_BATCH_SIZE = 500;
export const DIFFERENCE_REPORT_MAX_SCAN_ROWS = 50_000;
export const DIFFERENCE_EXPORT_MAX_ROWS = 10_000;
export const DIFFERENCE_REPORT_CACHE_CONTROL = "private, no-store, max-age=0";

export type DifferenceCategory = (typeof differenceCategories)[number];
export type DifferenceDirection = (typeof differenceDirections)[number];
export type DifferenceStatus = (typeof differenceStatuses)[number];
export type DifferenceReportFilters = {
  createdFrom?: string;
  createdTo?: string;
  status?: DifferenceStatus;
  category?: DifferenceCategory;
  direction?: DifferenceDirection;
  entry?: string;
  remittance?: string;
  search?: string;
  limit: number;
  cursor?: string;
};

export class DifferenceReportInputError extends Error {
  constructor(message: string) { super(message); this.name = "DifferenceReportInputError"; }
}

export class DifferenceReportConflictError extends Error {
  constructor(message: string) { super(message); this.name = "DifferenceReportConflictError"; }
}

export class DifferenceReportLimitError extends Error {
  constructor(message: string) { super(message); this.name = "DifferenceReportLimitError"; }
}

type DecimalValue = Prisma.Decimal | string | number;
type EntryRecord = { id: string; transactionDate: Date; description: string; document: string | null };
type RemittanceRecord = { id: string; fileName: string; batch: { id: string; fileName: string } };
type DifferenceRecord = {
  id: string;
  category: string;
  direction: string;
  amount: DecimalValue;
  reason: string;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  cancelledAt: Date | null;
  createdBy: { id: string; name: string };
  resolvedBy: { id: string; name: string } | null;
  reconciliation: {
    id: string;
    status: string;
    createdAt: Date;
    allocations: ReadonlyArray<{ bankEntry: EntryRecord; remittance: RemittanceRecord }>;
    adjustments: ReadonlyArray<{ bankEntry: EntryRecord | null; remittance: RemittanceRecord | null }>;
  };
};

export type DifferenceReportEntry = {
  id: string;
  transactionDate: string;
  description: string;
  document: string | null;
};

export type DifferenceReportRemittance = {
  id: string;
  fileName: string;
  batchId: string;
  batchFile: string;
};

export type DifferenceReportItem = {
  id: string;
  reconciliationId: string;
  reconciliationStatus: string;
  category: DifferenceCategory;
  direction: DifferenceDirection;
  amount: string;
  reason: string;
  status: DifferenceStatus;
  createdAt: string;
  createdBy: { id: string; name: string };
  resolvedAt: string | null;
  resolvedBy: { id: string; name: string } | null;
  resolutionNote: string | null;
  cancelledAt: string | null;
  ageDays: number;
  entries: DifferenceReportEntry[];
  remittances: DifferenceReportRemittance[];
};

type SummaryValue = { count: number; amount: string };
type SummaryGroup<Key extends string> = SummaryValue & { key: Key };
export type DifferenceSummary = {
  open: SummaryValue;
  byCategory: Array<SummaryGroup<DifferenceCategory>>;
  byDirection: Array<SummaryGroup<DifferenceDirection>>;
};
export type DifferenceReport = {
  filters: DifferenceReportFilters;
  items: DifferenceReportItem[];
  summary: DifferenceSummary;
  page: { limit: number; nextCursor: string | null; hasMore: boolean };
};

type ReportDatabase = {
  consignadoBankOtherDifference: {
    findMany(args: Record<string, unknown>): Promise<ReadonlyArray<DifferenceRecord>>;
  };
};
type ReportLimits = { maxScanRows: number; maxExportRows: number };
type ReportDependencies = {
  database: ReportDatabase;
  now: () => Date;
  limits?: Partial<ReportLimits>;
};

export const differenceCategoryLabels: Record<DifferenceCategory, string> = {
  BANK_FEE: "Tarifa bancária",
  UNIDENTIFIED_CREDIT: "Crédito não identificado",
  VALUE_DIFFERENCE: "Diferença de valor",
  ROUNDING: "Arredondamento",
  TIMING_DIFFERENCE: "Diferença de competência",
  OTHER: "Outro",
};
export const differenceDirectionLabels: Record<DifferenceDirection, string> = {
  ENTRY_EXCESS: "Excesso de entrada",
  REMITTANCE_EXCESS: "Excesso de remessa",
};
export const differenceStatusLabels: Record<DifferenceStatus, string> = {
  OPEN: "Em aberto",
  RESOLVED: "Resolvido",
  CANCELLED: "Cancelado",
};

const filterLabels: Array<[Exclude<keyof DifferenceReportFilters, "limit" | "cursor">, string]> = [
  ["createdFrom", "Criada desde"],
  ["createdTo", "Criada até"],
  ["status", "Status"],
  ["category", "Categoria"],
  ["direction", "Direção"],
  ["entry", "Entrada"],
  ["remittance", "Remessa"],
  ["search", "Busca"],
];
const textLimits = { entry: 120, remittance: 180, search: 120, cursor: 191 } as const;

function trimmed(params: URLSearchParams, key: string) {
  const value = params.get(key)?.trim();
  return value || undefined;
}

function isOneOf<T extends string>(value: string | undefined, values: readonly T[]): value is T {
  return Boolean(value && (values as readonly string[]).includes(value));
}

function validateText(value: string | undefined, label: string, maximum: number) {
  if (value && value.length > maximum) throw new DifferenceReportInputError(`${label} deve possuir no máximo ${maximum} caracteres.`);
}

export function parseDifferenceReportFilters(params: URLSearchParams): DifferenceReportFilters {
  const createdFrom = trimmed(params, "createdFrom");
  const createdTo = trimmed(params, "createdTo");
  const status = trimmed(params, "status")?.toUpperCase();
  const category = trimmed(params, "category")?.toUpperCase();
  const direction = trimmed(params, "direction")?.toUpperCase();
  const entry = trimmed(params, "entry");
  const remittance = trimmed(params, "remittance");
  const search = trimmed(params, "search");
  const cursor = trimmed(params, "cursor");
  const limitText = trimmed(params, "limit");
  const limit = limitText ? Number(limitText) : DIFFERENCE_REPORT_DEFAULT_LIMIT;
  try {
    if (createdFrom) parseDateOnly(createdFrom);
    if (createdTo) parseDateOnly(createdTo);
  } catch (error) {
    throw new DifferenceReportInputError(error instanceof Error ? error.message : "Data inválida.");
  }
  if (createdFrom && createdTo && createdFrom > createdTo) throw new DifferenceReportInputError("Período inválido: a data inicial deve ser anterior à data final.");
  if (status && !isOneOf(status, differenceStatuses)) throw new DifferenceReportInputError("Status inválido.");
  if (category && !isOneOf(category, differenceCategories)) throw new DifferenceReportInputError("Categoria inválida.");
  if (direction && !isOneOf(direction, differenceDirections)) throw new DifferenceReportInputError("Direção inválida.");
  if (!Number.isInteger(limit) || limit < 1 || limit > DIFFERENCE_REPORT_MAX_LIMIT) throw new DifferenceReportInputError(`Limite inválido. Informe um inteiro entre 1 e ${DIFFERENCE_REPORT_MAX_LIMIT}.`);
  validateText(entry, "Entrada", textLimits.entry);
  validateText(remittance, "Remessa", textLimits.remittance);
  validateText(search, "Busca", textLimits.search);
  validateText(cursor, "Cursor", textLimits.cursor);
  return {
    ...(createdFrom ? { createdFrom } : {}),
    ...(createdTo ? { createdTo } : {}),
    ...(status ? { status: status as DifferenceStatus } : {}),
    ...(category ? { category: category as DifferenceCategory } : {}),
    ...(direction ? { direction: direction as DifferenceDirection } : {}),
    ...(entry ? { entry } : {}),
    ...(remittance ? { remittance } : {}),
    ...(search ? { search } : {}),
    limit,
    ...(cursor ? { cursor } : {}),
  };
}

function normalized(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("pt-BR");
}

function uniqueEntries(record: DifferenceRecord) {
  const entries = new Map<string, EntryRecord>();
  record.reconciliation.allocations.forEach((allocation) => entries.set(allocation.bankEntry.id, allocation.bankEntry));
  record.reconciliation.adjustments.forEach((adjustment) => {
    if (adjustment.bankEntry) entries.set(adjustment.bankEntry.id, adjustment.bankEntry);
  });
  return [...entries.values()];
}

function uniqueRemittances(record: DifferenceRecord) {
  const remittances = new Map<string, RemittanceRecord>();
  record.reconciliation.allocations.forEach((allocation) => remittances.set(allocation.remittance.id, allocation.remittance));
  record.reconciliation.adjustments.forEach((adjustment) => {
    if (adjustment.remittance) remittances.set(adjustment.remittance.id, adjustment.remittance);
  });
  return [...remittances.values()];
}

function isPending(record: DifferenceRecord) {
  return record.status === "OPEN" && record.reconciliation.status === "ACTIVE";
}

function matches(record: DifferenceRecord, filters: DifferenceReportFilters) {
  if (record.status === "OPEN" && record.reconciliation.status !== "ACTIVE") return false;
  const createdAt = record.createdAt.getTime();
  if (filters.createdFrom && createdAt < saoPauloDayRange(filters.createdFrom).gte.getTime()) return false;
  if (filters.createdTo && createdAt >= saoPauloDayRange(filters.createdTo).lt.getTime()) return false;
  if (filters.status && record.status !== filters.status) return false;
  if (filters.category && record.category !== filters.category) return false;
  if (filters.direction && record.direction !== filters.direction) return false;
  const entries = uniqueEntries(record);
  const remittances = uniqueRemittances(record);
  if (filters.entry) {
    const needle = normalized(filters.entry);
    if (!entries.some((item) => [item.id, item.description, item.document].some((value) => normalized(value).includes(needle)))) return false;
  }
  if (filters.remittance) {
    const needle = normalized(filters.remittance);
    if (!remittances.some((item) => [item.id, item.fileName, item.batch.id, item.batch.fileName].some((value) => normalized(value).includes(needle)))) return false;
  }
  if (filters.search) {
    const needle = normalized(filters.search);
    const values = [
      record.id,
      record.reconciliation.id,
      record.reason,
      record.resolutionNote,
      record.createdBy.name,
      record.resolvedBy?.name,
      differenceCategoryLabels[record.category as DifferenceCategory],
      differenceDirectionLabels[record.direction as DifferenceDirection],
      differenceStatusLabels[record.status as DifferenceStatus],
      ...entries.flatMap((item) => [item.id, item.description, item.document]),
      ...remittances.flatMap((item) => [item.id, item.fileName, item.batch.id, item.batch.fileName]),
    ];
    if (!values.some((value) => normalized(value).includes(needle))) return false;
  }
  return true;
}

function statusWhere(status: DifferenceStatus | undefined): Prisma.ConsignadoBankOtherDifferenceWhereInput {
  if (status === "OPEN") return { status: "OPEN", reconciliation: { status: "ACTIVE" } };
  if (status) return { status };
  return { OR: [
    { status: "OPEN", reconciliation: { status: "ACTIVE" } },
    { status: { in: ["RESOLVED", "CANCELLED"] } },
  ] };
}

function databaseWhere(filters: DifferenceReportFilters): Prisma.ConsignadoBankOtherDifferenceWhereInput {
  const createdAt = {
    ...(filters.createdFrom ? { gte: saoPauloDayRange(filters.createdFrom).gte } : {}),
    ...(filters.createdTo ? { lt: saoPauloDayRange(filters.createdTo).lt } : {}),
  };
  return {
    ...statusWhere(filters.status),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.direction ? { direction: filters.direction } : {}),
    ...(Object.keys(createdAt).length ? { createdAt } : {}),
  };
}

const differenceSelect = {
  id: true,
  category: true,
  direction: true,
  amount: true,
  reason: true,
  status: true,
  createdAt: true,
  resolvedAt: true,
  resolutionNote: true,
  cancelledAt: true,
  createdBy: { select: { id: true, name: true } },
  resolvedBy: { select: { id: true, name: true } },
  reconciliation: { select: {
    id: true,
    status: true,
    createdAt: true,
    allocations: { select: {
      bankEntry: { select: { id: true, transactionDate: true, description: true, document: true } },
      remittance: { select: { id: true, fileName: true, batch: { select: { id: true, fileName: true } } } },
    } },
    adjustments: { select: {
      bankEntry: { select: { id: true, transactionDate: true, description: true, document: true } },
      remittance: { select: { id: true, fileName: true, batch: { select: { id: true, fileName: true } } } },
    } },
  } },
} satisfies Prisma.ConsignadoBankOtherDifferenceSelect;

function saoPauloCivilDayIndex(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  return Math.floor(Date.UTC(part("year"), part("month") - 1, part("day")) / 86_400_000);
}

function mapRecord(record: DifferenceRecord, now: Date): DifferenceReportItem {
  const terminalAt = record.resolvedAt ?? record.cancelledAt ?? now;
  const ageDays = Math.max(0, saoPauloCivilDayIndex(terminalAt) - saoPauloCivilDayIndex(record.createdAt));
  return {
    id: record.id,
    reconciliationId: record.reconciliation.id,
    reconciliationStatus: record.reconciliation.status,
    category: record.category as DifferenceCategory,
    direction: record.direction as DifferenceDirection,
    amount: new Prisma.Decimal(record.amount).toFixed(2),
    reason: record.reason,
    status: record.status as DifferenceStatus,
    createdAt: record.createdAt.toISOString(),
    createdBy: record.createdBy,
    resolvedAt: record.resolvedAt?.toISOString() ?? null,
    resolvedBy: record.resolvedBy,
    resolutionNote: record.resolutionNote,
    cancelledAt: record.cancelledAt?.toISOString() ?? null,
    ageDays,
    entries: uniqueEntries(record).map((entry) => ({ ...entry, transactionDate: entry.transactionDate.toISOString() })),
    remittances: uniqueRemittances(record).map((remittance) => ({
      id: remittance.id,
      fileName: remittance.fileName,
      batchId: remittance.batch.id,
      batchFile: remittance.batch.fileName,
    })),
  };
}

type MutableSummary = { count: number; amount: Prisma.Decimal };
function emptySummary(): MutableSummary { return { count: 0, amount: new Prisma.Decimal(0) }; }
function addSummary(target: MutableSummary, record: DifferenceRecord) {
  target.count += 1;
  target.amount = target.amount.add(record.amount);
}
function serializeSummary(value: MutableSummary): SummaryValue { return { count: value.count, amount: value.amount.toFixed(2) }; }
function summaryAccumulator() {
  const open = emptySummary();
  const byCategory = new Map<DifferenceCategory, MutableSummary>();
  const byDirection = new Map<DifferenceDirection, MutableSummary>();
  return {
    add(record: DifferenceRecord) {
      if (!isPending(record)) return;
      const category = record.category as DifferenceCategory;
      const direction = record.direction as DifferenceDirection;
      if (!byCategory.has(category)) byCategory.set(category, emptySummary());
      if (!byDirection.has(direction)) byDirection.set(direction, emptySummary());
      addSummary(open, record);
      addSummary(byCategory.get(category)!, record);
      addSummary(byDirection.get(direction)!, record);
    },
    result(): DifferenceSummary {
      return {
        open: serializeSummary(open),
        byCategory: differenceCategories.flatMap((key) => {
          const value = byCategory.get(key); return value ? [{ key, ...serializeSummary(value) }] : [];
        }),
        byDirection: differenceDirections.flatMap((key) => {
          const value = byDirection.get(key); return value ? [{ key, ...serializeSummary(value) }] : [];
        }),
      };
    },
  };
}

async function scanFiltered(
  filters: DifferenceReportFilters,
  dependencies: ReportDependencies,
  onMatch: (record: DifferenceRecord) => void,
) {
  const maxScanRows = dependencies.limits?.maxScanRows ?? DIFFERENCE_REPORT_MAX_SCAN_ROWS;
  let scanned = 0;
  let cursor: string | undefined;
  while (true) {
    const rows = await dependencies.database.consignadoBankOtherDifference.findMany({
      where: databaseWhere(filters),
      select: differenceSelect,
      take: DIFFERENCE_SCAN_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    if (!rows.length) break;
    for (const record of rows) {
      scanned += 1;
      if (scanned > maxScanRows) throw new DifferenceReportLimitError(`A consulta excedeu o teto operacional de ${maxScanRows.toLocaleString("pt-BR")} ajustes candidatos. Restrinja os filtros.`);
      if (matches(record, filters)) onMatch(record);
    }
    cursor = rows.at(-1)?.id;
    if (rows.length < DIFFERENCE_SCAN_BATCH_SIZE) break;
  }
}

export async function getDifferenceReport(filters: DifferenceReportFilters) {
  const { prisma } = await import("@/lib/prisma");
  return getDifferenceReportWithDependencies(filters, {
    database: prisma as unknown as ReportDatabase,
    now: () => new Date(),
  });
}

export async function getDifferenceReportWithDependencies(filters: DifferenceReportFilters, dependencies: ReportDependencies): Promise<DifferenceReport> {
  const summary = summaryAccumulator();
  const pageRecords: DifferenceRecord[] = [];
  let cursorSeen = !filters.cursor;
  let hasMore = false;
  await scanFiltered(filters, dependencies, (record) => {
    summary.add(record);
    if (!cursorSeen) {
      if (record.id === filters.cursor) cursorSeen = true;
      return;
    }
    if (pageRecords.length < filters.limit) pageRecords.push(record);
    else hasMore = true;
  });
  if (!cursorSeen) throw new DifferenceReportInputError("Cursor inválido para os filtros aplicados.");
  return {
    filters,
    items: pageRecords.map((record) => mapRecord(record, dependencies.now())),
    summary: summary.result(),
    page: { limit: filters.limit, nextCursor: hasMore ? pageRecords.at(-1)?.id ?? null : null, hasMore },
  };
}

export async function getDifferenceExportReport(filters: DifferenceReportFilters) {
  const { prisma } = await import("@/lib/prisma");
  return getDifferenceExportReportWithDependencies(filters, {
    database: prisma as unknown as ReportDatabase,
    now: () => new Date(),
  });
}

export async function getDifferenceExportReportWithDependencies(filters: DifferenceReportFilters, dependencies: ReportDependencies): Promise<DifferenceReport> {
  const summary = summaryAccumulator();
  const records: DifferenceRecord[] = [];
  const maxExportRows = dependencies.limits?.maxExportRows ?? DIFFERENCE_EXPORT_MAX_ROWS;
  const exportFilters = { ...filters, cursor: undefined };
  await scanFiltered(exportFilters, dependencies, (record) => {
    summary.add(record);
    records.push(record);
    if (records.length > maxExportRows) throw new DifferenceReportLimitError(`A exportação aceita no máximo ${maxExportRows.toLocaleString("pt-BR")} diferenças. Restrinja os filtros e tente novamente.`);
  });
  return {
    filters: exportFilters,
    items: records.map((record) => mapRecord(record, dependencies.now())),
    summary: summary.result(),
    page: { limit: maxExportRows, nextCursor: null, hasMore: false },
  };
}

type OverviewDatabase = {
  consignadoBankOtherDifference: {
    aggregate(args: Record<string, unknown>): Promise<{ _count: { _all: number }; _sum: { amount: DecimalValue | null } }>;
  };
};

export async function getOpenDifferenceOverview() {
  const { prisma } = await import("@/lib/prisma");
  return getOpenDifferenceOverviewWithDependencies(prisma as unknown as OverviewDatabase);
}

export async function getOpenDifferenceOverviewWithDependencies(database: OverviewDatabase) {
  const aggregate = await database.consignadoBankOtherDifference.aggregate({
    where: { status: "OPEN", reconciliation: { status: "ACTIVE" } },
    _count: { _all: true },
    _sum: { amount: true },
  });
  return {
    count: aggregate._count._all,
    amount: new Prisma.Decimal(aggregate._sum.amount ?? 0).toFixed(2),
  };
}

export type InitialDifferenceReportState =
  | { kind: "ready"; report: DifferenceReport; filters: DifferenceReportFilters; message: null }
  | { kind: "recoverable"; report: null; filters: DifferenceReportFilters; message: string };

const defaultDifferenceFilters = () => parseDifferenceReportFilters(new URLSearchParams());
const withoutDifferenceCursor = (filters: DifferenceReportFilters): DifferenceReportFilters => {
  const { cursor: _cursor, ...safeFilters } = filters;
  return safeFilters;
};

export async function loadInitialDifferenceReport(
  params: URLSearchParams,
  loadReport: (filters: DifferenceReportFilters) => Promise<DifferenceReport>,
): Promise<InitialDifferenceReportState> {
  let filters: DifferenceReportFilters;
  try {
    filters = parseDifferenceReportFilters(params);
  } catch (error) {
    if (error instanceof DifferenceReportInputError) {
      return { kind: "recoverable", report: null, filters: defaultDifferenceFilters(), message: error.message };
    }
    throw error;
  }
  try {
    const report = await loadReport(filters);
    return { kind: "ready", report, filters: report.filters, message: null };
  } catch (error) {
    if (error instanceof DifferenceReportInputError || error instanceof DifferenceReportLimitError) {
      return { kind: "recoverable", report: null, filters: withoutDifferenceCursor(filters), message: error.message };
    }
    throw error;
  }
}

function displayFilterValue(key: Exclude<keyof DifferenceReportFilters, "limit" | "cursor">, value: string) {
  if (key === "category" && isOneOf(value, differenceCategories)) return differenceCategoryLabels[value];
  if (key === "direction" && isOneOf(value, differenceDirections)) return differenceDirectionLabels[value];
  if (key === "status" && isOneOf(value, differenceStatuses)) return differenceStatusLabels[value];
  return value;
}

function formatCivilDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(value));
}

function entryLabels(item: DifferenceReportItem) {
  return item.entries.map((entry) => [formatCivilDate(entry.transactionDate), entry.description, entry.document].filter(Boolean).join(" · ")).join(" | ");
}

function remittanceLabels(item: DifferenceReportItem) {
  return item.remittances.map((remittance) => [remittance.fileName, remittance.batchFile].filter(Boolean).join(" · ")).join(" | ");
}

function setColumnFormat(sheet: XLSX.WorkSheet, column: string, rows: number, format: string) {
  for (let row = 2; row <= rows + 1; row += 1) {
    const cell = sheet[`${column}${row}`];
    if (cell && typeof cell.v === "number") cell.z = format;
  }
}

export function buildDifferenceWorkbook(report: DifferenceReport): Buffer {
  const filterRows = filterLabels.flatMap(([key, label]) => {
    const value = report.filters[key];
    return value ? [{ Indicador: label, Valor: displayFilterValue(key, value) }] : [];
  });
  const summaryRows: Array<Record<string, string | number>> = [
    ...filterRows,
    { Indicador: "Pendências em aberto", Valor: report.summary.open.count },
    { Indicador: "Valor em aberto", Valor: excelMoneyCellValue(report.summary.open.amount) },
    ...report.summary.byCategory.map((item) => ({ Indicador: `Categoria · ${differenceCategoryLabels[item.key]}`, Valor: `${item.count} pendência(s) · ${item.amount}` })),
    ...report.summary.byDirection.map((item) => ({ Indicador: `Direção · ${differenceDirectionLabels[item.key]}`, Valor: `${item.count} pendência(s) · ${item.amount}` })),
  ];
  const detailRows = report.items.map((item) => ({
    "Data da pendência": excelSaoPauloDateTimeSerial(item.createdAt),
    Status: differenceStatusLabels[item.status],
    Categoria: differenceCategoryLabels[item.category],
    Direção: differenceDirectionLabels[item.direction],
    Valor: excelMoneyCellValue(item.amount),
    Motivo: item.reason,
    Entrada: entryLabels(item),
    Remessa: remittanceLabels(item),
    Responsável: item.createdBy.name,
    "Idade (dias)": item.ageDays,
    "Resolvido em": item.resolvedAt ? excelSaoPauloDateTimeSerial(item.resolvedAt) : "",
    "Resolvido por": item.resolvedBy?.name ?? "",
    "Nota da resolução": item.resolutionNote ?? "",
    "Cancelado em": item.cancelledAt ? excelSaoPauloDateTimeSerial(item.cancelledAt) : "",
    Conciliação: item.reconciliationId,
  }));
  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows, { header: ["Indicador", "Valor"] });
  const detailHeaders = ["Data da pendência", "Status", "Categoria", "Direção", "Valor", "Motivo", "Entrada", "Remessa", "Responsável", "Idade (dias)", "Resolvido em", "Resolvido por", "Nota da resolução", "Cancelado em", "Conciliação"];
  const detailSheet = XLSX.utils.json_to_sheet(detailRows, { header: detailHeaders });
  setColumnFormat(detailSheet, "A", detailRows.length, "dd/mm/yyyy hh:mm:ss");
  setColumnFormat(detailSheet, "K", detailRows.length, "dd/mm/yyyy hh:mm:ss");
  setColumnFormat(detailSheet, "N", detailRows.length, "dd/mm/yyyy hh:mm:ss");
  summarySheet["!cols"] = [{ wch: 34 }, { wch: 60 }];
  detailSheet["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 28 }, { wch: 22 }, { wch: 20 }, { wch: 42 }, { wch: 50 }, { wch: 46 }, { wch: 24 }, { wch: 14 }, { wch: 20 }, { wch: 24 }, { wch: 42 }, { wch: 20 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumo");
  XLSX.utils.book_append_sheet(workbook, detailSheet, "Diferencas");
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}

export const differenceResolutionSchema = z.object({
  resolutionNote: z.string().trim().min(5, "A nota de resolução deve possuir ao menos 5 caracteres.").max(500, "A nota de resolução deve possuir no máximo 500 caracteres."),
}).strict();

export async function parseDifferenceResolutionRequest(request: Pick<Request, "json">) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new DifferenceReportInputError("JSON inválido no corpo da resolução.");
  }
  return differenceResolutionSchema.parse(payload);
}

export function transitionOtherDifference(status: string, note: string, userId: string, now: Date) {
  if (status === "RESOLVED") throw new DifferenceReportConflictError("Esta diferença já foi resolvida.");
  if (status === "CANCELLED") throw new DifferenceReportConflictError("Esta diferença foi cancelada e permanece apenas no histórico.");
  if (status !== "OPEN") throw new DifferenceReportConflictError("O status da diferença foi alterado por outro usuário.");
  const resolutionNote = differenceResolutionSchema.parse({ resolutionNote: note }).resolutionNote;
  return { status: "RESOLVED" as const, resolvedAt: now, resolvedByUserId: userId, resolutionNote };
}

type ResolutionDatabase = {
  $transaction<T>(operation: (tx: any) => Promise<T>, options?: unknown): Promise<T>;
};
type ResolutionDependencies = { database: ResolutionDatabase; now: () => Date };
const RESOLUTION_TRANSACTION_MAX_ATTEMPTS = 3;

function isSerializationConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

export async function resolveOtherDifference(id: string, userId: string, note: string) {
  const { prisma } = await import("@/lib/prisma");
  return resolveOtherDifferenceWithDependencies(id, userId, note, {
    database: prisma as unknown as ResolutionDatabase,
    now: () => new Date(),
  });
}

export async function resolveOtherDifferenceWithDependencies(id: string, userId: string, note: string, dependencies: ResolutionDependencies) {
  const resolutionNote = differenceResolutionSchema.parse({ resolutionNote: note }).resolutionNote;
  const runTransaction = () => dependencies.database.$transaction(async (tx) => {
    const current = await tx.consignadoBankOtherDifference.findUnique({
      where: { id },
      select: {
        id: true, status: true, category: true, direction: true, amount: true,
        reconciliationId: true, reconciliation: { select: { status: true } },
      },
    });
    if (!current) throw new DifferenceReportInputError("Diferença bancária não encontrada.");
    if (current.reconciliation.status !== "ACTIVE") {
      if (current.status === "CANCELLED") transitionOtherDifference(current.status, resolutionNote, userId, dependencies.now());
      throw new DifferenceReportConflictError("A conciliação não está ativa; a diferença permanece apenas no histórico.");
    }
    const transition = transitionOtherDifference(current.status, resolutionNote, userId, dependencies.now());
    const changed = await tx.consignadoBankOtherDifference.updateMany({
      where: { id, status: "OPEN", reconciliation: { status: "ACTIVE" } },
      data: transition,
    });
    if (changed.count !== 1) {
      const latest = await tx.consignadoBankOtherDifference.findUnique({ where: { id }, select: { status: true, reconciliation: { select: { status: true } } } });
      if (!latest) throw new DifferenceReportInputError("Diferença bancária não encontrada.");
      if (latest.reconciliation.status !== "ACTIVE") throw new DifferenceReportConflictError("A conciliação não está ativa; a diferença permanece apenas no histórico.");
      transitionOtherDifference(latest.status, resolutionNote, userId, dependencies.now());
      throw new DifferenceReportConflictError("A diferença foi alterada por outro usuário.");
    }
    await tx.consignadoStatusEvent.create({ data: {
      userId,
      entityType: "BANK_OTHER_DIFFERENCE",
      entityId: id,
      fromStatus: "OPEN",
      toStatus: "RESOLVED",
      metadata: {
        reconciliationId: current.reconciliationId,
        category: current.category,
        direction: current.direction,
        amount: new Prisma.Decimal(current.amount).toFixed(2),
        resolutionNote,
      },
    } });
    return { ...current, ...transition };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  for (let attempt = 1; attempt <= RESOLUTION_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await runTransaction();
    } catch (error) {
      if (!isSerializationConflict(error) || attempt === RESOLUTION_TRANSACTION_MAX_ATTEMPTS) throw error;
    }
  }
  throw new Error("Limite de tentativas transacionais inalcançável.");
}

export function differenceReportAccessFailure(userId: string | null | undefined, allowed: boolean) {
  if (!userId) return { status: 401, message: "Sessão expirada." } as const;
  if (!allowed) return { status: 403, message: "Sem permissão." } as const;
  return null;
}

export async function resolveDifferenceReportAccess(
  userId: string | null | undefined,
  mode: "view" | "manage",
  checkPermission: (permission: "operational.view" | "operational.finance.manage") => Promise<boolean>,
) {
  if (!userId) return differenceReportAccessFailure(userId, false);
  const permission = mode === "view" ? "operational.view" : "operational.finance.manage";
  return differenceReportAccessFailure(userId, await checkPermission(permission));
}

export function classifyDifferenceReportError(error: unknown) {
  if (error instanceof DifferenceReportInputError) return { status: 400, message: error.message, internal: false } as const;
  if (error instanceof z.ZodError) return { status: 400, message: error.issues[0]?.message ?? "Entrada inválida.", internal: false } as const;
  if (error instanceof DifferenceReportConflictError) return { status: 409, message: error.message, internal: false } as const;
  if (error instanceof DifferenceReportLimitError) return { status: 422, message: error.message, internal: false } as const;
  return { status: 500, message: "Erro interno ao processar diferenças bancárias.", internal: true } as const;
}
