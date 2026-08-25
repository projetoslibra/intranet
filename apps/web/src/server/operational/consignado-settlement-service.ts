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
import { assertRemittanceCancellationAllowed, DuplicateSettlementFileError, findPreviouslyRemittedTitle, remittanceDownloadEligibility, RemittanceDownloadBlockedError, type PreviousRemittanceTitle } from "./consignado-settlement-safety";
import {
  assertSettlementBlobIntegrity,
  validateSettlementUploadMetadata,
  type SettlementUploadMetadata,
} from "@/features/operational/consignado-settlement-upload";

const CONSIGNADO_CNPJ = "54842157000193";
export const BULK_UNDERPAID_LIMIT_PERCENT = 10;
const MATCHABLE = new Set<SettlementItemStatus>(["FULL_MATCH", "PARTIAL_MATCH", "MANUALLY_MATCHED"]);
const ALREADY_REMITTED_REASON = "Título já baixado via OSHER";

function digits(value: unknown) { return String(value ?? "").replace(/\D/g, ""); }
function normalized(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase().replace(/\s+/g, " ");
}
function sameMoney(left: unknown, right: unknown) { return Math.abs(Number(left) - Number(right)) < 0.01; }
function dateKey(value: Date | null | undefined) { return value?.toISOString().slice(0, 10) ?? null; }
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

async function loadCandidates(stockBatchId: string, items: ParsedSettlementItem[]) {
  const all = new Map<string, StockCandidate>();
  for (let offset = 0; offset < items.length; offset += 150) {
    const chunk = items.slice(offset, offset + 150);
    const clauses: Prisma.ReceivableStockPositionWhereInput[] = [];
    chunk.forEach((item) => {
      if (item.yourNumber) clauses.push({ yourNumber: item.yourNumber });
      if (item.documentNumber) clauses.push({ documentNumber: item.documentNumber });
      if (item.contractNumber) clauses.push({ documentNumber: item.contractNumber });
      if (item.debtorDocument) clauses.push({ debtorDocument: { contains: digits(item.debtorDocument) } });
    });
    if (!clauses.length) continue;
    const rows = await prisma.receivableStockPosition.findMany({ where: { batchId: stockBatchId, OR: clauses } });
    rows.forEach((row) => all.set(row.id, row));
  }
  return Array.from(all.values());
}

async function loadPreviouslyRemittedTitles(fundId: string, items: ParsedSettlementItem[]): Promise<PreviousRemittanceTitle[]> {
  const rows = new Map<string, PreviousRemittanceTitle>();
  for (let offset = 0; offset < items.length; offset += 150) {
    const clauses: Prisma.ConsignadoRemittanceItemWhereInput[] = [];
    items.slice(offset, offset + 150).forEach((item) => {
      if (item.yourNumber) clauses.push({ yourNumber: item.yourNumber });
      if (item.documentNumber) clauses.push({ documentNumber: item.documentNumber });
      if (item.debtorDocument) clauses.push({ debtorDocument: { contains: digits(item.debtorDocument) } });
    });
    if (!clauses.length) continue;
    const found = await prisma.consignadoRemittanceItem.findMany({
      where: { remittance: { fundId, status: { not: "CANCELLED" } }, OR: clauses },
      select: { id: true, yourNumber: true, documentNumber: true, debtorDocument: true, amount: true, settlementItem: { select: { contractNumber: true, installmentNumber: true } }, remittance: { select: { id: true, fileName: true, status: true, generatedAt: true, batch: { select: { source: true, originator: { select: { code: true } } } } } } },
    });
    found.forEach((item) => rows.set(item.id, { id: item.id, source: item.remittance.batch.source, originatorCode: item.remittance.batch.originator?.code ?? null, yourNumber: item.yourNumber, documentNumber: item.documentNumber, contractNumber: item.settlementItem.contractNumber, installmentNumber: item.settlementItem.installmentNumber, debtorDocument: item.debtorDocument, amount: Number(item.amount), remittanceId: item.remittance.id, remittanceFileName: item.remittance.fileName, remittanceStatus: item.remittance.status, generatedAt: item.remittance.generatedAt }));
  }
  return Array.from(rows.values()).sort((left, right) => right.generatedAt.getTime() - left.generatedAt.getTime());
}

function sourceMatches(source: OperationalFlowSource, candidate: StockCandidate) {
  const cedent = normalized(candidate.cedentName);
  return source === "UY3" ? cedent.includes("UY3") : cedent.includes("BMP") || cedent.includes("MONEY PLUS");
}

