import assert from "node:assert/strict";
import test from "node:test";
import {
  selectionTotals,
  toggleAllVisibleTitleIds,
} from "./stock-title-selection";

const titles = [
  { id: "title-1", nominalValue: 100, pddValue: 25 },
  { id: "title-2", nominalValue: 250.5, pddValue: 62.63 },
  { id: "title-3", nominalValue: 80, pddValue: 20 },
];

test("selecionar todos inclui somente os titulos visiveis disponiveis", () => {
  const selectedIds = toggleAllVisibleTitleIds(
    titles,
    new Set(["title-1"]),
    new Set(["title-3"])
  );

  assert.deepEqual([...selectedIds], ["title-1", "title-2"]);
});

test("selecionar todos desmarca a lista quando todos os disponiveis ja estao selecionados", () => {
  const selectedIds = toggleAllVisibleTitleIds(
    titles,
    new Set(["title-1", "title-2"]),
    new Set(["title-3"])
  );

  assert.deepEqual([...selectedIds], []);
});

test("resume risco total, valor total PDD e variacao da selecao", () => {
  const totals = selectionTotals(titles.slice(0, 2), -87.63);

  assert.deepEqual(totals, {
    titleCount: 2,
    riskTotal: 350.5,
    pddTotal: 87.63,
    pddVariation: -87.63,
  });
});
