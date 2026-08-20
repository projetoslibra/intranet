import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { parseDateOnly, saoPauloDayRange } from "./consignado-date";

export const exclusionCategories = ["NOT_FOUND_IN_STOCK", "OPERATOR_EXCLUDED", "NOT_APPROVED", "PDD_RECOVERY", "OTHER_DIVERGENCE"] as const;
export const exclusionSituations = ["AVAILABLE", "ACTIVE_RECONCILIATION", "UNDONE_HISTORY"] as const;
export const exclusionSources = ["BMP", "UY3"] as const;
export const EXCLUSION_REPORT_DEFAULT_LIMIT = 50;
export const EXCLUSION_REPORT_MAX_LIMIT = 100;
export const EXCLUSION_SCAN_BATCH_SIZE = 500;
export const EXCLUSION_DETAIL_BATCH_SIZE = 500;
export const EXCLUSION_REPORT_MAX_SCAN_ROWS = 50_000;
export const EXCLUSION_EXPORT_MAX_ROWS = 10_000;

export type ExclusionCategory = (typeof exclusionCategories)[number];
export type ExclusionSituation = (typeof exclusionSituations)[number];
export type ExclusionSource = (typeof exclusionSources)[number];
export type ExclusionReportFilters = {
  generatedFrom?: string; generatedTo?: string; source?: ExclusionSource; originator?: string;
  batchFile?: string; remittanceFile?: string; category?: ExclusionCategory; situation?: ExclusionSituation;
  search?: string; batchId?: string; remittanceId?: string; limit: number; cursor?: string;
};

export class ExclusionReportInputError extends Error {
  constructor(message: string) { super(message); this.name = "ExclusionReportInputError"; }
}
export class ExclusionReportLimitError extends Error {
  constructor(message: string) { super(message); this.name = "ExclusionReportLimitError"; }
}

type DecimalValue = Prisma.Decimal | string | number;
type OriginatorRecord = { code: string; name: string } | null;
type ScanRecord = {
  id: string; category: string; titleAmount: DecimalValue; paidAmount: DecimalValue;
  remittance: { id: string; fileName: string; generatedAt: Date; batch: { id: string; source: string; fileName: string; originator: OriginatorRecord } };
  settlementItem: { contractNumber: string | null; debtorName: string | null; debtorDocument: string | null };
  differenceTitles: ReadonlyArray<{ reconciliation: { status: string } }>;
};
type DetailRecord = Omit<ScanRecord, "settlementItem" | "differenceTitles"> & {
  reason: string;
  settlementItem: ScanRecord["settlementItem"] & { sourceRow: number; documentNumber: string | null; yourNumber: string | null; dueDate: Date | null };
  differenceTitles: ReadonlyArray<{ reconciliation: {
    id: string; status: string; createdAt: Date;
    allocations: ReadonlyArray<{ bankEntry: { transactionDate: Date; description: string; document: string | null } }>;
  } }>;
};

export type ExclusionReportItem = {
  id: string; generatedAt: string; source: string; originator: string; originatorCode: string;
  batchId: string; batchFile: string; remittanceId: string; remittanceFile: string; sourceRow: number;
  contractNumber: string | null; documentNumber: string | null; yourNumber: string | null;
  debtorName: string | null; debtorDocument: string | null; dueDate: string | null;
  titleAmount: string; paidAmount: string; category: ExclusionCategory; reason: string; situation: ExclusionSituation;
  reconciliationId: string | null; reconciliationDate: string | null; bankEntry: string | null;
};
type SummaryValue = { count: number; titleAmount: string; paidAmount: string };
type SummaryGroup<Key extends string> = SummaryValue & { key: Key };
type ExclusionSummary = { total: SummaryValue; byCategory: Array<SummaryGroup<ExclusionCategory>>; bySituation: Array<SummaryGroup<ExclusionSituation>> };
export type ExclusionReport = {
  filters: ExclusionReportFilters; items: ExclusionReportItem[]; summary: ExclusionSummary;
  page: { limit: number; nextCursor: string | null; hasMore: boolean };
};

