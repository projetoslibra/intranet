export type CrossMatchGroup = "FULL_KEY" | "OLDEST_NEXT_MONTH" | "OLDEST_WIDE_GAP";
export type CrossMatchField = "debtorDocument" | "debtorName" | "nominalValue" | "dueDate";

export type CrossMatchItem = {
  id: string;
  sourceRow: number;
  debtorName: string | null;
  debtorDocument: string | null;
  dueDate: Date | null;
  titleAmount: number;
};

export type CrossMatchPosition = {
  id: string;
  yourNumber: string | null;
  documentNumber: string | null;
  debtorName: string;
  debtorDocument: string;
  cedentName: string;
  nominalValue: number;
  dueDate: Date | null;
};

export type CrossMatchSuggestion = {
  itemId: string;
  positionId: string;
  group: CrossMatchGroup;
  matchedOn: CrossMatchField[];
  fileDueDate: string | null;
  stockDueDate: string | null;
  poolSize: number;
};

function digits(value: unknown) { return String(value ?? "").replace(/\D/g, ""); }
function normalized(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase().replace(/\s+/g, " ");
}
function sameMoney(left: number, right: number) { return Math.abs(left - right) < 0.01; }
function dayKey(value: Date | null) { return value ? value.toISOString().slice(0, 10) : null; }
function parcel(value: string | null) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function cedentMatchesSource(source: "BMP" | "UY3", cedentName: string) {
  const cedent = normalized(cedentName);
  return source === "UY3" ? cedent.includes("UY3") : cedent.includes("BMP") || cedent.includes("MONEY PLUS");
}

function debtorField(item: CrossMatchItem, position: CrossMatchPosition): CrossMatchField | null {
  const itemDocument = digits(item.debtorDocument);
  const positionDocument = digits(position.debtorDocument);
  if (itemDocument && positionDocument) return itemDocument === positionDocument ? "debtorDocument" : null;
  const itemName = normalized(item.debtorName);
  return itemName && itemName === normalized(position.debtorName) ? "debtorName" : null;
}

function isNextMonth(fileDue: Date, stockDue: Date) {
  const year = fileDue.getUTCFullYear();
  const month = fileDue.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  const expected = new Date(Date.UTC(year, month + 1, Math.min(fileDue.getUTCDate(), lastDay)));
  return dayKey(expected) === dayKey(stockDue);
}

function byStableOrder(left: CrossMatchPosition, right: CrossMatchPosition) {
  return parcel(left.documentNumber) - parcel(right.documentNumber)
    || String(left.yourNumber ?? "").localeCompare(String(right.yourNumber ?? ""))
    || left.id.localeCompare(right.id);
}

function byDueDateThenStable(left: CrossMatchPosition, right: CrossMatchPosition) {
  const leftDue = dayKey(left.dueDate) ?? "9999-12-31";
  const rightDue = dayKey(right.dueDate) ?? "9999-12-31";
  return leftDue.localeCompare(rightDue) || byStableOrder(left, right);
}

export function buildCrossMatchSuggestions(input: {
  source: "BMP" | "UY3";
  items: CrossMatchItem[];
  positions: CrossMatchPosition[];
  blockedPositionIds?: Iterable<string>;
}): { suggestions: CrossMatchSuggestion[]; unmatchedItemIds: string[] } {
  const blocked = new Set(input.blockedPositionIds ?? []);
  const available = input.positions.filter((position) => !blocked.has(position.id) && cedentMatchesSource(input.source, position.cedentName));
  const items = [...input.items].sort((left, right) => left.sourceRow - right.sourceRow || left.id.localeCompare(right.id));

  const pools = new Map<string, { field: CrossMatchField; position: CrossMatchPosition }[]>();
  items.forEach((entry) => {
    pools.set(entry.id, available.flatMap((position) => {
      const field = debtorField(entry, position);
      if (!field || !sameMoney(position.nominalValue, entry.titleAmount)) return [];
      return [{ field, position }];
    }));
  });

  const consumed = new Set<string>();
  const suggestions: CrossMatchSuggestion[] = [];
  const unmatchedItemIds: string[] = [];
  const settled = new Set<string>();

  items.forEach((entry) => {
    const fileDueDate = dayKey(entry.dueDate);
    const exact = (pools.get(entry.id) ?? []).filter(({ position }) => fileDueDate !== null && dayKey(position.dueDate) === fileDueDate);
    if (!exact.length) return;
    settled.add(entry.id);
    const free = exact.filter(({ position }) => !consumed.has(position.id)).sort((left, right) => byStableOrder(left.position, right.position));
    const chosen = free[0];
    if (!chosen) { unmatchedItemIds.push(entry.id); return; }
    consumed.add(chosen.position.id);
    suggestions.push({
      itemId: entry.id, positionId: chosen.position.id, group: "FULL_KEY",
      matchedOn: [chosen.field, "nominalValue", "dueDate"],
      fileDueDate, stockDueDate: dayKey(chosen.position.dueDate), poolSize: exact.length,
    });
  });

  items.forEach((entry) => {
    if (settled.has(entry.id)) return;
    const pool = (pools.get(entry.id) ?? []).filter(({ position }) => !consumed.has(position.id)).sort((left, right) => byDueDateThenStable(left.position, right.position));
    const chosen = pool[0];
    if (!chosen) { unmatchedItemIds.push(entry.id); return; }
    consumed.add(chosen.position.id);
    const nextMonth = Boolean(entry.dueDate && chosen.position.dueDate && isNextMonth(entry.dueDate, chosen.position.dueDate));
    suggestions.push({
      itemId: entry.id, positionId: chosen.position.id,
      group: nextMonth ? "OLDEST_NEXT_MONTH" : "OLDEST_WIDE_GAP",
      matchedOn: [chosen.field, "nominalValue"],
      fileDueDate: dayKey(entry.dueDate), stockDueDate: dayKey(chosen.position.dueDate), poolSize: pool.length,
    });
  });

  return {
    suggestions: suggestions.sort((left, right) => left.itemId.localeCompare(right.itemId)),
    unmatchedItemIds: unmatchedItemIds.sort(),
  };
}
