type SelectableStockTitle = {
  id: string;
};

type StockTitleValue = {
  nominalValue: number;
  pddValue: number;
};

export function toggleAllVisibleTitleIds(
  visibleTitles: SelectableStockTitle[],
  selectedTitleIds: Set<string>,
  unavailableTitleIds: Set<string>
) {
  const availableTitleIds = visibleTitles
    .filter((title) => !unavailableTitleIds.has(title.id))
    .map((title) => title.id);
  const allAvailableSelected =
    availableTitleIds.length > 0 &&
    availableTitleIds.every((titleId) => selectedTitleIds.has(titleId));

  return allAvailableSelected ? new Set<string>() : new Set(availableTitleIds);
}

export function selectionTotals(
  selectedTitles: StockTitleValue[],
  pddVariation: number
) {
  return selectedTitles.reduce(
    (totals, title) => ({
      ...totals,
      riskTotal: totals.riskTotal + title.nominalValue,
      pddTotal: totals.pddTotal + title.pddValue,
    }),
    {
      titleCount: selectedTitles.length,
      riskTotal: 0,
      pddTotal: 0,
      pddVariation,
    }
  );
}