type ReportDatabase = {
  fund: { findMany(args: unknown): Promise<ReadonlyArray<{ id: string; cnpj: string; name: string }>> };
  consignadoRemittanceExclusion: { findMany(args: Record<string, unknown>): Promise<ReadonlyArray<ScanRecord | DetailRecord>> };
};
type ReportLimits = { maxScanRows: number; maxExportRows: number };
type ReportDependencies = { database: ReportDatabase; limits?: Partial<ReportLimits> };

const categoryLabels: Record<ExclusionCategory, string> = {
  NOT_FOUND_IN_STOCK: "Não encontrado no estoque", OPERATOR_EXCLUDED: "Excluído pelo operador",
  NOT_APPROVED: "Não aprovado", PDD_RECOVERY: "Recuperação de PDD", OTHER_DIVERGENCE: "Outra divergência",
};
const situationLabels: Record<ExclusionSituation, string> = {
  AVAILABLE: "Pendente", ACTIVE_RECONCILIATION: "Usado em conciliação ativa", UNDONE_HISTORY: "Histórico desfeito",
};
const filterLabels: Array<[Exclude<keyof ExclusionReportFilters, "limit" | "cursor">, string]> = [
  ["generatedFrom", "Remessa gerada desde"], ["generatedTo", "Remessa gerada até"], ["source", "Fluxo"],
  ["originator", "Originador"], ["batchFile", "Arquivo do lote"], ["remittanceFile", "Arquivo da remessa"],
  ["category", "Categoria"], ["situation", "Situação"], ["search", "Busca"], ["batchId", "ID do lote"], ["remittanceId", "ID da remessa"],
];
const textLimits = { originator: 80, batchFile: 180, remittanceFile: 180, search: 120, batchId: 191, remittanceId: 191, cursor: 191 } as const;

function trimmed(params: URLSearchParams, key: string) { const value = params.get(key)?.trim(); return value || undefined; }
function isOneOf<T extends string>(value: string | undefined, values: readonly T[]): value is T { return Boolean(value && (values as readonly string[]).includes(value)); }
function validateText(value: string | undefined, label: string, max: number) {
  if (value && value.length > max) throw new ExclusionReportInputError(`${label} deve possuir no máximo ${max} caracteres.`);
}

export function parseExclusionReportFilters(params: URLSearchParams): ExclusionReportFilters {
  const generatedFrom = trimmed(params, "generatedFrom"); const generatedTo = trimmed(params, "generatedTo");
  const source = trimmed(params, "source")?.toUpperCase(); const originator = trimmed(params, "originator");
  const batchFile = trimmed(params, "batchFile"); const remittanceFile = trimmed(params, "remittanceFile");
  const category = trimmed(params, "category")?.toUpperCase(); const situation = trimmed(params, "situation")?.toUpperCase();
  const search = trimmed(params, "search"); const batchId = trimmed(params, "batchId");
  const remittanceId = trimmed(params, "remittanceId"); const cursor = trimmed(params, "cursor");
  const limitText = trimmed(params, "limit"); const limit = limitText ? Number(limitText) : EXCLUSION_REPORT_DEFAULT_LIMIT;
  try { if (generatedFrom) parseDateOnly(generatedFrom); if (generatedTo) parseDateOnly(generatedTo); }
  catch (error) { throw new ExclusionReportInputError(error instanceof Error ? error.message : "Data inválida."); }
  if (generatedFrom && generatedTo && generatedFrom > generatedTo) throw new ExclusionReportInputError("Período inválido: a data inicial deve ser anterior à data final.");
  if (source && !isOneOf(source, exclusionSources)) throw new ExclusionReportInputError("Fluxo inválido.");
  if (category && !isOneOf(category, exclusionCategories)) throw new ExclusionReportInputError("Categoria inválida.");
  if (situation && !isOneOf(situation, exclusionSituations)) throw new ExclusionReportInputError("Situação inválida.");
  if (!Number.isInteger(limit) || limit < 1 || limit > EXCLUSION_REPORT_MAX_LIMIT) throw new ExclusionReportInputError(`Limite inválido. Informe um inteiro entre 1 e ${EXCLUSION_REPORT_MAX_LIMIT}.`);
  validateText(originator, "Originador", textLimits.originator); validateText(batchFile, "Arquivo do lote", textLimits.batchFile);
  validateText(remittanceFile, "Arquivo da remessa", textLimits.remittanceFile); validateText(search, "Busca", textLimits.search);
  validateText(batchId, "ID do lote", textLimits.batchId); validateText(remittanceId, "ID da remessa", textLimits.remittanceId); validateText(cursor, "Cursor", textLimits.cursor);
  return {
    ...(generatedFrom ? { generatedFrom } : {}), ...(generatedTo ? { generatedTo } : {}),
    ...(source ? { source: source as ExclusionSource } : {}), ...(originator ? { originator } : {}),
    ...(batchFile ? { batchFile } : {}), ...(remittanceFile ? { remittanceFile } : {}),
    ...(category ? { category: category as ExclusionCategory } : {}), ...(situation ? { situation: situation as ExclusionSituation } : {}),
    ...(search ? { search } : {}), ...(batchId ? { batchId } : {}), ...(remittanceId ? { remittanceId } : {}), limit, ...(cursor ? { cursor } : {}),
  };
}

