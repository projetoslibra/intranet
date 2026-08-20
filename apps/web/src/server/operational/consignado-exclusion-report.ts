import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { parseDateOnly, saoPauloDayRange } from "./consignado-date";

export const exclusionCategories = [
  "NOT_FOUND_IN_STOCK",
  "OPERATOR_EXCLUDED",
  "NOT_APPROVED",
  "PDD_RECOVERY",
  "OTHER_DIVERGENCE",
] as const;

export const exclusionSituations = [
  "AVAILABLE",
  "ACTIVE_RECONCILIATION",
  "UNDONE_HISTORY",
] as const;

export const exclusionSources = ["BMP", "UY3"] as const;

export type ExclusionCategory = (typeof exclusionCategories)[number];
export type ExclusionSituation = (typeof exclusionSituations)[number];
export type ExclusionSource = (typeof exclusionSources)[number];

export type ExclusionReportFilters = {
  generatedFrom?: string;
  generatedTo?: string;
  source?: ExclusionSource;
  originator?: string;
  batchFile?: string;
  remittanceFile?: string;
  category?: ExclusionCategory;
  situation?: ExclusionSituation;
  search?: string;
  batchId?: string;
  remittanceId?: string;
};

type DecimalValue = Prisma.Decimal | string | number;

type ExclusionRecord = {
  id: string;
  category: string;
  reason: string;
  titleAmount: DecimalValue;
  paidAmount: DecimalValue;
  createdAt: Date;
  remittance: {
    id: string;
    fileName: string;
    generatedAt: Date;
    batch: {
      id: string;
      source: string;
      fileName: string;
      originator: { id: string; code: string; name: string } | null;
    };
  };
  settlementItem: {
    sourceRow: number;
    contractNumber: string | null;
    documentNumber: string | null;
    yourNumber: string | null;
    debtorName: string | null;
    debtorDocument: string | null;
    dueDate: Date | null;
  };
  differenceTitles: ReadonlyArray<{
    reconciliation: {
      id: string;
      status: string;
      createdAt: Date;
      allocations: ReadonlyArray<{
        bankEntry: {
          transactionDate: Date;
          description: string;
          document: string | null;
        };
      }>;
    };
  }>;
};

export type ExclusionReportItem = {
  id: string;
  generatedAt: string;
  source: string;
  originator: string;
  originatorCode: string;
  batchId: string;
  batchFile: string;
  remittanceId: string;
  remittanceFile: string;
  sourceRow: number;
  contractNumber: string | null;
  documentNumber: string | null;
  yourNumber: string | null;
  debtorName: string | null;
  debtorDocument: string | null;
  dueDate: string | null;
  titleAmount: string;
  paidAmount: string;
  category: ExclusionCategory;
  reason: string;
  situation: ExclusionSituation;
  reconciliationId: string | null;
  reconciliationDate: string | null;
  bankEntry: string | null;
};

type SummaryValue = { count: number; titleAmount: string; paidAmount: string };
type SummaryGroup<Key extends string> = SummaryValue & { key: Key };

export type ExclusionReport = {
  filters: ExclusionReportFilters;
  items: ExclusionReportItem[];
  summary: {
    total: SummaryValue;
    byCategory: Array<SummaryGroup<ExclusionCategory>>;
    bySituation: Array<SummaryGroup<ExclusionSituation>>;
  };
};

type ReportDatabase = {
  fund: {
    findMany(args: unknown): Promise<ReadonlyArray<{ id: string; cnpj: string; name: string }>>;
  };
  consignadoRemittanceExclusion: {
    findMany(args: unknown): Promise<ReadonlyArray<ExclusionRecord>>;
  };
};

const categoryLabels: Record<ExclusionCategory, string> = {
  NOT_FOUND_IN_STOCK: "Não encontrado no estoque",
  OPERATOR_EXCLUDED: "Excluído pelo operador",
  NOT_APPROVED: "Não aprovado",
  PDD_RECOVERY: "Recuperação de PDD",
  OTHER_DIVERGENCE: "Outra divergência",
};

