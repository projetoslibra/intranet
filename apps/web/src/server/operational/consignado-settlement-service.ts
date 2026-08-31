import { createHash } from "node:crypto";
import { del, get, head, put } from "@vercel/blob";
import { Prisma, type OperationalFlowSource, type SettlementItemStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateDaycovalCnab } from "./consignado-cnab";
import { summarizeBatchReconciliation } from "./consignado-reconciliation";
import { parseBmpCnab, parseUy3Workbook, type ParsedSettlementItem } from "./consignado-parsers";
import { classifyPddMatch, getConsignadoPddSummary, loadConsignadoPddTitles } from "./consignado-pdd-service";
import { saoPauloDayRange } from "./consignado-date";
import { buildRemittanceExclusionPersistence, selectRemittanceItems } from "./consignado-remittance-exclusions";
import { assertRemittanceCancellationAllowed, buildPreviousRemittanceIndex, DuplicateSettlementFileError, findPreviouslyRemittedTitle, remittanceDownloadEligibility, RemittanceDownloadBlockedError, selectPreviousRemittanceCandidates, type PreviousRemittanceTitle } from "./consignado-settlement-safety";
import { buildStockCandidateIndex, chooseCandidate, dateKey, digits, normalized, sameMoney, selectScorableCandidates } from "./consignado-matching";
import { assertBatchReopenAllowed, AUTO_EXCLUSION_REASON, REMITTANCE_EXCLUSION_EVENT_REASON, resolveRestoredStatus, selectReopenableItems } from "./consignado-batch-reopen";
import {
  assertSettlementBlobIntegrity,
  validateSettlementUploadMetadata,
  type SettlementUploadMetadata,
} from "@/features/operational/consignado-settlement-upload";
import { normalizeSettlementWorkspaceFilters } from "@/features/operational/consignado-settlement-filters";

const CONSIGNADO_CNPJ = "54842157000193";
export const BULK_UNDERPAID_LIMIT_PERCENT = 10;
const MATCHABLE = new Set<SettlementItemStatus>(["FULL_MATCH", "PARTIAL_MATCH", "MANUALLY_MATCHED"]);
const ALREADY_REMITTED_REASON = "Título já baixado via OSHER";

function debtorKey(item: { debtorDocument: string | null; debtorName: string | null }) {
  const document = digits(item.debtorDocument);
  if (document) return `DOCUMENT:${document}`;
  const name = normalized(item.debtorName);
  return name ? `NAME:${name}` : null;
}
function underpaid77Difference(item: {
  occurrence: string | null;
  status: SettlementItemStatus;
  paidAmount: Prisma.Decimal;
  matchedStockPosition: { nominalValue: Prisma.Decimal } | null;
}) {
  if (item.occurrence !== "77" || item.status !== "DIVERGENT" || !item.matchedStockPosition) return null;
  const nominal = item.matchedStockPosition.nominalValue;
  if (nominal.lte(0) || item.paidAmount.lte(0) || item.paidAmount.gte(nominal)) return null;
  const difference = nominal.sub(item.paidAmount);
  return { nominal, difference, percentage: difference.div(nominal).mul(100) };
}

async function consignadoFund() {
  const funds = await prisma.fund.findMany({ where: { status: "ACTIVE" }, select: { id: true, cnpj: true, name: true } });
  const fund = funds.find((item) => digits(item.cnpj) === CONSIGNADO_CNPJ || normalized(item.name).includes("CONSIGNADO"));
  if (!fund) throw new Error("Fundo Consignado não cadastrado.");
  return fund;
}

async function activeStock(fundId: string) {
  const stock = await prisma.importBatch.findFirst({
    where: { fundId, module: "RECEIVABLE_STOCK", source: "CONSIGNADO_STOCK_MANUAL", status: "COMPLETED", isActive: true },
    orderBy: [{ referenceDate: "desc" }, { version: "desc" }],
  });
  if (!stock?.referenceDate) throw new Error("Importe e ative um estoque do Consignado antes de processar baixas.");
  return stock;
}

type StockCandidate = Prisma.ReceivableStockPositionGetPayload<{}>;

const IN_CHUNK = 1000;
const INSERT_CHUNK = 2000;
const CONTAINS_CHUNK = 150;

function chunked<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) result.push(values.slice(offset, offset + size));
  return result;
}

/**
 * O filtro `debtorDocument: { contains: <digitos> }` custa uma varredura do estoque e só
 * pode casar se algum documento gravado contiver uma corrida de dígitos do tamanho do
 * padrão procurado. Documentos formatados como `NNN.NNN.NNN-NN` nunca contêm. Esta
 * consulta decide, com uma única varredura, se vale repetir o filtro em cada bloco.
 * Padrão vazio casa com tudo e mantém o filtro. Qualquer erro devolve `true`, preservando
 * o comportamento atual.
 */
async function documentPatternsCanMatch(stockBatchId: string, patterns: Set<string>) {
  if (!patterns.size) return false;
  if (patterns.has("")) return true;
  const shortest = Math.min(...Array.from(patterns, (pattern) => pattern.length));
  try {
    const rows = await prisma.$queryRaw<Array<{ found: number }>>`
      select 1 as found from receivable_stock_positions
      where "batchId" = ${stockBatchId} and debtor_document ~ ${`[0-9]{${shortest}}`}
      limit 1`;
    return rows.length > 0;
  } catch {
    return true;
  }
}