function digits(value: unknown) { return String(value ?? "").replace(/\D/g, ""); }
function normalized(value: unknown) { return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("pt-BR"); }
function recordSituation(record: ScanRecord): ExclusionSituation {
  if (record.differenceTitles.some((item) => item.reconciliation.status === "ACTIVE")) return "ACTIVE_RECONCILIATION";
  if (record.differenceTitles.some((item) => item.reconciliation.status === "UNDONE")) return "UNDONE_HISTORY";
  return "AVAILABLE";
}
function matches(record: ScanRecord, filters: ExclusionReportFilters) {
  const generatedAt = record.remittance.generatedAt.getTime();
  if (filters.generatedFrom && generatedAt < saoPauloDayRange(filters.generatedFrom).gte.getTime()) return false;
  if (filters.generatedTo && generatedAt >= saoPauloDayRange(filters.generatedTo).lt.getTime()) return false;
  if (filters.source && record.remittance.batch.source !== filters.source) return false;
  if (filters.originator) { const needle = normalized(filters.originator); const item = record.remittance.batch.originator; if (![item?.code, item?.name].some((value) => normalized(value).includes(needle))) return false; }
  if (filters.batchFile && !normalized(record.remittance.batch.fileName).includes(normalized(filters.batchFile))) return false;
  if (filters.remittanceFile && !normalized(record.remittance.fileName).includes(normalized(filters.remittanceFile))) return false;
  if (filters.category && record.category !== filters.category) return false;
  if (filters.situation && recordSituation(record) !== filters.situation) return false;
  if (filters.batchId && record.remittance.batch.id !== filters.batchId) return false;
  if (filters.remittanceId && record.remittance.id !== filters.remittanceId) return false;
  if (filters.search) {
    const needle = normalized(filters.search); const digitNeedle = digits(filters.search);
    const textMatch = [record.settlementItem.contractNumber, record.settlementItem.debtorName, record.settlementItem.debtorDocument].some((value) => normalized(value).includes(needle));
    const documentMatch = Boolean(digitNeedle && digits(record.settlementItem.debtorDocument).includes(digitNeedle));
    if (!textMatch && !documentMatch) return false;
  }
  return true;
}

function situationWhere(situation: ExclusionSituation | undefined): Prisma.ConsignadoRemittanceExclusionWhereInput {
  if (situation === "ACTIVE_RECONCILIATION") return { differenceTitles: { some: { reconciliation: { status: "ACTIVE" } } } };
  if (situation === "UNDONE_HISTORY") return { AND: [
    { differenceTitles: { none: { reconciliation: { status: "ACTIVE" } } } },
    { differenceTitles: { some: { reconciliation: { status: "UNDONE" } } } },
  ] };
  if (situation === "AVAILABLE") return { differenceTitles: { none: {} } };
  return {};
}
function databaseWhere(filters: ExclusionReportFilters, fundId: string): Prisma.ConsignadoRemittanceExclusionWhereInput {
  const generatedAt = { ...(filters.generatedFrom ? { gte: saoPauloDayRange(filters.generatedFrom).gte } : {}), ...(filters.generatedTo ? { lt: saoPauloDayRange(filters.generatedTo).lt } : {}) };
  return {
    ...(filters.category ? { category: filters.category } : {}), ...situationWhere(filters.situation),
    remittance: { fundId, status: { not: "CANCELLED" }, ...(Object.keys(generatedAt).length ? { generatedAt } : {}), ...(filters.remittanceId ? { id: filters.remittanceId } : {}),
      batch: { status: { not: "CANCELLED" }, ...(filters.source ? { source: filters.source } : {}), ...(filters.batchId ? { id: filters.batchId } : {}) } },
  };
}

