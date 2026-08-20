import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRemittanceExclusions,
  classifyRemittanceExclusion,
  type RemittanceExclusionItem,
} from "./consignado-remittance-exclusions";

function item(overrides: Partial<RemittanceExclusionItem> = {}): RemittanceExclusionItem {
  return {
    id: "item-1",
    status: "DIVERGENT",
    matchedStockPositionId: "stock-1",
    approved: true,
    exclusionReason: null,
    statusReason: null,
    paidAmount: "50.00",
    titleAmount: "60.00",
    ...overrides,
  };
}

function serializable(rows: ReturnType<typeof buildRemittanceExclusions>) {
  return rows.map((row) => ({ ...row, paidAmount: row.paidAmount.toString(), titleAmount: row.titleAmount.toString() }));
}

test("prioriza recuperação PDD para título fora da remessa", () => {
  assert.equal(classifyRemittanceExclusion(item({
    status: "PDD_RECOVERY",
    matchedStockPositionId: null,
    statusReason: "Título não encontrado no estoque ativo.",
    exclusionReason: "Excluído pelo operador.",
    approved: false,
  })), "PDD_RECOVERY");
});

test("classifica revisão PDD como recuperação PDD", () => {
  assert.equal(classifyRemittanceExclusion(item({ status: "PDD_REVIEW" })), "PDD_RECOVERY");
});

test("classifica como não encontrado o título sem posição no estoque", () => {
  assert.equal(classifyRemittanceExclusion(item({
    matchedStockPositionId: null,
    statusReason: "Título não encontrado no estoque ativo.",
    approved: false,
  })), "NOT_FOUND_IN_STOCK");
});

test("classifica exclusão com motivo do operador", () => {
  assert.equal(classifyRemittanceExclusion(item({
    exclusionReason: "Duplicidade confirmada pelo operador.",
    approved: false,
  })), "OPERATOR_EXCLUDED");
});

test("classifica título não aprovado sem exclusão explícita", () => {
  assert.equal(classifyRemittanceExclusion(item({ approved: false })), "NOT_APPROVED");
});

test("usa outra divergência como fallback", () => {
  assert.equal(classifyRemittanceExclusion(item()), "OTHER_DIVERGENCE");
});

test("registra como não encontrado o item sem posição que ficou fora da remessa", () => {
  const rows = buildRemittanceExclusions("r1", [
    item({ id: "i1", matchedStockPositionId: null, statusReason: "Título não encontrado no estoque ativo.", paidAmount: "54.31", titleAmount: "60.00" }),
  ], new Set());

  assert.deepEqual(serializable(rows), [{
    remittanceId: "r1",
    settlementItemId: "i1",
    category: "NOT_FOUND_IN_STOCK",
    reason: "Título não encontrado no estoque ativo.",
    paidAmount: "54.31",
    titleAmount: "60.00",
  }]);
});

test("não registra itens incluídos e preserva motivo explícito ou padrão", () => {
  const rows = buildRemittanceExclusions("r1", [
    item({ id: "included", exclusionReason: "Excluído pelo operador." }),
    item({ id: "explicit", exclusionReason: "Aguardando documentação." }),
    item({ id: "default", approved: false }),
  ], new Set(["included"]));

  assert.deepEqual(serializable(rows), [
    {
      remittanceId: "r1",
      settlementItemId: "explicit",
      category: "OPERATOR_EXCLUDED",
      reason: "Aguardando documentação.",
      paidAmount: "50.00",
      titleAmount: "60.00",
    },
    {
      remittanceId: "r1",
      settlementItemId: "default",
      category: "NOT_APPROVED",
      reason: "Não incluído na remessa.",
      paidAmount: "50.00",
      titleAmount: "60.00",
    },
  ]);
});
