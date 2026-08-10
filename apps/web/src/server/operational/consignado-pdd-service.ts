import { createHash } from "node:crypto";
import { Prisma, type ConsignadoPddTitle, type OperationalFlowSource } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";

const CONSIGNADO_CNPJ = "54842157000193";

type PddMatchInput = {
  yourNumber: string | null;
  documentNumber: string | null;
  contractNumber: string | null;
  debtorDocument: string | null;
  dueDate: Date | null;
  titleAmount: number;
};

type PddMatch = {
  status: "PDD_RECOVERY" | "PDD_REVIEW" | "NOT_FOUND";
  reason: string;
  title: ConsignadoPddTitle | null;
};

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function text(value: unknown) {
  const result = String(value ?? "").trim();
  return result || null;
}

function normalized(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase().replace(/\s+/g, " ");
}

function identifier(value: unknown) {
  const raw = normalized(value);
  return raw ? raw.replace(/[^A-Z0-9]/g, "") : "";
}

function decimal(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return new Prisma.Decimal(value);
  const raw = String(value).trim().replace(/R\$/gi, "").replace(/\s/g, "");
  const normalizedNumber = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const number = Number(normalizedNumber);
  return Number.isFinite(number) ? new Prisma.Decimal(number) : null;
}

function date(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.floor(parsed.S)));
  }
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (br) {
    const year = Number(br[3]) < 100 ? 2000 + Number(br[3]) : Number(br[3]);
    return new Date(Date.UTC(year, Number(br[2]) - 1, Number(br[1])));
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateKey(value: Date | null | undefined) {
  return value?.toISOString().slice(0, 10) ?? "";
}

function moneyKey(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) return "";
  return Number(value).toFixed(2);
}

async function consignadoFund() {
  const funds = await prisma.fund.findMany({ where: { status: "ACTIVE" }, select: { id: true, cnpj: true, name: true } });
  const fund = funds.find((item) => digits(item.cnpj) === CONSIGNADO_CNPJ || normalized(item.name).includes("CONSIGNADO"));
  if (!fund) throw new Error("Fundo Consignado não cadastrado.");
  return fund;
}

function titleIdentifiers(title: ConsignadoPddTitle) {
  return new Set([
    title.yourNumberUsed,
    title.documentNumber,
    title.yourNumberOriginal,
    title.cnabDocumentNumber,
    title.stockYourNumber,
    title.stockDocumentNumber,
  ].map(identifier).filter(Boolean));
}

function titleIdentity(title: ConsignadoPddTitle) {
  return [
    digits(title.debtorDocument),
    identifier(title.yourNumberUsed),
    identifier(title.documentNumber),
    dateKey(title.dueDate),
    moneyKey(title.nominalValue),
  ].join("|");
}

export function classifyPddMatch(source: OperationalFlowSource, item: PddMatchInput, titles: ConsignadoPddTitle[]): PddMatch {
  const cpf = digits(item.debtorDocument);
  if (!cpf) return { status: "NOT_FOUND", reason: "Título não encontrado no estoque ativo.", title: null };
  const incomingIdentifiers = new Set([item.yourNumber, item.documentNumber, item.contractNumber].map(identifier).filter(Boolean));
  const sourceTitles = titles.filter((title) => digits(title.debtorDocument) === cpf && (!title.flowSource || normalized(title.flowSource) === source));
  let matches = sourceTitles.filter((title) => [...titleIdentifiers(title)].some((value) => incomingIdentifiers.has(value)));
  let criterion = "CPF e identificador do título";
  if (!matches.length && item.dueDate && item.titleAmount > 0) {
    matches = sourceTitles.filter((title) => dateKey(title.dueDate) === dateKey(item.dueDate) && moneyKey(title.nominalValue) === moneyKey(item.titleAmount));
    criterion = "CPF, vencimento e valor nominal";
  }
  if (!matches.length) return { status: "NOT_FOUND", reason: "Título não encontrado no estoque ativo.", title: null };

  const identities = new Map<string, ConsignadoPddTitle[]>();
  matches.forEach((title) => identities.set(titleIdentity(title), [...(identities.get(titleIdentity(title)) ?? []), title]));
  if (identities.size > 1) {
    return { status: "PDD_REVIEW", reason: `${identities.size} títulos distintos da base PDD coincidem por ${criterion}.`, title: null };
  }
  const selected = [...identities.values()][0].sort((left, right) => (right.generatedAt?.getTime() ?? 0) - (left.generatedAt?.getTime() ?? 0))[0];
  return { status: "PDD_RECOVERY", reason: `Crédito de título baixado anteriormente por PDD, identificado por ${criterion}.`, title: selected };
}