const situationLabels: Record<ExclusionSituation, string> = {
  AVAILABLE: "Disponível",
  ACTIVE_RECONCILIATION: "Usado em conciliação ativa",
  UNDONE_HISTORY: "Histórico desfeito",
};

const filterLabels: Array<[keyof ExclusionReportFilters, string]> = [
  ["generatedFrom", "Remessa gerada desde"],
  ["generatedTo", "Remessa gerada até"],
  ["source", "Fluxo"],
  ["originator", "Originador"],
  ["batchFile", "Arquivo do lote"],
  ["remittanceFile", "Arquivo da remessa"],
  ["category", "Categoria"],
  ["situation", "Situação"],
  ["search", "Busca"],
  ["batchId", "ID do lote"],
  ["remittanceId", "ID da remessa"],
];

function trimmed(params: URLSearchParams, key: string) {
  const value = params.get(key)?.trim();
  return value || undefined;
}

function isOneOf<T extends string>(value: string | undefined, values: readonly T[]): value is T {
  return Boolean(value && (values as readonly string[]).includes(value));
}

export function parseExclusionReportFilters(params: URLSearchParams): ExclusionReportFilters {
  const generatedFrom = trimmed(params, "generatedFrom");
  const generatedTo = trimmed(params, "generatedTo");
  const source = trimmed(params, "source")?.toUpperCase();
  const originator = trimmed(params, "originator");
  const batchFile = trimmed(params, "batchFile");
  const remittanceFile = trimmed(params, "remittanceFile");
  const category = trimmed(params, "category")?.toUpperCase();
  const situation = trimmed(params, "situation")?.toUpperCase();
  const search = trimmed(params, "search");
  const batchId = trimmed(params, "batchId");
  const remittanceId = trimmed(params, "remittanceId");

  if (generatedFrom) parseDateOnly(generatedFrom);
  if (generatedTo) parseDateOnly(generatedTo);
  if (generatedFrom && generatedTo && generatedFrom > generatedTo) throw new Error("Período inválido: a data inicial deve ser anterior à data final.");
  if (source && !isOneOf(source, exclusionSources)) throw new Error("Fluxo inválido.");
  if (category && !isOneOf(category, exclusionCategories)) throw new Error("Categoria inválida.");
  if (situation && !isOneOf(situation, exclusionSituations)) throw new Error("Situação inválida.");

  return {
    ...(generatedFrom ? { generatedFrom } : {}),
    ...(generatedTo ? { generatedTo } : {}),
    ...(source ? { source: source as ExclusionSource } : {}),
    ...(originator ? { originator } : {}),
    ...(batchFile ? { batchFile } : {}),
    ...(remittanceFile ? { remittanceFile } : {}),
    ...(category ? { category: category as ExclusionCategory } : {}),
    ...(situation ? { situation: situation as ExclusionSituation } : {}),
    ...(search ? { search } : {}),
    ...(batchId ? { batchId } : {}),
    ...(remittanceId ? { remittanceId } : {}),
  };
}

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function recordSituation(record: ExclusionRecord): ExclusionSituation {
  if (record.differenceTitles.some((item) => item.reconciliation.status === "ACTIVE")) return "ACTIVE_RECONCILIATION";
  if (record.differenceTitles.some((item) => item.reconciliation.status === "UNDONE")) return "UNDONE_HISTORY";
  return "AVAILABLE";
}