const scanSelect = {
  id: true, category: true, titleAmount: true, paidAmount: true,
  remittance: { select: { id: true, fileName: true, generatedAt: true, batch: { select: { id: true, source: true, fileName: true, originator: { select: { code: true, name: true } } } } } },
  settlementItem: { select: { contractNumber: true, debtorName: true, debtorDocument: true } },
  differenceTitles: { select: { reconciliation: { select: { status: true } } } },
} satisfies Prisma.ConsignadoRemittanceExclusionSelect;

function detailSelect(situation: ExclusionSituation) {
  const status = situation === "ACTIVE_RECONCILIATION" ? "ACTIVE" : "UNDONE";
  return {
    ...scanSelect, reason: true,
    settlementItem: { select: { sourceRow: true, contractNumber: true, documentNumber: true, yourNumber: true, debtorName: true, debtorDocument: true, dueDate: true } },
    differenceTitles: {
      where: { reconciliation: { status } }, orderBy: { reconciliation: { createdAt: "desc" as const } }, take: situation === "AVAILABLE" ? 0 : 1,
      select: { reconciliation: { select: { id: true, status: true, createdAt: true,
        allocations: { orderBy: [{ bankEntry: { transactionDate: "asc" as const } }, { bankEntryId: "asc" as const }], select: { bankEntry: { select: { transactionDate: true, description: true, document: true } } } },
      } } },
    },
  } satisfies Prisma.ConsignadoRemittanceExclusionSelect;
}

function relevantReconciliation(record: DetailRecord, situation: ExclusionSituation) {
  const status = situation === "ACTIVE_RECONCILIATION" ? "ACTIVE" : situation === "UNDONE_HISTORY" ? "UNDONE" : null;
  return status ? record.differenceTitles.find((item) => item.reconciliation.status === status)?.reconciliation ?? null : null;
}
function bankEntryLabel(reconciliation: ReturnType<typeof relevantReconciliation>) {
  if (!reconciliation) return null;
  const entries = reconciliation.allocations.map(({ bankEntry }) => [bankEntry.transactionDate.toISOString().slice(0, 10), bankEntry.description, bankEntry.document].filter(Boolean).join(" · "));
  return Array.from(new Set(entries)).join(" | ") || null;
}
function mapRecord(record: DetailRecord, situation: ExclusionSituation): ExclusionReportItem {
  const reconciliation = relevantReconciliation(record, situation); const originator = record.remittance.batch.originator;
  return {
    id: record.id, generatedAt: record.remittance.generatedAt.toISOString(), source: record.remittance.batch.source,
    originator: originator?.name ?? "—", originatorCode: originator?.code ?? "", batchId: record.remittance.batch.id,
    batchFile: record.remittance.batch.fileName, remittanceId: record.remittance.id, remittanceFile: record.remittance.fileName,
    sourceRow: record.settlementItem.sourceRow, contractNumber: record.settlementItem.contractNumber,
    documentNumber: record.settlementItem.documentNumber ?? record.settlementItem.yourNumber, yourNumber: record.settlementItem.yourNumber,
    debtorName: record.settlementItem.debtorName, debtorDocument: record.settlementItem.debtorDocument,
    dueDate: record.settlementItem.dueDate?.toISOString() ?? null, titleAmount: new Prisma.Decimal(record.titleAmount).toFixed(2),
    paidAmount: new Prisma.Decimal(record.paidAmount).toFixed(2), category: record.category as ExclusionCategory,
    reason: record.reason, situation, reconciliationId: reconciliation?.id ?? null,
    reconciliationDate: reconciliation?.createdAt.toISOString() ?? null, bankEntry: bankEntryLabel(reconciliation),
  };
}