async function loadCandidates(stockBatchId: string, items: ParsedSettlementItem[]) {
  const all = new Map<string, StockCandidate>();
  const yourNumbers = new Set<string>();
  const documentNumbers = new Set<string>();
  const documents = new Set<string>();
  items.forEach((item) => {
    if (item.yourNumber) yourNumbers.add(item.yourNumber);
    if (item.documentNumber) documentNumbers.add(item.documentNumber);
    if (item.contractNumber) documentNumbers.add(item.contractNumber);
    if (item.debtorDocument) documents.add(digits(item.debtorDocument));
  });
  const collect = async (where: Prisma.ReceivableStockPositionWhereInput) => {
    const rows = await prisma.receivableStockPosition.findMany({ where: { batchId: stockBatchId, ...where } });
    rows.forEach((row) => all.set(row.id, row));
  };
  for (const chunk of chunked(Array.from(yourNumbers), IN_CHUNK)) await collect({ yourNumber: { in: chunk } });
  for (const chunk of chunked(Array.from(documentNumbers), IN_CHUNK)) await collect({ documentNumber: { in: chunk } });
  if (await documentPatternsCanMatch(stockBatchId, documents)) {
    for (const chunk of chunked(Array.from(documents), CONTAINS_CHUNK)) {
      await collect({ OR: chunk.map((document) => ({ debtorDocument: { contains: document } })) });
    }
  }
  return Array.from(all.values());
}

async function loadPreviouslyRemittedTitles(fundId: string, items: ParsedSettlementItem[]): Promise<PreviousRemittanceTitle[]> {
  const rows = new Map<string, PreviousRemittanceTitle>();
  const yourNumbers = new Set<string>();
  const documentNumbers = new Set<string>();
  const documents = new Set<string>();
  items.forEach((item) => {
    if (item.yourNumber) yourNumbers.add(item.yourNumber);
    if (item.documentNumber) documentNumbers.add(item.documentNumber);
    if (item.debtorDocument) documents.add(digits(item.debtorDocument));
  });
  const collect = async (clauses: Prisma.ConsignadoRemittanceItemWhereInput[]) => {
    if (!clauses.length) return;
    const found = await prisma.consignadoRemittanceItem.findMany({
      where: { remittance: { fundId, status: { not: "CANCELLED" } }, OR: clauses },
      select: { id: true, yourNumber: true, documentNumber: true, debtorDocument: true, amount: true, settlementItem: { select: { contractNumber: true, installmentNumber: true } }, remittance: { select: { id: true, fileName: true, status: true, generatedAt: true, batch: { select: { source: true, originator: { select: { code: true } } } } } } },
    });
    found.forEach((item) => rows.set(item.id, { id: item.id, source: item.remittance.batch.source, originatorCode: item.remittance.batch.originator?.code ?? null, yourNumber: item.yourNumber, documentNumber: item.documentNumber, contractNumber: item.settlementItem.contractNumber, installmentNumber: item.settlementItem.installmentNumber, debtorDocument: item.debtorDocument, amount: Number(item.amount), remittanceId: item.remittance.id, remittanceFileName: item.remittance.fileName, remittanceStatus: item.remittance.status, generatedAt: item.remittance.generatedAt }));
  };
  for (const chunk of chunked(Array.from(yourNumbers), IN_CHUNK)) await collect([{ yourNumber: { in: chunk } }]);
  for (const chunk of chunked(Array.from(documentNumbers), IN_CHUNK)) await collect([{ documentNumber: { in: chunk } }]);
  for (const chunk of chunked(Array.from(documents), CONTAINS_CHUNK)) await collect(chunk.map((document) => ({ debtorDocument: { contains: document } })));
  return Array.from(rows.values()).sort((left, right) => right.generatedAt.getTime() - left.generatedAt.getTime());
}

export async function listConsignadoOriginators() {
  return prisma.consignadoOriginator.findMany({ where: { active: true }, orderBy: { code: "asc" } });
}