function matches(record: ExclusionRecord, filters: ExclusionReportFilters) {
  const generatedAt = record.remittance.generatedAt.getTime();
  if (filters.generatedFrom && generatedAt < saoPauloDayRange(filters.generatedFrom).gte.getTime()) return false;
  if (filters.generatedTo && generatedAt >= saoPauloDayRange(filters.generatedTo).lt.getTime()) return false;
  if (filters.source && record.remittance.batch.source !== filters.source) return false;
  if (filters.originator) {
    const needle = normalized(filters.originator);
    const originator = record.remittance.batch.originator;
    if (![originator?.code, originator?.name].some((value) => normalized(value).includes(needle))) return false;
  }
  if (filters.batchFile && !normalized(record.remittance.batch.fileName).includes(normalized(filters.batchFile))) return false;
  if (filters.remittanceFile && !normalized(record.remittance.fileName).includes(normalized(filters.remittanceFile))) return false;
  if (filters.category && record.category !== filters.category) return false;
  if (filters.situation && recordSituation(record) !== filters.situation) return false;
  if (filters.batchId && record.remittance.batch.id !== filters.batchId) return false;
  if (filters.remittanceId && record.remittance.id !== filters.remittanceId) return false;
  if (filters.search) {
    const needle = normalized(filters.search);
    const digitNeedle = digits(filters.search);
    const item = record.settlementItem;
    const textMatch = [item.contractNumber, item.debtorName, item.debtorDocument]
      .some((value) => normalized(value).includes(needle));
    const documentMatch = Boolean(digitNeedle && digits(item.debtorDocument).includes(digitNeedle));
    if (!textMatch && !documentMatch) return false;
  }
  return true;
}

function relevantReconciliation(record: ExclusionRecord, situation: ExclusionSituation) {
  const expectedStatus = situation === "ACTIVE_RECONCILIATION" ? "ACTIVE" : situation === "UNDONE_HISTORY" ? "UNDONE" : null;
  if (!expectedStatus) return null;
  return [...record.differenceTitles]
    .filter((item) => item.reconciliation.status === expectedStatus)
    .sort((left, right) => right.reconciliation.createdAt.getTime() - left.reconciliation.createdAt.getTime())[0]?.reconciliation ?? null;
}

function bankEntryLabel(reconciliation: ReturnType<typeof relevantReconciliation>) {
  if (!reconciliation) return null;
  const entries = reconciliation.allocations.map(({ bankEntry }) => {
    const date = bankEntry.transactionDate.toISOString().slice(0, 10);
    return [date, bankEntry.description, bankEntry.document].filter(Boolean).join(" · ");
  });
  return Array.from(new Set(entries)).join(" | ") || null;
}

function mapRecord(record: ExclusionRecord): ExclusionReportItem {
  const situation = recordSituation(record);
  const reconciliation = relevantReconciliation(record, situation);
  const originator = record.remittance.batch.originator;
  return {
    id: record.id,
    generatedAt: record.remittance.generatedAt.toISOString(),
    source: record.remittance.batch.source,
    originator: originator?.name ?? "—",
    originatorCode: originator?.code ?? "",
    batchId: record.remittance.batch.id,
    batchFile: record.remittance.batch.fileName,
    remittanceId: record.remittance.id,
    remittanceFile: record.remittance.fileName,
    sourceRow: record.settlementItem.sourceRow,
    contractNumber: record.settlementItem.contractNumber,
    documentNumber: record.settlementItem.documentNumber ?? record.settlementItem.yourNumber,
    yourNumber: record.settlementItem.yourNumber,
    debtorName: record.settlementItem.debtorName,
    debtorDocument: record.settlementItem.debtorDocument,
    dueDate: record.settlementItem.dueDate?.toISOString() ?? null,
    titleAmount: new Prisma.Decimal(record.titleAmount).toFixed(2),
    paidAmount: new Prisma.Decimal(record.paidAmount).toFixed(2),
    category: record.category as ExclusionCategory,
    reason: record.reason,
    situation,
    reconciliationId: reconciliation?.id ?? null,
    reconciliationDate: reconciliation?.createdAt.toISOString() ?? null,
    bankEntry: bankEntryLabel(reconciliation),
  };
}

function summaryValue(items: readonly ExclusionReportItem[]): SummaryValue {
  const totals = items.reduce((result, item) => ({
    titleAmount: result.titleAmount.add(item.titleAmount),
    paidAmount: result.paidAmount.add(item.paidAmount),
  }), { titleAmount: new Prisma.Decimal(0), paidAmount: new Prisma.Decimal(0) });
  return { count: items.length, titleAmount: totals.titleAmount.toFixed(2), paidAmount: totals.paidAmount.toFixed(2) };
}

