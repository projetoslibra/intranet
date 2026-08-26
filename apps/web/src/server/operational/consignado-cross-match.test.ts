import assert from "node:assert/strict";
import test from "node:test";
import { buildCrossMatchSuggestions, type CrossMatchItem, type CrossMatchPosition } from "./consignado-cross-match";

function item(overrides: Partial<CrossMatchItem> = {}): CrossMatchItem {
  return { id: "item-1", sourceRow: 1, debtorName: "MARIANA ALVES SILVA SIMOES", debtorDocument: "37335957850", dueDate: new Date("2026-08-23T00:00:00.000Z"), titleAmount: 41.73, ...overrides };
}

function position(overrides: Partial<CrossMatchPosition> = {}): CrossMatchPosition {
  return { id: "pos-1", yourNumber: "463283", documentNumber: "1", debtorName: "MARIANA ALVES SILVA SIMOES", debtorDocument: "373.359.578-50", cedentName: "BMP SOCIEDADE DE CREDITO DIRETO S.A", nominalValue: 41.73, dueDate: new Date("2026-08-23T00:00:00.000Z"), ...overrides };
}

test("casa cpf formatado no estoque com cpf sem pontuacao do arquivo", () => {
  const result = buildCrossMatchSuggestions({ source: "BMP", items: [item()], positions: [position()] });
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].positionId, "pos-1");
  assert.equal(result.suggestions[0].group, "FULL_KEY");
  assert.deepEqual(result.suggestions[0].matchedOn, ["debtorDocument", "nominalValue", "dueDate"]);
  assert.deepEqual(result.unmatchedItemIds, []);
});

test("casa por nome normalizado quando falta documento dos dois lados", () => {
  const result = buildCrossMatchSuggestions({
    source: "BMP",
    items: [item({ debtorDocument: null, debtorName: "  joão   da SILVA " })],
    positions: [position({ debtorDocument: "", debtorName: "JOAO DA SILVA" })],
  });
  assert.equal(result.suggestions.length, 1);
  assert.deepEqual(result.suggestions[0].matchedOn, ["debtorName", "nominalValue", "dueDate"]);
});

test("documento diferente reprova o par mesmo com nome identico", () => {
  const result = buildCrossMatchSuggestions({
    source: "BMP",
    items: [item({ debtorDocument: "11111111111" })],
    positions: [position({ debtorDocument: "222.222.222-22" })],
  });
  assert.deepEqual(result.suggestions, []);
  assert.deepEqual(result.unmatchedItemIds, ["item-1"]);
});

test("sem vencimento exato escolhe a parcela mais antiga e marca um mes de intervalo", () => {
  const result = buildCrossMatchSuggestions({
    source: "BMP",
    items: [item({ dueDate: new Date("2026-06-23T00:00:00.000Z"), titleAmount: 18.56 })],
    positions: [
      position({ id: "pos-set", documentNumber: "3", nominalValue: 18.56, dueDate: new Date("2026-09-23T00:00:00.000Z") }),
      position({ id: "pos-jul", documentNumber: "1", nominalValue: 18.56, dueDate: new Date("2026-07-23T00:00:00.000Z") }),
      position({ id: "pos-ago", documentNumber: "2", nominalValue: 18.56, dueDate: new Date("2026-08-23T00:00:00.000Z") }),
    ],
  });
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].positionId, "pos-jul");
  assert.equal(result.suggestions[0].group, "OLDEST_NEXT_MONTH");
  assert.equal(result.suggestions[0].stockDueDate, "2026-07-23");
  assert.equal(result.suggestions[0].fileDueDate, "2026-06-23");
});

test("intervalo diferente de um mes cai no grupo de revisao individual", () => {
  const result = buildCrossMatchSuggestions({
    source: "BMP",
    items: [item({ dueDate: new Date("2026-06-23T00:00:00.000Z"), titleAmount: 22.4 })],
    positions: [position({ id: "pos-ago", nominalValue: 22.4, dueDate: new Date("2026-08-23T00:00:00.000Z") })],
  });
  assert.equal(result.suggestions[0].group, "OLDEST_WIDE_GAP");
});