async function importSettlementBatchFromBuffer(input: { userId: string; source: OperationalFlowSource; originatorCode?: string; fileName: string; fileHash: string; storageKey: string; buffer: Buffer }) {
  const fund = await consignadoFund();
  const stock = await activeStock(fund.id);
  if (input.source === "BMP" && !["GIBB", "JUCA", "BANKERIZE"].includes(input.originatorCode ?? "")) {
    throw new Error("Selecione o originador BMP: GIBB, JUCA ou BANKERIZE.");
  }
  const originator = await prisma.consignadoOriginator.findFirst({
    where: { code: (input.source === "UY3" ? "UY3" : input.originatorCode) as never, source: input.source, active: true },
  });
  if (!originator) throw new Error("Originador inválido ou inativo.");
  const existing = await prisma.consignadoSettlementBatch.findFirst({
    where: { fundId: fund.id, source: input.source, fileHash: input.fileHash },
    orderBy: { createdAt: "desc" },
    select: { id: true, fileName: true, createdAt: true },
  });
  if (existing) {
    await prisma.consignadoStatusEvent.create({ data: { userId: input.userId, entityType: "SETTLEMENT_DUPLICATE_ATTEMPT", entityId: existing.id, fromStatus: "BLOCKED", toStatus: "BLOCKED", metadata: { attemptedFileName: input.fileName, originalFileName: existing.fileName, fileHash: input.fileHash } } });
    throw new DuplicateSettlementFileError({ batchId: existing.id, fileName: existing.fileName, processedAt: existing.createdAt });
  }

  const parsed = input.source === "BMP" ? parseBmpCnab(input.buffer) : parseUy3Workbook(input.buffer);
  const [candidates, pddTitles, remittedTitles] = await Promise.all([loadCandidates(stock.id, parsed), loadConsignadoPddTitles(fund.id), loadPreviouslyRemittedTitles(fund.id, parsed)]);
  const candidateIndex = buildStockCandidateIndex(candidates);
  const remittedIndex = buildPreviousRemittanceIndex(remittedTitles);
  const usedPositions = new Set<string>();
  const matched = parsed.map((item) => {
    const incoming = { source: input.source, originatorCode: originator.code, yourNumber: item.yourNumber, documentNumber: item.documentNumber, contractNumber: item.contractNumber, installmentNumber: item.installmentNumber, debtorDocument: item.debtorDocument, paidAmount: Number(item.paidAmount) };
    const previous = findPreviouslyRemittedTitle(incoming, selectPreviousRemittanceCandidates(remittedIndex, incoming));
    if (previous) return { item, status: "DUPLICATE" as SettlementItemStatus, reason: `${ALREADY_REMITTED_REASON} na remessa ${previous.remittanceFileName}, gerada em ${previous.generatedAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`, candidate: null, pddTitle: null };
    let result: ReturnType<typeof chooseCandidate> | (ReturnType<typeof classifyPddMatch> & { candidate: null }) = chooseCandidate(input.source, item, selectScorableCandidates(candidateIndex, item));
    if (result.status === "NOT_FOUND") {
      const pddMatch = classifyPddMatch(input.source, { ...item, titleAmount: Number(item.titleAmount) }, pddTitles);
      if (pddMatch.status !== "NOT_FOUND") result = { ...pddMatch, candidate: null };
    }
    if (result.candidate && usedPositions.has(result.candidate.id)) {
      return { item, status: "DUPLICATE" as SettlementItemStatus, reason: "Título já utilizado neste lote.", candidate: null };
    }
    const isUnderpaid77 = result.status === "DIVERGENT" && item.occurrence === "77" && Number(item.paidAmount) > 0 && Number(item.paidAmount) < Number(result.candidate?.nominalValue ?? 0);
    if (result.candidate && (MATCHABLE.has(result.status) || isUnderpaid77)) usedPositions.add(result.candidate.id);
    return { item, status: result.status as SettlementItemStatus, reason: result.reason, candidate: result.candidate, pddTitle: "title" in result ? result.title : null };
  });
  const fullItems = matched.filter((item) => item.status === "FULL_MATCH").length;
  const partialItems = matched.filter((item) => item.status === "PARTIAL_MATCH").length;
  const issueItems = matched.filter((item) => !MATCHABLE.has(item.status) && item.status !== "PDD_RECOVERY").length;
  const receivedAmount = matched.reduce((sum, entry) => sum.add(entry.item.paidAmount), new Prisma.Decimal(0));
  const matchedAmount = matched.filter((entry) => MATCHABLE.has(entry.status)).reduce((sum, entry) => sum.add(entry.item.paidAmount), new Prisma.Decimal(0));
  try {
    const batch = await prisma.$transaction(async (tx) => {
      const created = await tx.consignadoSettlementBatch.create({ data: {
        fundId: fund.id, stockBatchId: stock.id, uploadedByUserId: input.userId, originatorId: originator.id,
        source: input.source, fileName: input.fileName, fileHash: input.fileHash, storageKey: input.storageKey, referenceDate: stock.referenceDate!,
        status: issueItems ? "REVIEW_REQUIRED" : "READY", totalItems: matched.length, fullItems, partialItems, issueItems,
        receivedAmount, matchedAmount, excludedAmount: receivedAmount.sub(matchedAmount), completedAt: new Date(),
      }});
      const itemRows = matched.map(({ item, status, reason, candidate, pddTitle }) => ({
        batchId: created.id, sourceRow: item.sourceRow, sourceRaw: item.sourceRaw, occurrence: item.occurrence,
        contractNumber: item.contractNumber, installmentNumber: item.installmentNumber, yourNumber: item.yourNumber,
        documentNumber: item.documentNumber, debtorName: item.debtorName, debtorDocument: item.debtorDocument,
        dueDate: item.dueDate, titleAmount: new Prisma.Decimal(item.titleAmount), paidAmount: new Prisma.Decimal(item.paidAmount),
        status, statusReason: reason, matchedStockPositionId: candidate?.id ?? null, matchedPddTitleId: pddTitle?.id ?? null, approved: MATCHABLE.has(status),
      }));
      for (const rows of chunked(itemRows, INSERT_CHUNK)) await tx.consignadoSettlementItem.createMany({ data: rows });
      await tx.consignadoStatusEvent.create({ data: { userId: input.userId, entityType: "SETTLEMENT_BATCH", entityId: created.id, toStatus: created.status, metadata: { stockBatchId: stock.id, originator: originator.code } } });
      return created;
    }, { maxWait: 15_000, timeout: 240_000 });
    return { batchId: batch.id };
  } catch (error) {
    await del(input.storageKey).catch(() => undefined);
    throw error;
  }
}

async function settlementStreamToBuffer(stream: ReadableStream): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value instanceof Uint8Array ? value : new Uint8Array(value));
  }
  return Buffer.concat(chunks);
}

