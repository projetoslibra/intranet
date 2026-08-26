import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildCrossMatchSuggestions, type CrossMatchGroup, type CrossMatchPosition } from "./consignado-cross-match";
import { refreshBatchTotals } from "./consignado-settlement-service";

const CHUNK = 300;

const groupJustification: Record<CrossMatchGroup, string> = {
  FULL_KEY: "chave completa: sacado, valor nominal e vencimento idênticos ao título do estoque",
  OLDEST_NEXT_MONTH: "parcela em aberto mais antiga, um mês após o vencimento do arquivo",
  OLDEST_WIDE_GAP: "parcela em aberto mais antiga, com intervalo maior que um mês",
};

function digits(value: unknown) { return String(value ?? "").replace(/\D/g, ""); }

export function documentVariants(document: string | null) {
  const value = digits(document);
  if (!value) return [];
  if (value.length === 11) return [value, `${value.slice(0, 3)}.${value.slice(3, 6)}.${value.slice(6, 9)}-${value.slice(9)}`];
  if (value.length === 14) return [value, `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8, 12)}-${value.slice(12)}`];
  return [value];
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) result.push(values.slice(offset, offset + size));
  return result;
}

const positionSelect = {
  id: true, yourNumber: true, documentNumber: true, debtorName: true, debtorDocument: true,
  cedentName: true, nominalValue: true, originalDueDate: true, adjustedDueDate: true,
} satisfies Prisma.ReceivableStockPositionSelect;

type PositionRow = Prisma.ReceivableStockPositionGetPayload<{ select: typeof positionSelect }>;

async function loadContext(batchId: string) {
  const batch = await prisma.consignadoSettlementBatch.findUniqueOrThrow({
    where: { id: batchId },
    select: { id: true, source: true, status: true, stockBatchId: true },
  });
  const items = await prisma.consignadoSettlementItem.findMany({
    where: { batchId, status: "NOT_FOUND", approved: false },
    select: { id: true, sourceRow: true, contractNumber: true, debtorName: true, debtorDocument: true, dueDate: true, titleAmount: true, paidAmount: true },
    orderBy: { sourceRow: "asc" },
  });

  const documents = new Set<string>();
  const names = new Set<string>();
  items.forEach((item) => {
    const variants = documentVariants(item.debtorDocument);
    if (variants.length) variants.forEach((variant) => documents.add(variant));
    else if (item.debtorName) names.add(item.debtorName);
  });

  const positions = new Map<string, PositionRow>();
  for (const chunk of chunks(Array.from(documents), CHUNK)) {
    const rows = await prisma.receivableStockPosition.findMany({ where: { batchId: batch.stockBatchId, debtorDocument: { in: chunk } }, select: positionSelect });
    rows.forEach((row) => positions.set(row.id, row));
  }
  for (const chunk of chunks(Array.from(names), 50)) {
    const rows = await prisma.receivableStockPosition.findMany({
      where: { batchId: batch.stockBatchId, OR: chunk.map((name) => ({ debtorName: { equals: name, mode: "insensitive" as const } })) },
      select: positionSelect,
    });
    rows.forEach((row) => positions.set(row.id, row));
  }

  const approvedInBatch = await prisma.consignadoSettlementItem.findMany({
    where: { batchId, approved: true, matchedStockPositionId: { not: null } },
    select: { matchedStockPositionId: true },
  });
  const blocked = new Set(approvedInBatch.flatMap((entry) => entry.matchedStockPositionId ? [entry.matchedStockPositionId] : []));
  for (const chunk of chunks(Array.from(positions.keys()), CHUNK)) {
    const remitted = await prisma.consignadoRemittanceItem.findMany({
      where: { stockPositionId: { in: chunk }, remittance: { status: { not: "CANCELLED" } } },
      select: { stockPositionId: true },
    });
    remitted.forEach((entry) => { if (entry.stockPositionId) blocked.add(entry.stockPositionId); });
  }

  const enginePositions: CrossMatchPosition[] = Array.from(positions.values()).map((row) => ({
    id: row.id, yourNumber: row.yourNumber, documentNumber: row.documentNumber,
    debtorName: row.debtorName, debtorDocument: row.debtorDocument, cedentName: row.cedentName,
    nominalValue: Number(row.nominalValue), dueDate: row.adjustedDueDate ?? row.originalDueDate,
  }));

  const result = buildCrossMatchSuggestions({
    source: batch.source as "BMP" | "UY3",
    items: items.map((item) => ({ id: item.id, sourceRow: item.sourceRow, debtorName: item.debtorName, debtorDocument: item.debtorDocument, dueDate: item.dueDate, titleAmount: Number(item.titleAmount) })),
    positions: enginePositions,
    blockedPositionIds: blocked,
  });

  return { batch, items, positions, result };
}