export async function loadConsignadoPddTitles(fundId: string) {
  return prisma.consignadoPddTitle.findMany({ where: { fundId }, orderBy: [{ generatedAt: "desc" }, { createdAt: "desc" }] });
}

async function refreshBatch(batchId: string) {
  const items = await prisma.consignadoSettlementItem.findMany({ where: { batchId }, select: { status: true, approved: true, paidAmount: true } });
  const receivedAmount = items.reduce((sum, item) => sum.add(item.paidAmount), new Prisma.Decimal(0));
  const matchedAmount = items.filter((item) => item.approved).reduce((sum, item) => sum.add(item.paidAmount), new Prisma.Decimal(0));
  const issueItems = items.filter((item) => !item.approved && !["EXCLUDED", "PDD_RECOVERY"].includes(item.status)).length;
  await prisma.consignadoSettlementBatch.update({ where: { id: batchId }, data: {
    issueItems,
    receivedAmount,
    matchedAmount,
    excludedAmount: receivedAmount.sub(matchedAmount),
    status: issueItems ? "REVIEW_REQUIRED" : "READY",
  } });
}

async function reclassifyOpenItems(fundId: string, userId: string) {
  const [titles, items] = await Promise.all([
    loadConsignadoPddTitles(fundId),
    prisma.consignadoSettlementItem.findMany({
      where: { status: { in: ["NOT_FOUND", "PDD_REVIEW"] }, batch: { fundId, status: { notIn: ["GENERATED", "CANCELLED"] } } },
      include: { batch: { select: { id: true, source: true } } },
    }),
  ]);
  const affected = new Set<string>();
  let recovered = 0;
  let review = 0;
  for (const item of items) {
    const match = classifyPddMatch(item.batch.source, {
      yourNumber: item.yourNumber,
      documentNumber: item.documentNumber,
      contractNumber: item.contractNumber,
      debtorDocument: item.debtorDocument,
      dueDate: item.dueDate,
      titleAmount: Number(item.titleAmount),
    }, titles);
    if (match.status === "NOT_FOUND") continue;
    await prisma.$transaction([
      prisma.consignadoSettlementItem.update({ where: { id: item.id }, data: {
        status: match.status,
        statusReason: match.reason,
        matchedPddTitleId: match.title?.id ?? null,
        approved: false,
        exclusionReason: null,
      } }),
      prisma.consignadoStatusEvent.create({ data: {
        userId,
        entityType: "SETTLEMENT_ITEM",
        entityId: item.id,
        fromStatus: item.status,
        toStatus: match.status,
        metadata: { matchedPddTitleId: match.title?.id ?? null, source: "PDD_HISTORY_IMPORT" },
      } }),
    ]);
    affected.add(item.batch.id);
    if (match.status === "PDD_RECOVERY") recovered += 1;
    else review += 1;
  }
  for (const batchId of affected) await refreshBatch(batchId);
  return { recovered, review, affectedBatches: affected.size };
}