export async function importSettlementBatchFromBlob(input: SettlementUploadMetadata & { userId: string }) {
  const metadata = validateSettlementUploadMetadata(input);
  let persisted = false;
  try {
    const blobMetadata = await head(metadata.storageKey);
    if (blobMetadata.size !== metadata.fileSize) {
      throw new Error("O tamanho do arquivo armazenado não confere com o upload.");
    }
    const stored = await get(metadata.storageKey, { access: "private", useCache: false });
    if (!stored || stored.statusCode !== 200 || !stored.stream) {
      throw new Error("O arquivo privado de baixa não foi encontrado.");
    }
    const buffer = await settlementStreamToBuffer(stored.stream);
    const actualHash = createHash("sha256").update(buffer).digest("hex");
    assertSettlementBlobIntegrity({
      declaredSize: metadata.fileSize,
      declaredHash: metadata.fileHash,
      actualSize: buffer.length,
      actualHash,
    });
    const result = await importSettlementBatchFromBuffer({
      userId: input.userId,
      source: metadata.source,
      originatorCode: metadata.originator,
      fileName: metadata.fileName,
      fileHash: metadata.fileHash,
      storageKey: metadata.storageKey,
      buffer,
    });
    persisted = true;
    return result;
  } finally {
    if (!persisted) await del(metadata.storageKey).catch(() => undefined);
  }
}

const FROZEN_BATCH_STATUSES = new Set(["GENERATED", "RECONCILING", "RECONCILED", "CANCELLED"]);

async function refreshBatchTotals(batchId: string) {
  const batch = await prisma.consignadoSettlementBatch.findUniqueOrThrow({ where: { id: batchId }, select: { status: true } });
  const items = await prisma.consignadoSettlementItem.findMany({ where: { batchId }, select: {
    status: true, approved: true, paidAmount: true, occurrence: true,
    matchedStockPosition: { select: { nominalValue: true } },
  } });
  const fullItems = items.filter((item) => item.status === "FULL_MATCH").length;
  const partialItems = items.filter((item) => item.status === "PARTIAL_MATCH").length;
  const matchedItems = items.filter((item) => item.approved && (MATCHABLE.has(item.status) || Boolean(underpaid77Difference(item))));
  const received = items.reduce((sum, item) => sum.add(item.paidAmount), new Prisma.Decimal(0));
  const matched = matchedItems.reduce((sum, item) => sum.add(item.paidAmount), new Prisma.Decimal(0));
  const issueItems = items.filter((item) => !item.approved && !["EXCLUDED", "PDD_RECOVERY"].includes(item.status)).length;
  await prisma.consignadoSettlementBatch.update({ where: { id: batchId }, data: {
    fullItems, partialItems, issueItems, receivedAmount: received, matchedAmount: matched, excludedAmount: received.sub(matched),
    ...(FROZEN_BATCH_STATUSES.has(batch.status) ? {} : { status: issueItems ? "REVIEW_REQUIRED" : "READY" }),
  }});
}

export async function searchStockCandidates(batchId: string, query: string) {
  const batch = await prisma.consignadoSettlementBatch.findUniqueOrThrow({ where: { id: batchId }, select: { stockBatchId: true } });
  const text = query.trim();
  const document = digits(text);
  return prisma.receivableStockPosition.findMany({
    where: { batchId: batch.stockBatchId, OR: [
      { yourNumber: { contains: text, mode: "insensitive" } }, { documentNumber: { contains: text, mode: "insensitive" } },
      ...(document ? [{ debtorDocument: { contains: document } }] : []), { debtorName: { contains: text, mode: "insensitive" } },
    ] },
    take: 30, orderBy: [{ debtorName: "asc" }, { originalDueDate: "asc" }],
    select: { id: true, yourNumber: true, documentNumber: true, debtorName: true, debtorDocument: true, nominalValue: true, originalDueDate: true, adjustedDueDate: true, cedentName: true },
  });
}

export async function correctSettlementItem(input: { userId: string; itemId: string; replacementPositionId: string; justification: string }) {
  const item = await prisma.consignadoSettlementItem.findUniqueOrThrow({ where: { id: input.itemId }, include: { batch: true } });
  if (item.batch.status === "GENERATED") throw new Error("O lote já possui remessa gerada.");
  if (item.status === "DUPLICATE" && item.statusReason?.startsWith(ALREADY_REMITTED_REASON)) throw new Error("Título já baixado via OSHER não pode ser substituído por outra parcela.");
  const replacement = await prisma.receivableStockPosition.findFirst({ where: { id: input.replacementPositionId, batchId: item.batch.stockBatchId } });
  if (!replacement) throw new Error("Título substituto não pertence ao estoque utilizado pelo lote.");
  const reused = await prisma.consignadoRemittanceItem.findFirst({ where: { stockPositionId: replacement.id, remittance: { status: { not: "CANCELLED" } }, settlementItemId: { not: item.id } } });
  const usedInBatch = await prisma.consignadoSettlementItem.findFirst({ where: { batchId: item.batchId, id: { not: item.id }, matchedStockPositionId: replacement.id, approved: true } });
  if (reused || usedInBatch) throw new Error("Este título já está sendo utilizado em outro item ou remessa ativa.");
  await prisma.$transaction(async (tx) => {
    await tx.consignadoManualCorrection.updateMany({ where: { itemId: item.id, active: true }, data: { active: false } });
    await tx.consignadoManualCorrection.create({ data: { itemId: item.id, replacementPositionId: replacement.id, previousPositionId: item.matchedStockPositionId, userId: input.userId, originalYourNumber: item.yourNumber, replacementYourNumber: replacement.yourNumber, justification: input.justification, active: true } });
    await tx.consignadoSettlementItem.update({ where: { id: item.id }, data: { matchedStockPositionId: replacement.id, matchedPddTitleId: null, status: "MANUALLY_MATCHED", statusReason: "Título substituído manualmente pelo operador.", approved: true, exclusionReason: null } });
    await tx.consignadoStatusEvent.create({ data: { userId: input.userId, entityType: "SETTLEMENT_ITEM", entityId: item.id, fromStatus: item.status, toStatus: "MANUALLY_MATCHED", metadata: { replacementPositionId: replacement.id, justification: input.justification } } });
  });
  await refreshBatchTotals(item.batchId);
}