function summarize(items: ExclusionReportItem[]): ExclusionReport["summary"] {
  return {
    total: summaryValue(items),
    byCategory: exclusionCategories.flatMap((key) => {
      const matches = items.filter((item) => item.category === key);
      return matches.length ? [{ key, ...summaryValue(matches) }] : [];
    }),
    bySituation: exclusionSituations.flatMap((key) => {
      const matches = items.filter((item) => item.situation === key);
      return matches.length ? [{ key, ...summaryValue(matches) }] : [];
    }),
  };
}

function databaseWhere(filters: ExclusionReportFilters, fundId: string): Prisma.ConsignadoRemittanceExclusionWhereInput {
  const originatorCode = filters.originator?.toUpperCase();
  const validOriginatorCodes = ["GIBB", "JUCA", "BANKERIZE", "UY3"] as const;
  const originatorConditions: Prisma.ConsignadoOriginatorWhereInput[] = filters.originator
    ? [
        ...(isOneOf(originatorCode, validOriginatorCodes) ? [{ code: originatorCode }] : []),
        { name: { contains: filters.originator, mode: "insensitive" } },
      ]
    : [];
  const generatedAt = {
    ...(filters.generatedFrom ? { gte: saoPauloDayRange(filters.generatedFrom).gte } : {}),
    ...(filters.generatedTo ? { lt: saoPauloDayRange(filters.generatedTo).lt } : {}),
  };
  const batch = {
    status: { not: "CANCELLED" as const },
    ...(filters.source ? { source: filters.source } : {}),
    ...(filters.originator ? { originator: { is: { OR: originatorConditions } } } : {}),
    ...(filters.batchFile ? { fileName: { contains: filters.batchFile, mode: "insensitive" as const } } : {}),
    ...(filters.batchId ? { id: filters.batchId } : {}),
  };
  return {
    ...(filters.category ? { category: filters.category } : {}),
    remittance: {
      fundId,
      status: { not: "CANCELLED" },
      ...(Object.keys(generatedAt).length ? { generatedAt } : {}),
      ...(filters.remittanceFile ? { fileName: { contains: filters.remittanceFile, mode: "insensitive" } } : {}),
      ...(filters.remittanceId ? { id: filters.remittanceId } : {}),
      batch,
    },
    ...(filters.search && !digits(filters.search) ? { OR: [
      { settlementItem: { contractNumber: { contains: filters.search, mode: "insensitive" } } },
      { settlementItem: { debtorName: { contains: filters.search, mode: "insensitive" } } },
      { settlementItem: { debtorDocument: { contains: filters.search, mode: "insensitive" } } },
    ] } : {}),
  };
}

export async function getExclusionReport(filters: ExclusionReportFilters) {
  const { prisma } = await import("@/lib/prisma");
  return getExclusionReportWithDependencies(filters, { database: prisma as unknown as ReportDatabase });
}

export async function getExclusionReportWithDependencies(
  filters: ExclusionReportFilters,
  dependencies: { database: ReportDatabase },
): Promise<ExclusionReport> {
  const funds = await dependencies.database.fund.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, cnpj: true, name: true },
  });
  const consignado = funds.find((item) => digits(item.cnpj) === "54842157000193" || normalized(item.name).includes("consignado"));
  if (!consignado) throw new Error("Fundo Consignado não cadastrado.");
  const records = await dependencies.database.consignadoRemittanceExclusion.findMany({
    where: databaseWhere(filters, consignado.id),
    include: {
      remittance: { include: { batch: { include: { originator: true } } } },
      settlementItem: true,
      differenceTitles: {
        include: {
          reconciliation: {
            include: {
              allocations: {
                include: { bankEntry: true },
                orderBy: [{ bankEntry: { transactionDate: "asc" } }, { bankEntryId: "asc" }],
              },
            },
          },
        },
      },
    },
    orderBy: [{ remittance: { generatedAt: "desc" } }, { id: "asc" }],
  });
  const items = [...records]
    .filter((record) => matches(record, filters))
    .sort((left, right) => right.remittance.generatedAt.getTime() - left.remittance.generatedAt.getTime() || left.id.localeCompare(right.id))
    .map(mapRecord);
  return { filters, items, summary: summarize(items) };
}