test("dia inexistente no mes seguinte usa o ultimo dia do mes", () => {
  const result = buildCrossMatchSuggestions({
    source: "BMP",
    items: [item({ dueDate: new Date("2026-01-31T00:00:00.000Z") })],
    positions: [position({ dueDate: new Date("2026-02-28T00:00:00.000Z") })],
  });
  assert.equal(result.suggestions[0].group, "OLDEST_NEXT_MONTH");
});

test("posicao bloqueada nunca e sugerida", () => {
  const result = buildCrossMatchSuggestions({ source: "BMP", items: [item()], positions: [position()], blockedPositionIds: ["pos-1"] });
  assert.deepEqual(result.suggestions, []);
  assert.deepEqual(result.unmatchedItemIds, ["item-1"]);
});

test("arquivo bmp nao recebe sugestao de titulo de cedente uy3", () => {
  const result = buildCrossMatchSuggestions({ source: "BMP", items: [item()], positions: [position({ cedentName: "UY3 SOCIEDADE DE CREDITO DIRETO S.A" })] });
  assert.deepEqual(result.suggestions, []);
});

test("duas linhas equivalentes recebem uma posicao equivalente cada", () => {
  const result = buildCrossMatchSuggestions({
    source: "BMP",
    items: [
      item({ id: "item-185", sourceRow: 185, debtorName: "LIANE DA SILVA CHAGAS", debtorDocument: "99988877766", titleAmount: 41.8 }),
      item({ id: "item-373", sourceRow: 373, debtorName: "LIANE DA SILVA CHAGAS", debtorDocument: "99988877766", titleAmount: 41.8 }),
    ],
    positions: [
      position({ id: "pos-456206", yourNumber: "456206", debtorDocument: "999.888.777-66", debtorName: "LIANE DA SILVA CHAGAS", nominalValue: 41.8 }),
      position({ id: "pos-456197", yourNumber: "456197", debtorDocument: "999.888.777-66", debtorName: "LIANE DA SILVA CHAGAS", nominalValue: 41.8 }),
    ],
  });
  assert.equal(result.suggestions.length, 2);
  assert.deepEqual(result.suggestions.map((suggestion) => suggestion.positionId).sort(), ["pos-456197", "pos-456206"]);
  assert.deepEqual(result.unmatchedItemIds, []);
});

test("item que perde a posicao exata nao cai para a parcela mais antiga", () => {
  const result = buildCrossMatchSuggestions({
    source: "BMP",
    items: [item({ id: "item-a", sourceRow: 1 }), item({ id: "item-b", sourceRow: 2 })],
    positions: [position({ id: "pos-exata" }), position({ id: "pos-futura", documentNumber: "2", dueDate: new Date("2026-09-23T00:00:00.000Z") })],
  });
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].itemId, "item-a");
  assert.equal(result.suggestions[0].positionId, "pos-exata");
  assert.deepEqual(result.unmatchedItemIds, ["item-b"]);
});

test("item sem candidato fica sem sugestao", () => {
  const result = buildCrossMatchSuggestions({ source: "BMP", items: [item({ titleAmount: 999.99 })], positions: [position()] });
  assert.deepEqual(result.suggestions, []);
  assert.deepEqual(result.unmatchedItemIds, ["item-1"]);
});

test("a mesma entrada produz sempre a mesma saida", () => {
  const input = {
    source: "BMP" as const,
    items: [item({ id: "item-a", sourceRow: 2 }), item({ id: "item-b", sourceRow: 1 })],
    positions: [position({ id: "pos-x", documentNumber: "2" }), position({ id: "pos-y", documentNumber: "1" })],
  };
  const output = buildCrossMatchSuggestions(input);
  assert.deepEqual(buildCrossMatchSuggestions(input), output);
  assert.equal(output.suggestions.find((entry) => entry.itemId === "item-b")?.positionId, "pos-y");
  assert.equal(output.suggestions.find((entry) => entry.itemId === "item-a")?.positionId, "pos-x");
});