export async function setSettlementItemDecision(input: { userId: string; itemId: string; action: "APPROVE" | "EXCLUDE"; reason?: string }) {
  const item = await prisma.consignadoSettlementItem.findUniqueOrThrow({ where: { id: input.itemId }, include: { batch: true, matchedStockPosition: { select: { nominalValue: true } } } });
  if (item.batch.status === "GENERATED") throw new Error("O lote já possui remessa gerada.");
  if (input.action === "APPROVE" && item.status === "DUPLICATE" && item.statusReason?.startsWith(ALREADY_REMITTED_REASON)) throw new Error("Título já baixado via OSHER não pode ser liberado novamente.");
  const underpaid77 = underpaid77Difference(item);
  if (input.action === "APPROVE" && (!item.matchedStockPositionId || (!MATCHABLE.has(item.status) && !underpaid77))) throw new Error("Resolva a divergência antes de aprovar este título.");
  if (input.action === "APPROVE" && item.matchedStockPositionId) {
    const usedInBatch = await prisma.consignadoSettlementItem.findFirst({ where: { batchId: item.batchId, id: { not: item.id }, matchedStockPositionId: item.matchedStockPositionId, approved: true } });
    if (usedInBatch) throw new Error("Este título do estoque já está aprovado em outro item do lote.");
  }
  await prisma.consignadoSettlementItem.update({ where: { id: item.id }, data: input.action === "EXCLUDE"
    ? { status: "EXCLUDED", approved: false, exclusionReason: input.reason?.trim() || "Excluído pelo operador." }
    : { approved: true, exclusionReason: null } });
  await prisma.consignadoStatusEvent.create({ data: { userId: input.userId, entityType: "SETTLEMENT_ITEM", entityId: item.id, fromStatus: item.status, toStatus: input.action === "EXCLUDE" ? "EXCLUDED" : item.status, metadata: { reason: input.reason ?? null, approvalMode: input.action === "APPROVE" ? "INDIVIDUAL" : null, differencePercent: underpaid77?.percentage.toFixed(4) ?? null } } });
  await refreshBatchTotals(item.batchId);
}

export async function approveUnderpaid77InBulk(input: { userId: string; batchId: string; mode: "UP_TO_10" | "GROUPED_DEBTOR" }) {
  const batch = await prisma.consignadoSettlementBatch.findUniqueOrThrow({ where: { id: input.batchId }, select: { status: true } });
  if (batch.status === "GENERATED") throw new Error("O lote já possui remessa gerada.");
  const batchItems = await prisma.consignadoSettlementItem.findMany({
    where: { batchId: input.batchId },
    include: { matchedStockPosition: { select: { nominalValue: true } } },
    orderBy: { sourceRow: "asc" },
  });
  const debtorCounts = new Map<string, number>();
  batchItems.forEach((item) => {
    const key = debtorKey(item);
    if (key) debtorCounts.set(key, (debtorCounts.get(key) ?? 0) + 1);
  });
  const items = batchItems.filter((item) => item.status === "DIVERGENT" && item.occurrence === "77" && item.matchedStockPositionId);
  const alreadyApproved = new Set(batchItems.flatMap((item) => item.approved && item.matchedStockPositionId ? [item.matchedStockPositionId] : []));
  const selectedPositionIds = new Set<string>();
  const eligible = items.flatMap((item) => {
    const difference = underpaid77Difference(item);
    const positionId = item.matchedStockPositionId;
    const key = debtorKey(item);
    const matchesMode = input.mode === "UP_TO_10"
      ? Boolean(difference && difference.percentage.lte(BULK_UNDERPAID_LIMIT_PERCENT))
      : Boolean(difference && difference.percentage.gt(BULK_UNDERPAID_LIMIT_PERCENT) && key && (debtorCounts.get(key) ?? 0) > 1);
    if (item.approved || !matchesMode || !difference || !positionId || alreadyApproved.has(positionId) || selectedPositionIds.has(positionId)) return [];
    selectedPositionIds.add(positionId);
    return [{ item, difference }];
  });
  if (!eligible.length) throw new Error(input.mode === "UP_TO_10"
    ? `Nenhum título com diferença de até ${BULK_UNDERPAID_LIMIT_PERCENT}% está disponível para liberação em lote.`
    : "Nenhum título acima de 10% com sacado recorrente está disponível para liberação em lote.");
  await prisma.$transaction(async (tx) => {
    await tx.consignadoSettlementItem.updateMany({ where: { id: { in: eligible.map(({ item }) => item.id) }, approved: false }, data: { approved: true, exclusionReason: null } });
    await tx.consignadoStatusEvent.createMany({ data: eligible.map(({ item, difference }) => ({
      userId: input.userId, entityType: "SETTLEMENT_ITEM", entityId: item.id, fromStatus: item.status, toStatus: item.status,
      metadata: { approvalMode: input.mode === "UP_TO_10" ? "BULK_UNDERPAID_77" : "BULK_GROUPED_DEBTOR_77", limitPercent: BULK_UNDERPAID_LIMIT_PERCENT, debtorKey: debtorKey(item), differencePercent: difference.percentage.toFixed(4) },
    })) });
  });
  await refreshBatchTotals(input.batchId);
  return {
    approvedItems: eligible.length,
    faceAmount: eligible.reduce((sum, entry) => sum.add(entry.difference.nominal), new Prisma.Decimal(0)).toString(),
    paidAmount: eligible.reduce((sum, entry) => sum.add(entry.item.paidAmount), new Prisma.Decimal(0)).toString(),
  };
}