function displayFilterValue(key: keyof ExclusionReportFilters, value: string) {
  if (key === "category" && isOneOf(value, exclusionCategories)) return categoryLabels[value];
  if (key === "situation" && isOneOf(value, exclusionSituations)) return situationLabels[value];
  return value;
}

export function buildExclusionWorkbook(report: ExclusionReport): Buffer {
  const filterRows = filterLabels.flatMap(([key, label]) => {
    const value = report.filters[key];
    return value ? [{ Indicador: label, Valor: displayFilterValue(key, value) }] : [];
  });
  const summaryRows: Array<Record<string, string | number>> = [
    ...filterRows,
    { Indicador: "Quantidade", Valor: report.summary.total.count },
    { Indicador: "Valor de face", Valor: Number(report.summary.total.titleAmount) },
    { Indicador: "Valor pago", Valor: Number(report.summary.total.paidAmount) },
    ...report.summary.byCategory.map((item) => ({
      Indicador: `Categoria · ${categoryLabels[item.key]}`,
      Valor: `${item.count} título(s) · face ${item.titleAmount} · pago ${item.paidAmount}`,
    })),
    ...report.summary.bySituation.map((item) => ({
      Indicador: `Situação · ${situationLabels[item.key]}`,
      Valor: `${item.count} título(s) · face ${item.titleAmount} · pago ${item.paidAmount}`,
    })),
  ];
  const detailRows = report.items.map((item) => ({
    "Data da remessa": new Date(item.generatedAt),
    Fluxo: item.source,
    Originador: item.originator,
    Lote: item.batchFile,
    Remessa: item.remittanceFile,
    Linha: item.sourceRow,
    Contrato: item.contractNumber ?? "",
    Documento: item.documentNumber ?? item.yourNumber ?? "",
    Sacado: item.debtorName ?? "",
    CPF: item.debtorDocument ?? "",
    Vencimento: item.dueDate ? new Date(item.dueDate) : "",
    "Valor de face": Number(item.titleAmount),
    "Valor pago": Number(item.paidAmount),
    Categoria: categoryLabels[item.category],
    Motivo: item.reason,
    Situação: situationLabels[item.situation],
    "Entrada bancária": item.bankEntry ?? "",
    "Data da conciliação": item.reconciliationDate ? new Date(item.reconciliationDate) : "",
  }));

  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows, { header: ["Indicador", "Valor"] });
  const detailSheet = XLSX.utils.json_to_sheet(detailRows, { header: [
    "Data da remessa", "Fluxo", "Originador", "Lote", "Remessa", "Linha", "Contrato", "Documento",
    "Sacado", "CPF", "Vencimento", "Valor de face", "Valor pago", "Categoria", "Motivo", "Situação",
    "Entrada bancária", "Data da conciliação",
  ] });
  summarySheet["!cols"] = [{ wch: 34 }, { wch: 60 }];
  detailSheet["!cols"] = [
    { wch: 18 }, { wch: 10 }, { wch: 20 }, { wch: 28 }, { wch: 28 }, { wch: 8 }, { wch: 18 },
    { wch: 18 }, { wch: 28 }, { wch: 18 }, { wch: 15 }, { wch: 16 }, { wch: 16 }, { wch: 28 },
    { wch: 42 }, { wch: 32 }, { wch: 48 }, { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumo");
  XLSX.utils.book_append_sheet(workbook, detailSheet, "Titulos");
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer", cellDates: true });
}

export function exclusionCategoryLabel(category: ExclusionCategory) {
  return categoryLabels[category];
}

export function exclusionSituationLabel(situation: ExclusionSituation) {
  return situationLabels[situation];
}
