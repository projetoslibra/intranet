import assert from "node:assert/strict";
import test from "node:test";
import { parseDateOnly, saoPauloDayRange } from "./consignado-date";

test("converte uma data bancária para DATE em UTC", () => {
  assert.equal(parseDateOnly("2026-08-18").toISOString(), "2026-08-18T00:00:00.000Z");
});

test("rejeita formato ou data inexistente", () => {
  assert.throws(() => parseDateOnly("18/08/2026"), /Data inválida/);
  assert.throws(() => parseDateOnly("2026-02-30"), /Data inválida/);
});

test("cria a faixa UTC correspondente ao dia em São Paulo", () => {
  const range = saoPauloDayRange("2026-08-18");

  assert.equal(range.gte.toISOString(), "2026-08-18T03:00:00.000Z");
  assert.equal(range.lt.toISOString(), "2026-08-19T03:00:00.000Z");
});
