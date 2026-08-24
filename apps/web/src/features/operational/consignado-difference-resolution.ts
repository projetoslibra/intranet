import type { DifferenceReport, DifferenceReportFilters } from "@/server/operational/consignado-difference-report";
import { decimalAmountToCents } from "./consignado-difference-composer";

export type DifferenceResolutionResult = {
  id: string;
  status: "RESOLVED";
  resolvedAt: string;
  resolutionNote: string;
  resolvedBy: { id: string; name: string };
};

function decimalFromCents(value: bigint) {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`;
}

function subtractAmount(current: string, removed: string) {
  const currentCents = decimalAmountToCents(current);
  const removedCents = decimalAmountToCents(removed);
  if (currentCents === null || removedCents === null) throw new Error("Resumo monetário inválido recebido do servidor.");
  return decimalFromCents(currentCents - removedCents);
}

export function applyDifferenceResolutionToReport(report: DifferenceReport, resolution: DifferenceResolutionResult): DifferenceReport {
  const current = report.items.find((item) => item.id === resolution.id);
  if (!current || current.status !== "OPEN" || current.reconciliationStatus !== "ACTIVE") return report;
  const decrementGroup = <Key extends string>(groups: Array<{ key: Key; count: number; amount: string }>, key: Key) => groups.flatMap((group) => {
    if (group.key !== key) return [group];
    const count = group.count - 1;
    return count > 0 ? [{ ...group, count, amount: subtractAmount(group.amount, current.amount) }] : [];
  });
  return {
    ...report,
    items: report.items.map((item) => item.id === resolution.id ? {
      ...item,
      status: resolution.status,
      resolvedAt: resolution.resolvedAt,
      resolvedBy: resolution.resolvedBy,
      resolutionNote: resolution.resolutionNote,
    } : item),
    summary: {
      open: {
        count: Math.max(0, report.summary.open.count - 1),
        amount: subtractAmount(report.summary.open.amount, current.amount),
      },
      byCategory: decrementGroup(report.summary.byCategory, current.category),
      byDirection: decrementGroup(report.summary.byDirection, current.direction),
    },
  };
}

export function retryFiltersWithoutInvalidCursor(filters: DifferenceReportFilters, status: number, message: string) {
  if (!filters.cursor || status !== 400 || message !== "Cursor inválido para os filtros aplicados.") return null;
  const { cursor: _cursor, ...withoutCursor } = filters;
  return withoutCursor;
}