type MutableSummary = { count: number; titleAmount: Prisma.Decimal; paidAmount: Prisma.Decimal };
function emptySummary(): MutableSummary { return { count: 0, titleAmount: new Prisma.Decimal(0), paidAmount: new Prisma.Decimal(0) }; }
function addSummary(target: MutableSummary, record: ScanRecord) { target.count += 1; target.titleAmount = target.titleAmount.add(record.titleAmount); target.paidAmount = target.paidAmount.add(record.paidAmount); }
function serializeSummary(value: MutableSummary): SummaryValue { return { count: value.count, titleAmount: value.titleAmount.toFixed(2), paidAmount: value.paidAmount.toFixed(2) }; }
function summaryAccumulator() {
  const total = emptySummary(); const byCategory = new Map<ExclusionCategory, MutableSummary>(); const bySituation = new Map<ExclusionSituation, MutableSummary>();
  return {
    add(record: ScanRecord, situation: ExclusionSituation) {
      const category = record.category as ExclusionCategory;
      if (!byCategory.has(category)) byCategory.set(category, emptySummary()); if (!bySituation.has(situation)) bySituation.set(situation, emptySummary());
      addSummary(total, record); addSummary(byCategory.get(category)!, record); addSummary(bySituation.get(situation)!, record);
    },
    result(): ExclusionSummary { return {
      total: serializeSummary(total),
      byCategory: exclusionCategories.flatMap((key) => { const value = byCategory.get(key); return value ? [{ key, ...serializeSummary(value) }] : []; }),
      bySituation: exclusionSituations.flatMap((key) => { const value = bySituation.get(key); return value ? [{ key, ...serializeSummary(value) }] : []; }),
    }; },
  };
}

async function consignadoFundId(database: ReportDatabase) {
  const funds = await database.fund.findMany({ where: { status: "ACTIVE" }, select: { id: true, cnpj: true, name: true } });
  const fund = funds.find((item) => digits(item.cnpj) === "54842157000193" || normalized(item.name).includes("consignado"));
  if (!fund) throw new Error("Fundo Consignado não cadastrado."); return fund.id;
}
type MatchedReference = { id: string; situation: ExclusionSituation };
async function scanFiltered(filters: ExclusionReportFilters, dependencies: ReportDependencies, onMatch: (record: ScanRecord, reference: MatchedReference) => void) {
  const fundId = await consignadoFundId(dependencies.database); const maxScanRows = dependencies.limits?.maxScanRows ?? EXCLUSION_REPORT_MAX_SCAN_ROWS;
  let scanned = 0; let cursor: string | undefined;
  while (true) {
    const rows = await dependencies.database.consignadoRemittanceExclusion.findMany({
      where: databaseWhere(filters, fundId), select: scanSelect, take: EXCLUSION_SCAN_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), orderBy: [{ remittance: { generatedAt: "desc" } }, { id: "asc" }],
    }) as ReadonlyArray<ScanRecord>;
    if (!rows.length) break;
    for (const record of rows) {
      scanned += 1;
      if (scanned > maxScanRows) throw new ExclusionReportLimitError(`A consulta excedeu o teto operacional de ${maxScanRows.toLocaleString("pt-BR")} títulos candidatos. Restrinja os filtros.`);
      if (matches(record, filters)) onMatch(record, { id: record.id, situation: recordSituation(record) });
    }
    cursor = rows.at(-1)?.id; if (rows.length < EXCLUSION_SCAN_BATCH_SIZE) break;
  }
}
async function loadDetails(database: ReportDatabase, references: readonly MatchedReference[]) {
  const found = new Map<string, ExclusionReportItem>();
  for (const situation of exclusionSituations) {
    const group = references.filter((item) => item.situation === situation);
    for (let index = 0; index < group.length; index += EXCLUSION_DETAIL_BATCH_SIZE) {
      const batch = group.slice(index, index + EXCLUSION_DETAIL_BATCH_SIZE);
      const rows = await database.consignadoRemittanceExclusion.findMany({ where: { id: { in: batch.map((item) => item.id) } }, select: detailSelect(situation) }) as ReadonlyArray<DetailRecord>;
      rows.forEach((record) => found.set(record.id, mapRecord(record, situation)));
    }
  }
  return references.map((item) => found.get(item.id)).filter((item): item is ExclusionReportItem => Boolean(item));
}