export async function generateSettlementRemittance(batchId: string, userId: string) {
  const batch = await prisma.consignadoSettlementBatch.findUniqueOrThrow({ where: { id: batchId }, include: {
    originator: true, remittances: true, items: { include: { matchedStockPosition: true } },
  }});
  if (batch.remittances.some((item) => item.status !== "CANCELLED")) throw new Error("Este lote já possui uma remessa ativa.");
  const items = selectRemittanceItems(batch.items);
  const generated = generateDaycovalCnab(items, batch.remittances.length + 1);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const fileName = `${batch.source}_${batch.originator?.code ?? "ORIGINADOR"}_${date}_${batch.id.slice(-6)}.REM`;
  const storageKey = `operacional/consignado/remessas/${fileName}`;
  await put(storageKey, generated.buffer, { access: "private", addRandomSuffix: false, contentType: "text/plain; charset=iso-8859-1" });
  const totalAmount = items.reduce((sum, item) => sum.add(item.paidAmount), new Prisma.Decimal(0));
  try {
    return await prisma.$transaction(async (tx) => {
      const autoExcluded = batch.items.filter((item) => !item.approved && !["EXCLUDED", "PDD_RECOVERY"].includes(item.status));
      await tx.consignadoSettlementItem.updateMany({ where: { batchId, approved: false, status: { notIn: ["EXCLUDED", "PDD_RECOVERY"] } }, data: { status: "EXCLUDED", exclusionReason: AUTO_EXCLUSION_REASON } });
      const remittance = await tx.consignadoRemittance.create({ data: { batchId, fundId: batch.fundId, generatedByUserId: userId, fileName, storageKey, fileHash: generated.hash, totalItems: items.length, totalAmount } });
      if (autoExcluded.length) await tx.consignadoStatusEvent.createMany({ data: autoExcluded.map((item) => ({
        userId, entityType: "SETTLEMENT_ITEM", entityId: item.id, fromStatus: item.status, toStatus: "EXCLUDED",
        metadata: { reason: REMITTANCE_EXCLUSION_EVENT_REASON, remittanceId: remittance.id },
      })) });
      const remittanceRows = items.map((item) => ({ remittanceId: remittance.id, settlementItemId: item.id, stockPositionId: item.matchedStockPosition.id, yourNumber: item.matchedStockPosition.yourNumber, documentNumber: item.matchedStockPosition.documentNumber, debtorDocument: item.matchedStockPosition.debtorDocument, amount: item.paidAmount, occurrence: item.occurrence ?? "77" }));
      for (const rows of chunked(remittanceRows, INSERT_CHUNK)) await tx.consignadoRemittanceItem.createMany({ data: rows });
      const exclusionPersistence = buildRemittanceExclusionPersistence(remittance.id, batch.items, items);
      for (const rows of chunked(exclusionPersistence.exclusions, INSERT_CHUNK)) await tx.consignadoRemittanceExclusion.createMany({ data: rows, skipDuplicates: true });
      await tx.consignadoSettlementBatch.update({ where: { id: batchId }, data: { status: "GENERATED" } });
      await tx.consignadoStatusEvent.create({ data: { userId, entityType: "REMITTANCE", entityId: remittance.id, toStatus: "GENERATED", metadata: { fileName, totalItems: items.length, totalAmount: totalAmount.toString(), ...exclusionPersistence.metadata } } });
      return remittance;
    }, { maxWait: 15_000, timeout: 240_000 });
  } catch (error) { await del(storageKey).catch(() => undefined); throw error; }
}

export async function getRemittanceDownload(remittanceId: string) {
  const remittance = await prisma.consignadoRemittance.findUniqueOrThrow({ where: { id: remittanceId }, select: { fileName: true, storageKey: true, status: true, totalAmount: true, allocatedAmount: true, adjustedAmount: true, bankAllocations: { where: { reconciliation: { status: "ACTIVE" } }, select: { reconciliationId: true } }, bankAdjustments: { where: { reconciliation: { status: "ACTIVE" } }, select: { reconciliationId: true } } } });
  const eligibility = remittanceDownloadEligibility({ status: remittance.status, totalAmount: Number(remittance.totalAmount), allocatedAmount: Number(remittance.allocatedAmount), adjustedAmount: Number(remittance.adjustedAmount), activeReconciliations: new Set([...remittance.bankAllocations, ...remittance.bankAdjustments].map((item) => item.reconciliationId)).size });
  if (!eligibility.allowed) throw new RemittanceDownloadBlockedError(eligibility.reason ?? undefined);
  const blob = await get(remittance.storageKey, { access: "private", useCache: false });
  if (!blob?.stream) throw new Error("Arquivo da remessa não encontrado.");
  return { fileName: remittance.fileName, stream: blob.stream };
}