export async function importConsignadoPddHistory(input: { userId: string; fileName: string; buffer: Buffer }) {
  const fund = await consignadoFund();
  const fileHash = createHash("sha256").update(input.buffer).digest("hex");
  const existing = await prisma.consignadoPddImport.findUnique({ where: { fundId_fileHash: { fundId: fund.id, fileHash } } });
  if (existing) return { duplicateFile: true, import: existing, reclassification: { recovered: 0, review: 0, affectedBatches: 0 } };

  const workbook = XLSX.read(input.buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("A planilha PDD não possui uma aba válida.");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
  if (!rows.length) throw new Error("A planilha PDD não possui títulos.");

  const validRows: Prisma.ConsignadoPddTitleCreateManyInput[] = [];
  let invalidRows = 0;
  rows.forEach((row, index) => {
    const debtorDocument = digits(row.CPF);
    const yourNumberUsed = text(row.SEU_NUMERO_USADO);
    const documentNumber = text(row.NU_DOCUMENTO);
    if (!debtorDocument || (!yourNumberUsed && !documentNumber)) {
      invalidRows += 1;
      return;
    }
    const sourceRow = index + 2;
    const rowHash = createHash("sha256").update([
      text(row.ARQUIVO_REMESSA), text(row.LINHA_PDD), debtorDocument, yourNumberUsed, documentNumber,
    ].join("|")).digest("hex");
    validRows.push({
      importId: "",
      fundId: fund.id,
      sourceRow,
      rowHash,
      generatedAt: date(row.DATA_GERACAO),
      remittanceFile: text(row.ARQUIVO_REMESSA),
      auditFile: text(row.ARQUIVO_AUDIT),
      flowSource: text(row.CEDENTE_FLUXO),
      originator: text(row.ORIGINADOR),
      debtorName: text(row.SACADO),
      debtorDocument,
      cedentName: text(row.NOME_CEDENTE_ESTOQUE),
      documentNumber,
      yourNumberUsed,
      yourNumberOriginal: text(row.SEU_NUMERO_ORIGINAL),
      cnabDocumentNumber: text(row.NUMERO_DOCUMENTO_CNAB),
      stockYourNumber: text(row.SEU_NUMERO_ESTOQUE),
      stockDocumentNumber: text(row.NU_DOCUMENTO_ESTOQUE),
      nominalValue: decimal(row.VALOR_NOMINAL),
      presentValue: decimal(row.VALOR_PRESENTE),
      acquisitionValue: decimal(row.VALOR_AQUISICAO),
      pddValue: decimal(row.VALOR_PDD),
      dueDate: date(row.DATA_VENCIMENTO),
      acquisitionDate: date(row.DATA_AQUISICAO),
      pddRange: text(row.FAIXA_PDD),
      receivableSituation: text(row.SITUACAO_RECEBIVEL),
      writeOffType: text(row.TIPO_BAIXA),
      occurrence: text(row.OCORRENCIA),
      controlStatus: text(row.STATUS_CONTROLE),
      historyStatus: text(row.STATUS_HISTORICO),
      relationshipStatus: text(row.STATUS_RELACIONAMENTO),
      currentStockStatus: text(row.STATUS_ESTOQUE_ATUAL),
      pddLine: text(row.LINHA_PDD),
      sourceLines: text(row.LINHAS_ORIGEM),
    });
  });

  const completed = await prisma.$transaction(async (tx) => {
    const created = await tx.consignadoPddImport.create({ data: {
      fundId: fund.id,
      importedByUserId: input.userId,
      fileName: input.fileName,
      fileHash,
      totalRows: rows.length,
      invalidRows,
    } });
    let importedRows = 0;
    for (let offset = 0; offset < validRows.length; offset += 400) {
      const result = await tx.consignadoPddTitle.createMany({
        data: validRows.slice(offset, offset + 400).map((row) => ({ ...row, importId: created.id })),
        skipDuplicates: true,
      });
      importedRows += result.count;
    }
    return tx.consignadoPddImport.update({ where: { id: created.id }, data: { importedRows, duplicateRows: validRows.length - importedRows } });
  }, { timeout: 30_000 });
  const reclassification = await reclassifyOpenItems(fund.id, input.userId);
  return { duplicateFile: false, import: completed, reclassification };
}

export async function getConsignadoPddSummary(fundId?: string) {
  const fund = fundId ? { id: fundId } : await consignadoFund();
  const [titleCount, lastImport] = await Promise.all([
    prisma.consignadoPddTitle.count({ where: { fundId: fund.id } }),
    prisma.consignadoPddImport.findFirst({
      where: { fundId: fund.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, fileName: true, totalRows: true, importedRows: true, duplicateRows: true, invalidRows: true, createdAt: true },
    }),
  ]);
  return { titleCount, lastImport };
}