export async function getExclusionReport(filters: ExclusionReportFilters) {
  const { prisma } = await import("@/lib/prisma"); return getExclusionReportWithDependencies(filters, { database: prisma as unknown as ReportDatabase });
}
export async function getExclusionReportWithDependencies(filters: ExclusionReportFilters, dependencies: ReportDependencies): Promise<ExclusionReport> {
  const summary = summaryAccumulator(); const pageReferences: MatchedReference[] = []; let cursorSeen = !filters.cursor; let hasMore = false;
  await scanFiltered(filters, dependencies, (record, reference) => {
    summary.add(record, reference.situation);
    if (!cursorSeen) { if (record.id === filters.cursor) cursorSeen = true; return; }
    if (pageReferences.length < filters.limit) pageReferences.push(reference); else hasMore = true;
  });
  if (!cursorSeen) throw new ExclusionReportInputError("Cursor inválido para os filtros aplicados.");
  return { filters, items: await loadDetails(dependencies.database, pageReferences), summary: summary.result(),
    page: { limit: filters.limit, nextCursor: hasMore ? pageReferences.at(-1)?.id ?? null : null, hasMore } };
}
export async function getExclusionExportReport(filters: ExclusionReportFilters) {
  const { prisma } = await import("@/lib/prisma"); return getExclusionExportReportWithDependencies(filters, { database: prisma as unknown as ReportDatabase });
}
export async function getExclusionExportReportWithDependencies(filters: ExclusionReportFilters, dependencies: ReportDependencies): Promise<ExclusionReport> {
  const summary = summaryAccumulator(); const references: MatchedReference[] = []; const maxExportRows = dependencies.limits?.maxExportRows ?? EXCLUSION_EXPORT_MAX_ROWS;
  const exportFilters = { ...filters, cursor: undefined };
  await scanFiltered(exportFilters, dependencies, (record, reference) => {
    summary.add(record, reference.situation); references.push(reference);
    if (references.length > maxExportRows) throw new ExclusionReportLimitError(`A exportação aceita no máximo ${maxExportRows.toLocaleString("pt-BR")} títulos. Restrinja os filtros e tente novamente.`);
  });
  return { filters: exportFilters, items: await loadDetails(dependencies.database, references), summary: summary.result(), page: { limit: maxExportRows, nextCursor: null, hasMore: false } };
}

function displayFilterValue(key: Exclude<keyof ExclusionReportFilters, "limit" | "cursor">, value: string) {
  if (key === "category" && isOneOf(value, exclusionCategories)) return categoryLabels[value];
  if (key === "situation" && isOneOf(value, exclusionSituations)) return situationLabels[value]; return value;
}
export function excelMoneyCellValue(value: string): number | string {
  const canonical = new Prisma.Decimal(value).toFixed(2); const numeric = Number(canonical);
  if (!Number.isFinite(numeric) || !Number.isSafeInteger(Math.round(numeric * 100))) return canonical;
  return new Prisma.Decimal(numeric.toString()).toFixed(2) === canonical ? numeric : canonical;
}
const EXCEL_EPOCH_DAYS = 25_569; const MILLISECONDS_PER_DAY = 86_400_000;
function excelSerial(year: number, month: number, day: number, hour = 0, minute = 0, second = 0) { return Date.UTC(year, month - 1, day, hour, minute, second) / MILLISECONDS_PER_DAY + EXCEL_EPOCH_DAYS; }
export function excelSaoPauloDateTimeSerial(value: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  return excelSerial(part("year"), part("month"), part("day"), part("hour"), part("minute"), part("second"));
}
export function excelCivilDateSerial(value: string) { const parsed = parseDateOnly(value.slice(0, 10)); return excelSerial(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate()); }
function setColumnFormat(sheet: XLSX.WorkSheet, column: string, rows: number, format: string) { for (let row = 2; row <= rows + 1; row += 1) { const cell = sheet[`${column}${row}`]; if (cell && typeof cell.v === "number") cell.z = format; } }

