import type { SettlementItemStatus } from "@prisma/client";

/** Motivo gravado pela geração da remessa nos títulos que ficaram de fora automaticamente. */
export const AUTO_EXCLUSION_REASON = "Não incluído na remessa aprovada.";

/** Motivo registrado no evento de auditoria da exclusão automática, usado para restaurar o status original. */
export const REMITTANCE_EXCLUSION_EVENT_REASON = "REMITTANCE_GENERATED";

const RESTORABLE_STATUSES = new Set<SettlementItemStatus>([
  "FULL_MATCH", "PARTIAL_MATCH", "NOT_FOUND", "PDD_RECOVERY", "PDD_REVIEW",
  "AMBIGUOUS", "DIVERGENT", "DUPLICATE", "MANUALLY_MATCHED",
]);

export type ReopenableItem = {
  id: string;
  status: SettlementItemStatus;
  exclusionReason: string | null;
  matchedStockPositionId: string | null;
};

export function isAutoExcluded(item: ReopenableItem) {
  return item.status === "EXCLUDED" && item.exclusionReason === AUTO_EXCLUSION_REASON;
}

export function selectReopenableItems<T extends ReopenableItem>(items: T[]) {
  return items.filter((item) => isAutoExcluded(item));
}

export function resolveRestoredStatus(input: { recordedFromStatus?: string | null; matchedStockPositionId: string | null }): SettlementItemStatus {
  const recorded = input.recordedFromStatus;
  if (recorded && RESTORABLE_STATUSES.has(recorded as SettlementItemStatus)) return recorded as SettlementItemStatus;
  return input.matchedStockPositionId ? "DIVERGENT" : "NOT_FOUND";
}

export function assertBatchReopenAllowed(input: { batchStatus: string; reopenableItems: number }) {
  if (input.batchStatus === "CANCELLED") throw new Error("Este lote foi excluído da visualização e não pode ser reaberto.");
  if (input.reopenableItems === 0) throw new Error("Nenhum título deste lote foi excluído pela geração da remessa.");
}