export async function suggestCrossMatches(batchId: string) {
  const { items, positions, result } = await loadContext(batchId);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const suggestions = result.suggestions.flatMap((suggestion) => {
    const item = itemById.get(suggestion.itemId);
    const position = positions.get(suggestion.positionId);
    if (!item || !position) return [];
    return [{
      itemId: suggestion.itemId, group: suggestion.group, matchedOn: suggestion.matchedOn,
      fileDueDate: suggestion.fileDueDate, stockDueDate: suggestion.stockDueDate,
      item: { sourceRow: item.sourceRow, contractNumber: item.contractNumber, debtorName: item.debtorName, debtorDocument: item.debtorDocument, titleAmount: item.titleAmount.toString(), paidAmount: item.paidAmount.toString() },
      position: {
        id: position.id, yourNumber: position.yourNumber, documentNumber: position.documentNumber,
        debtorName: position.debtorName, debtorDocument: position.debtorDocument,
        nominalValue: position.nominalValue.toString(),
        dueDate: (position.adjustedDueDate ?? position.originalDueDate)?.toISOString().slice(0, 10) ?? null,
      },
    }];
  });
  suggestions.sort((left, right) => left.item.sourceRow - right.item.sourceRow);
  const unmatched = result.unmatchedItemIds.flatMap((itemId) => {
    const item = itemById.get(itemId);
    return item ? [{ itemId, sourceRow: item.sourceRow, debtorName: item.debtorName, debtorDocument: item.debtorDocument, titleAmount: item.titleAmount.toString(), paidAmount: item.paidAmount.toString() }] : [];
  }).sort((left, right) => left.sourceRow - right.sourceRow);
  return { analyzed: items.length, suggestions, unmatched };
}

export async function applyCrossMatches(input: { userId: string; batchId: string; itemIds: string[] }) {
  const { batch, items, result } = await loadContext(input.batchId);
  if (batch.status === "GENERATED") throw new Error("O lote já possui remessa gerada.");
  const requested = new Set(input.itemIds);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const selected = result.suggestions.filter((suggestion) => requested.has(suggestion.itemId) && itemById.has(suggestion.itemId));
  if (!selected.length) throw new Error("Nenhuma sugestão válida para aplicar. Rode o cruzamento novamente.");

  await prisma.$transaction(async (tx) => {
    for (const suggestion of selected) {
      const item = itemById.get(suggestion.itemId)!;
      const matchedBy = suggestion.matchedOn.includes("debtorDocument") ? "CPF" : "nome do sacado";
      const justification = `Cruzamento automático (${matchedBy}) — ${groupJustification[suggestion.group]}.`;
      await tx.consignadoManualCorrection.updateMany({ where: { itemId: item.id, active: true }, data: { active: false } });
      await tx.consignadoManualCorrection.create({ data: {
        itemId: item.id, replacementPositionId: suggestion.positionId, previousPositionId: null,
        userId: input.userId, originalYourNumber: item.contractNumber, replacementYourNumber: null,
        justification, active: true,
      } });
      await tx.consignadoSettlementItem.update({ where: { id: item.id }, data: {
        matchedStockPositionId: suggestion.positionId, matchedPddTitleId: null,
        status: "MANUALLY_MATCHED", statusReason: justification, approved: true, exclusionReason: null,
      } });
      await tx.consignadoStatusEvent.create({ data: {
        userId: input.userId, entityType: "SETTLEMENT_ITEM", entityId: item.id,
        fromStatus: "NOT_FOUND", toStatus: "MANUALLY_MATCHED",
        metadata: { crossMatchGroup: suggestion.group, matchedOn: suggestion.matchedOn, fileDueDate: suggestion.fileDueDate, stockDueDate: suggestion.stockDueDate, positionId: suggestion.positionId },
      } });
    }
  }, { maxWait: 5000, timeout: 30000 });

  await refreshBatchTotals(input.batchId);
  return {
    appliedItems: selected.length,
    paidAmount: selected.reduce((sum, suggestion) => sum.add(itemById.get(suggestion.itemId)!.paidAmount), new Prisma.Decimal(0)).toString(),
  };
}