export function buildExclusionWorkbook(report: ExclusionReport): Buffer {
  const filterRows = filterLabels.flatMap(([key, label]) => { const value = report.filters[key]; return value ? [{ Indicador: label, Valor: displayFilterValue(key, value) }] : []; });
  const summaryRows: Array<Record<string, string | number>> = [
    ...filterRows, { Indicador: "Quantidade", Valor: report.summary.total.count },
    { Indicador: "Valor de face", Valor: excelMoneyCellValue(report.summary.total.titleAmount) }, { Indicador: "Valor pago", Valor: excelMoneyCellValue(report.summary.total.paidAmount) },
    ...report.summary.byCategory.map((item) => ({ Indicador: `Categoria · ${categoryLabels[item.key]}`, Valor: `${item.count} título(s) · face ${item.titleAmount} · pago ${item.paidAmount}` })),
    ...report.summary.bySituation.map((item) => ({ Indicador: `Situação · ${situationLabels[item.key]}`, Valor: `${item.count} título(s) · face ${item.titleAmount} · pago ${item.paidAmount}` })),
  ];
  const detailRows = report.items.map((item) => ({
    "Data da remessa": excelSaoPauloDateTimeSerial(item.generatedAt), Fluxo: item.source, Originador: item.originator, Lote: item.batchFile,
    Remessa: item.remittanceFile, Linha: item.sourceRow, Contrato: item.contractNumber ?? "", Documento: item.documentNumber ?? item.yourNumber ?? "",
    Sacado: item.debtorName ?? "", CPF: item.debtorDocument ?? "", Vencimento: item.dueDate ? excelCivilDateSerial(item.dueDate) : "",
    "Valor de face": excelMoneyCellValue(item.titleAmount), "Valor pago": excelMoneyCellValue(item.paidAmount), Categoria: categoryLabels[item.category],
    Motivo: item.reason, Situação: situationLabels[item.situation], "Entrada bancária": item.bankEntry ?? "",
    "Data da conciliação": item.reconciliationDate ? excelSaoPauloDateTimeSerial(item.reconciliationDate) : "",
  }));
  const workbook = XLSX.utils.book_new(); const summarySheet = XLSX.utils.json_to_sheet(summaryRows, { header: ["Indicador", "Valor"] });
  const detailSheet = XLSX.utils.json_to_sheet(detailRows, { header: ["Data da remessa", "Fluxo", "Originador", "Lote", "Remessa", "Linha", "Contrato", "Documento", "Sacado", "CPF", "Vencimento", "Valor de face", "Valor pago", "Categoria", "Motivo", "Situação", "Entrada bancária", "Data da conciliação"] });
  setColumnFormat(detailSheet, "A", detailRows.length, "dd/mm/yyyy hh:mm:ss"); setColumnFormat(detailSheet, "K", detailRows.length, "dd/mm/yyyy"); setColumnFormat(detailSheet, "R", detailRows.length, "dd/mm/yyyy hh:mm:ss");
  summarySheet["!cols"] = [{ wch: 34 }, { wch: 60 }]; detailSheet["!cols"] = [{ wch: 20 }, { wch: 10 }, { wch: 20 }, { wch: 28 }, { wch: 28 }, { wch: 8 }, { wch: 18 }, { wch: 18 }, { wch: 28 }, { wch: 18 }, { wch: 15 }, { wch: 24 }, { wch: 24 }, { wch: 28 }, { wch: 42 }, { wch: 32 }, { wch: 48 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumo"); XLSX.utils.book_append_sheet(workbook, detailSheet, "Titulos");
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}
export function exclusionCategoryLabel(category: ExclusionCategory) { return categoryLabels[category]; }
export function exclusionSituationLabel(situation: ExclusionSituation) { return situationLabels[situation]; }
