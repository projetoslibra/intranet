import assert from "node:assert/strict";
import test from "node:test";
import {
  composeDifferenceState,
  type EligibleExclusion,
  type OtherDifferenceDraft,
} from "./consignado-difference-composer";

const exclusion: EligibleExclusion = {
  id: "exclusion-1",
  remittanceId: "remittance-1",
  remittanceFileName: "remessa.rem",
  batchFileName: "baixa.csv",
  contractNumber: "94608325001",
  debtorName: "Maria da Silva",
  debtorDocument: "12345678901",
  dueDate: "2026-08-20T00:00:00.000Z",
  titleAmount: "90.00",
  paidAmount: "85.00",
  category: "NOT_FOUND_IN_STOCK",
  reason: "Título não encontrado no estoque ativo.",
};

const completeOther: OtherDifferenceDraft = {
  category: "VALUE_DIFFERENCE",
  amount: "15.00",
  reason: "Crédito complementar não identificado",
};

test("mantém visível o saldo ainda não explicado após seleção parcial", () => {
  const state = composeDifferenceState({
    difference: 100,
    direction: "ENTRY_EXCESS",
    exclusions: [exclusion],
    selectedIds: [exclusion.id],
    otherDifferences: [],
  });

  assert.equal(state.titleTotal, 85);
  assert.equal(state.otherTotal, 0);
  assert.equal(state.unexplained, 15);
  assert.equal(state.canSubmit, false);
});

test("libera a conclusão quando Outro fecha exatamente o saldo restante", () => {
  const state = composeDifferenceState({
    difference: 100,
    direction: "ENTRY_EXCESS",
    exclusions: [exclusion],
    selectedIds: [exclusion.id],
    otherDifferences: [completeOther],
  });

  assert.equal(state.otherTotal, 15);
  assert.equal(state.unexplained, 0);
  assert.equal(state.hasIncompleteOtherDifference, false);
  assert.equal(state.canSubmit, true);
});

test("bloqueia ajuste Outro matematicamente suficiente mas incompleto", () => {
  const state = composeDifferenceState({
    difference: 15,
    direction: "ENTRY_EXCESS",
    exclusions: [],
    selectedIds: [],
    otherDifferences: [{ category: "", amount: "15.00", reason: "curt" }],
  });

  assert.equal(state.unexplained, 0);
  assert.equal(state.hasIncompleteOtherDifference, true);
  assert.equal(state.canSubmit, false);
});

test("bloqueia qualquer título selecionado quando a remessa excede a entrada", () => {
  const state = composeDifferenceState({
    difference: 85,
    direction: "REMITTANCE_EXCESS",
    exclusions: [exclusion],
    selectedIds: [exclusion.id],
    otherDifferences: [],
  });

  assert.equal(state.hasDisallowedTitles, true);
  assert.equal(state.canSubmit, false);
});

test("bloqueia título cujo valor integral supera a diferença", () => {
  const state = composeDifferenceState({
    difference: 80,
    direction: "ENTRY_EXCESS",
    exclusions: [exclusion],
    selectedIds: [exclusion.id],
    otherDifferences: [],
  });

  assert.equal(state.hasTitleOverflow, true);
  assert.equal(state.canSubmit, false);
});