function chooseCandidate(source: OperationalFlowSource, item: ParsedSettlementItem, candidates: StockCandidate[]) {
  if (item.parseIssue) return { status: "DIVERGENT" as const, reason: item.parseIssue, candidate: null };
  const ranked = candidates
    .filter((candidate) => sourceMatches(source, candidate))
    .map((candidate) => {
      let score = 0;
      if (item.yourNumber && candidate.yourNumber === item.yourNumber) score += 120;
      if (item.documentNumber && candidate.documentNumber === item.documentNumber) score += 70;
      if (item.contractNumber && candidate.documentNumber === item.contractNumber) score += 60;
      if (item.debtorDocument && digits(candidate.debtorDocument) === digits(item.debtorDocument)) score += 25;
      if (item.debtorName && normalized(candidate.debtorName) === normalized(item.debtorName)) score += 15;
      if (sameMoney(candidate.nominalValue, item.titleAmount)) score += 15;
      if (item.dueDate && dateKey(candidate.adjustedDueDate ?? candidate.originalDueDate) === dateKey(item.dueDate)) score += 5;
      return { candidate, score };
    })
    .filter((entry) => entry.score >= 60)
    .sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id));
  if (!ranked.length) return { status: "NOT_FOUND" as const, reason: "Título não encontrado no estoque ativo.", candidate: null };
  const top = ranked[0];
  if (ranked[1]?.score === top.score) return { status: "AMBIGUOUS" as const, reason: `${ranked.filter((entry) => entry.score === top.score).length} candidatos equivalentes.`, candidate: null };

  const nominal = Number(top.candidate.nominalValue);
  const paid = Number(item.paidAmount);
  if (item.occurrence === "14") {
    if (!(paid > 0 && paid < nominal)) return { status: "DIVERGENT" as const, reason: "Ocorrência 14 exige valor pago positivo e menor que o valor de face do estoque.", candidate: top.candidate };
    return { status: "PARTIAL_MATCH" as const, reason: null, candidate: top.candidate };
  }
  if (item.occurrence !== "77") return { status: "DIVERGENT" as const, reason: "Ocorrência diferente de 14 ou 77.", candidate: top.candidate };
  if (!sameMoney(paid, nominal) && paid < nominal) return { status: "DIVERGENT" as const, reason: "Ocorrência 77 com valor pago inferior ao valor de face.", candidate: top.candidate };
  return { status: "FULL_MATCH" as const, reason: null, candidate: top.candidate };
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
  const usedPositions = new Set<string>();
  const matched = parsed.map((item) => {
    const previous = findPreviouslyRemittedTitle({ source: input.source, originatorCode: originator.code, yourNumber: item.yourNumber, documentNumber: item.documentNumber, contractNumber: item.contractNumber, installmentNumber: item.installmentNumber, debtorDocument: item.debtorDocument, paidAmount: Number(item.paidAmount) }, remittedTitles);
    if (previous) return { item, status: "DUPLICATE" as SettlementItemStatus, reason: `${ALREADY_REMITTED_REASON} na remessa ${previous.remittanceFileName}, gerada em ${previous.generatedAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`, candidate: null, pddTitle: null };
    let result: ReturnType<typeof chooseCandidate> | (ReturnType<typeof classifyPddMatch> & { candidate: null }) = chooseCandidate(input.source, item, candidates);
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
      await tx.consignadoSettlementItem.createMany({ data: matched.map(({ item, status, reason, candidate, pddTitle }) => ({
        batchId: created.id, sourceRow: item.sourceRow, sourceRaw: item.sourceRaw, occurrence: item.occurrence,
        contractNumber: item.contractNumber, installmentNumber: item.installmentNumber, yourNumber: item.yourNumber,
        documentNumber: item.documentNumber, debtorName: item.debtorName, debtorDocument: item.debtorDocument,
        dueDate: item.dueDate, titleAmount: new Prisma.Decimal(item.titleAmount), paidAmount: new Prisma.Decimal(item.paidAmount),
        status, statusReason: reason, matchedStockPositionId: candidate?.id ?? null, matchedPddTitleId: pddTitle?.id ?? null, approved: MATCHABLE.has(status),
      })) });
      await tx.consignadoStatusEvent.create({ data: { userId: input.userId, entityType: "SETTLEMENT_BATCH", entityId: created.id, toStatus: created.status, metadata: { stockBatchId: stock.id, originator: originator.code } } });
      return created;
    });
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

async function refreshBatchTotals(batchId: string) {
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
    status: issueItems ? "REVIEW_REQUIRED" : "READY",
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
      await tx.consignadoSettlementItem.updateMany({ where: { batchId, approved: false, status: { notIn: ["EXCLUDED", "PDD_RECOVERY"] } }, data: { status: "EXCLUDED", exclusionReason: "Não incluído na remessa aprovada." } });
      const remittance = await tx.consignadoRemittance.create({ data: { batchId, fundId: batch.fundId, generatedByUserId: userId, fileName, storageKey, fileHash: generated.hash, totalItems: items.length, totalAmount } });
      await tx.consignadoRemittanceItem.createMany({ data: items.map((item) => ({ remittanceId: remittance.id, settlementItemId: item.id, stockPositionId: item.matchedStockPosition.id, yourNumber: item.matchedStockPosition.yourNumber, documentNumber: item.matchedStockPosition.documentNumber, debtorDocument: item.matchedStockPosition.debtorDocument, amount: item.paidAmount, occurrence: item.occurrence ?? "77" })) });
      const exclusionPersistence = buildRemittanceExclusionPersistence(remittance.id, batch.items, items);
      if (exclusionPersistence.exclusions.length) await tx.consignadoRemittanceExclusion.createMany({ data: exclusionPersistence.exclusions, skipDuplicates: true });
      await tx.consignadoSettlementBatch.update({ where: { id: batchId }, data: { status: "GENERATED" } });
      await tx.consignadoStatusEvent.create({ data: { userId, entityType: "REMITTANCE", entityId: remittance.id, toStatus: "GENERATED", metadata: { fileName, totalItems: items.length, totalAmount: totalAmount.toString(), ...exclusionPersistence.metadata } } });
      return remittance;
    });
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

export async function getSettlementWorkspace(input: { createdDate?: string } = {}) {
  const fund = await consignadoFund();
  const [originators, batches, pddSummary] = await Promise.all([
    listConsignadoOriginators(),
    prisma.consignadoSettlementBatch.findMany({
      where: { fundId: fund.id, status: { not: "CANCELLED" }, ...(input.createdDate ? { createdAt: saoPauloDayRange(input.createdDate) } : {}) },
      orderBy: { createdAt: "desc" },
      take: input.createdDate ? undefined : 30,
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