export async function cancelSettlementRemittance(remittanceId: string, userId: string) {
  const remittance = await prisma.$transaction(async (tx) => {
    const current = await tx.consignadoRemittance.findUniqueOrThrow({
      where: { id: remittanceId },
      include: {
        bankAllocations: { where: { reconciliation: { status: "ACTIVE" } }, select: { reconciliationId: true } },
        bankAdjustments: { where: { reconciliation: { status: "ACTIVE" } }, select: { reconciliationId: true } },
      },
    });
    const activeReconciliations = new Set([...current.bankAllocations, ...current.bankAdjustments].map((item) => item.reconciliationId)).size;
    assertRemittanceCancellationAllowed({ status: current.status, activeReconciliations });
    await tx.consignadoRemittance.update({ where: { id: current.id }, data: { status: "CANCELLED" } });
    await tx.consignadoSettlementBatch.update({ where: { id: current.batchId }, data: { status: "READY" } });
    await tx.consignadoStatusEvent.create({ data: { userId, entityType: "REMITTANCE", entityId: current.id, fromStatus: current.status, toStatus: "CANCELLED", metadata: { fileName: current.fileName, reason: "CANCELLED_BY_OPERATOR" } } });
    return current;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await del(remittance.storageKey).catch(() => undefined);
  return { id: remittance.id, batchId: remittance.batchId };
}

export async function reopenSettlementBatch(batchId: string, userId: string) {
  const fund = await consignadoFund();
  const batch = await prisma.consignadoSettlementBatch.findFirstOrThrow({
    where: { id: batchId, fundId: fund.id },
    select: { id: true, status: true, items: { select: { id: true, status: true, exclusionReason: true, matchedStockPositionId: true, paidAmount: true } } },
  });
  const reopenable = selectReopenableItems(batch.items);
  assertBatchReopenAllowed({ batchStatus: batch.status, reopenableItems: reopenable.length });

  const events = await prisma.consignadoStatusEvent.findMany({
    where: { entityType: "SETTLEMENT_ITEM", entityId: { in: reopenable.map((item) => item.id) }, toStatus: "EXCLUDED" },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, fromStatus: true, metadata: true },
  });
  const recordedByItem = new Map<string, string | null>();
  events.forEach((event) => {
    const metadata = event.metadata as { reason?: string } | null;
    if (metadata?.reason !== REMITTANCE_EXCLUSION_EVENT_REASON || recordedByItem.has(event.entityId)) return;
    recordedByItem.set(event.entityId, event.fromStatus);
  });

  const restored = reopenable.map((item) => ({
    item,
    status: resolveRestoredStatus({ recordedFromStatus: recordedByItem.get(item.id), matchedStockPositionId: item.matchedStockPositionId }),
  }));

  await prisma.$transaction(async (tx) => {
    for (const entry of restored) {
      await tx.consignadoSettlementItem.update({ where: { id: entry.item.id }, data: { status: entry.status, approved: false, exclusionReason: null } });
    }
    await tx.consignadoStatusEvent.createMany({ data: restored.map((entry) => ({
      userId, entityType: "SETTLEMENT_ITEM", entityId: entry.item.id, fromStatus: "EXCLUDED", toStatus: entry.status,
      metadata: { reason: "BATCH_REOPENED", restoredFrom: recordedByItem.get(entry.item.id) ?? null },
    })) });
    await tx.consignadoStatusEvent.create({ data: {
      userId, entityType: "SETTLEMENT_BATCH", entityId: batch.id, fromStatus: batch.status, toStatus: batch.status,
      metadata: { reason: "BATCH_REOPENED", reopenedItems: restored.length },
    } });
  }, { maxWait: 5000, timeout: 30000 });

  await refreshBatchTotals(batchId);
  return {
    reopenedItems: restored.length,
    paidAmount: restored.reduce((sum, entry) => sum.add(entry.item.paidAmount), new Prisma.Decimal(0)).toString(),
  };
}

export async function cancelSettlementBatch(batchId: string, userId: string) {
  const fund = await consignadoFund();
  return prisma.$transaction(async (tx) => {
    const batch = await tx.consignadoSettlementBatch.findFirstOrThrow({
      where: { id: batchId, fundId: fund.id },
      include: { remittances: { select: { status: true } } },
    });
    if (batch.status === "CANCELLED") throw new Error("Este lote já foi excluído da visualização.");
    if (batch.remittances.some((remittance) => remittance.status !== "CANCELLED")) {
      throw new Error("Não é possível excluir um lote que possui remessa ativa ou conciliada.");
    }
    const cancelled = await tx.consignadoSettlementBatch.update({ where: { id: batch.id }, data: { status: "CANCELLED" } });
    await tx.consignadoStatusEvent.create({ data: {
      userId,
      entityType: "SETTLEMENT_BATCH",
      entityId: batch.id,
      fromStatus: batch.status,
      toStatus: "CANCELLED",
      metadata: { reason: "REMOVED_FROM_WORKSPACE", fileName: batch.fileName },
    } });
    return cancelled;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function getSettlementWorkspace(input: { createdDate?: string; originator?: string } = {}) {
  const filters = normalizeSettlementWorkspaceFilters(input);
  const fund = await consignadoFund();
  const [originators, batches, pddSummary] = await Promise.all([
    listConsignadoOriginators(),
    prisma.consignadoSettlementBatch.findMany({
      where: { fundId: fund.id, status: { not: "CANCELLED" }, ...(filters.createdDate ? { createdAt: saoPauloDayRange(filters.createdDate) } : {}), ...(filters.originator ? { originator: { code: filters.originator } } : {}) },
      orderBy: { createdAt: "desc" },
      take: filters.createdDate ? undefined : 30,
      include: {
        originator: true,
        stockBatch: { select: { referenceDate: true, version: true } },
        remittances: {
          where: { status: { not: "CANCELLED" } },
          select: {
            id: true,
            fileName: true,
            status: true,
            stockStatus: true,
            totalItems: true,
            totalAmount: true,
            allocatedAmount: true,
            adjustedAmount: true,
            generatedAt: true,
            bankAllocations: {
              where: { reconciliation: { status: "ACTIVE" } },
              select: {
                amount: true,
                reconciliation: { select: { id: true, status: true, createdAt: true } },
                bankEntry: { select: { id: true, transactionDate: true, description: true, document: true, amount: true } },
              },
              orderBy: { reconciliation: { createdAt: "asc" } },
            },
            bankAdjustments: {
              where: { reconciliation: { status: "ACTIVE" } },
              select: { reconciliationId: true },
            },
          },
        },
        items: {
          orderBy: { sourceRow: "asc" },
          include: {
            matchedStockPosition: { select: { id: true, yourNumber: true, documentNumber: true, debtorName: true, debtorDocument: true, nominalValue: true, adjustedDueDate: true, originalDueDate: true } },
            matchedPddTitle: { select: { id: true, remittanceFile: true, generatedAt: true, yourNumberUsed: true, documentNumber: true, debtorName: true, debtorDocument: true, nominalValue: true, pddValue: true, dueDate: true, writeOffType: true, originator: true } },
            corrections: { where: { active: true }, select: { id: true, justification: true, replacementYourNumber: true, createdAt: true } },
          },
        },
      },
    }),
    getConsignadoPddSummary(fund.id),
  ]);
  const batchesWithFinancialSummary = batches.map((batch) => ({
    ...batch,
    remittances: batch.remittances.map((remittance) => ({
      ...remittance,
      downloadEligibility: remittanceDownloadEligibility({ status: remittance.status, totalAmount: Number(remittance.totalAmount), allocatedAmount: Number(remittance.allocatedAmount), adjustedAmount: Number(remittance.adjustedAmount), activeReconciliations: new Set([...remittance.bankAllocations.map((item) => item.reconciliation.id), ...remittance.bankAdjustments.map((item) => item.reconciliationId)]).size }),
    })),
    financialSummary: summarizeBatchReconciliation({
      receivedAmount: batch.receivedAmount.toString(),
      remittances: batch.remittances.map((remittance) => ({
        id: remittance.id,
        status: remittance.status,
        totalAmount: remittance.totalAmount.toString(),
        allocatedAmount: remittance.allocatedAmount.toString(),
        adjustedAmount: remittance.adjustedAmount.toString(),
        allocations: remittance.bankAllocations.map((allocation) => ({
          amount: allocation.amount.toString(),
          reconciliation: {
            id: allocation.reconciliation.id,
            status: allocation.reconciliation.status,
            createdAt: allocation.reconciliation.createdAt.toISOString(),
          },
          bankEntry: {
            id: allocation.bankEntry.id,
            transactionDate: allocation.bankEntry.transactionDate.toISOString(),
            description: allocation.bankEntry.description,
            document: allocation.bankEntry.document,
            amount: allocation.bankEntry.amount.toString(),
          },
        })),
      })),
    }),
  }));
  return JSON.parse(JSON.stringify({ originators, batches: batchesWithFinancialSummary, pddSummary }, (_, value) => value instanceof Prisma.Decimal ? value.toString() : value));
}

export async function reconcileRemittancesWithStock(stockBatchId: string, userId?: string) {
  const stock = await prisma.importBatch.findFirstOrThrow({ where: { id: stockBatchId, status: "COMPLETED" }, select: { id: true, fundId: true, referenceDate: true, isActive: true } });
  if (!stock.isActive || !stock.fundId || !stock.referenceDate) return { processed: 0 };
  const remittances = await prisma.consignadoRemittance.findMany({ where: { fundId: stock.fundId, status: { not: "CANCELLED" }, stockStatus: { in: ["AWAITING_NEXT_STOCK", "STILL_IN_STOCK"] }, batch: { referenceDate: { lt: stock.referenceDate } } }, include: { items: true } });
  for (const remittance of remittances) {
    for (const item of remittance.items) {
      if (!item.yourNumber && !item.documentNumber) {
        await prisma.consignadoRemittanceItem.update({ where: { id: item.id }, data: { stockStatus: "REVIEW_REQUIRED", checkedAt: new Date() } });
        continue;
      }
      const present = await prisma.receivableStockPosition.findFirst({ where: { batchId: stock.id, OR: [
        ...(item.yourNumber ? [{ yourNumber: item.yourNumber }] : []),
        ...(item.documentNumber ? [{ documentNumber: item.documentNumber, debtorDocument: item.debtorDocument ?? undefined }] : []),
      ] }, select: { id: true } });
      await prisma.consignadoRemittanceItem.update({ where: { id: item.id }, data: { stockStatus: present ? "STILL_IN_STOCK" : "CONFIRMED", checkedAt: new Date() } });
    }
    const statuses = await prisma.consignadoRemittanceItem.findMany({ where: { remittanceId: remittance.id }, select: { stockStatus: true } });
    const overall = statuses.some((item) => item.stockStatus === "REVIEW_REQUIRED") ? "REVIEW_REQUIRED" : statuses.some((item) => item.stockStatus === "STILL_IN_STOCK") ? "STILL_IN_STOCK" : "CONFIRMED";
    await prisma.consignadoRemittance.update({ where: { id: remittance.id }, data: { stockStatus: overall, checkedStockBatchId: stock.id, checkedAt: new Date() } });
    await prisma.consignadoStatusEvent.create({ data: { userId, entityType: "REMITTANCE_STOCK", entityId: remittance.id, fromStatus: remittance.stockStatus, toStatus: overall, metadata: { stockBatchId: stock.id } } });
  }
  return { processed: remittances.length };
}
