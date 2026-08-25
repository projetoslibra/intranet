import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSettlementWorkspaceQuery,
  normalizeSettlementWorkspaceFilters,
} from "./consignado-settlement-filters";

test("combina data e originador normalizado na consulta dos lotes", () => {
  const filters = normalizeSettlementWorkspaceFilters({
    createdDate: "2026-08-25",
    originator: " juca ",
  });

  assert.deepEqual(filters, {
    createdDate: "2026-08-25",
    originator: "JUCA",
  });
  assert.equal(
    buildSettlementWorkspaceQuery(filters),
    "?createdDate=2026-08-25&originator=JUCA",
  );
});

test("remove filtros vazios sem produzir query string", () => {
  const filters = normalizeSettlementWorkspaceFilters({
    createdDate: "",
    originator: " ",
  });

  assert.deepEqual(filters, {});
  assert.equal(buildSettlementWorkspaceQuery(filters), "");
});

test("rejeita originador que não pertence ao fluxo operacional", () => {
  assert.throws(
    () => normalizeSettlementWorkspaceFilters({ originator: "INVALIDO" }),
    /Originador inválido/,
  );
});
