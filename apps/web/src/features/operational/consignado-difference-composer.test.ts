import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateDifferenceSelection,
  centsToDecimalAmount,
  composeDifferenceState,
  decimalAmountToCents,
  formatCentsAsBRL,
  normalizeOtherDifferencesForPayload,
  normalizePtBrMoneyInput,
  recoverDifferenceCompositionAfterRejection,
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

test("remove a exclusão stale e fecha o compositor depois de POST rejeitado", () => {
  const state = recoverDifferenceCompositionAfterRejection({
    selectedIds: ["exclusion-stale"],
    otherDifferences: [completeOther],
    showComposer: true,
  });

  assert.deepEqual(state, {
    selectedIds: [],
    otherDifferences: [],
    showComposer: false,
  });
});

test("preserva um centavo no limite seguro e acima dele", () => {
  assert.equal(decimalAmountToCents("90071992547409.91"), BigInt("9007199254740991"));
  assert.equal(decimalAmountToCents("90071992547409.92"), BigInt("9007199254740992"));
  assert.equal(centsToDecimalAmount(BigInt("9007199254740992")), "90071992547409.92");
  assert.equal(formatCentsAsBRL(BigInt("9007199254740992")), "R$\u00a090.071.992.547.409,92");
});

test("calcula diferença de um centavo sem converter snapshots do workspace para Number", () => {
  const selection = calculateDifferenceSelection({
    entries: [{ amount: "90071992547409.91", allocatedAmount: "0.00", adjustedAmount: "0.00" }],
    remittances: [{ amount: "90071992547409.90", allocatedAmount: "0.00", adjustedAmount: "0.00" }],
  });

  assert.deepEqual(selection, {
    entryTotalCents: BigInt("9007199254740991"),
    remittanceTotalCents: BigInt("9007199254740990"),
    differenceCents: BigInt(1),
    difference: "0.01",
    direction: "ENTRY_EXCESS",
  });
});

test("normaliza valores monetários pt-BR para o payload canônico", () => {
  const cases = [
    ["15,00", "15.00"],
    ["1.234,56", "1234.56"],
    ["1.234,5", "1234.50"],
    ["15,5", "15.50"],
    ["1234.56", "1234.56"],
    ["R$\u00a01.234,56", "1234.56"],
  ] as const;

  for (const [input, expected] of cases) {
    assert.equal(normalizePtBrMoneyInput(input), expected, input);
  }
  assert.deepEqual(normalizeOtherDifferencesForPayload([{ ...completeOther, amount: "1.234,56" }]), [{
    ...completeOther,
    amount: "1234.56",
  }]);
});

test("rejeita entradas monetárias ambíguas ou além de centavos", () => {
  for (const input of ["15,", "1,234.56", "12.34,56", "1.234,567", "1.234.56", "-1,00", "abc", ""]) {
    assert.equal(normalizePtBrMoneyInput(input), null, input);
  }
});

test("fecha a composição com Outro digitado em pt-BR", () => {
  const state = composeDifferenceState({
    difference: "1234.56",
    direction: "ENTRY_EXCESS",
    exclusions: [],
    selectedIds: [],
    otherDifferences: [{ ...completeOther, amount: "1.234,56" }],
  });

  assert.equal(state.otherTotal, "1234.56");
  assert.equal(state.unexplained, "0.00");
  assert.equal(state.canSubmit, true);
});

test("mantém visível o saldo ainda não explicado após seleção parcial", () => {
  const state = composeDifferenceState({
    difference: "100.00",
    direction: "ENTRY_EXCESS",
    exclusions: [exclusion],
    selectedIds: [exclusion.id],
    otherDifferences: [],
  });

  assert.equal(state.titleTotal, "85.00");
  assert.equal(state.otherTotal, "0.00");
  assert.equal(state.unexplained, "15.00");
  assert.equal(state.canSubmit, false);
});

test("libera a conclusão quando Outro fecha exatamente o saldo restante", () => {
  const state = composeDifferenceState({
    difference: "100.00",
    direction: "ENTRY_EXCESS",
    exclusions: [exclusion],
    selectedIds: [exclusion.id],
    otherDifferences: [completeOther],
  });

  assert.equal(state.otherTotal, "15.00");
  assert.equal(state.unexplained, "0.00");
  assert.equal(state.hasIncompleteOtherDifference, false);
  assert.equal(state.canSubmit, true);
});

test("bloqueia ajuste Outro matematicamente suficiente mas incompleto", () => {
  const state = composeDifferenceState({
    difference: "15.00",
    direction: "ENTRY_EXCESS",
    exclusions: [],
    selectedIds: [],
    otherDifferences: [{ category: "", amount: "15.00", reason: "curt" }],
  });

  assert.equal(state.unexplained, "0.00");
  assert.equal(state.hasIncompleteOtherDifference, true);
  assert.equal(state.canSubmit, false);
});

test("bloqueia qualquer título selecionado quando a remessa excede a entrada", () => {
  const state = composeDifferenceState({
    difference: "85.00",
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
    difference: "80.00",
    direction: "ENTRY_EXCESS",
    exclusions: [exclusion],
    selectedIds: [exclusion.id],
    otherDifferences: [],
  });

  assert.equal(state.hasTitleOverflow, true);
  assert.equal(state.canSubmit, false);
});

test("fecha diferença acima do limite seguro com o valor integral do título", () => {
  const state = composeDifferenceState({
    difference: "90071992547409.92",
    direction: "ENTRY_EXCESS",
    exclusions: [{ ...exclusion, id: "exclusion-large", paidAmount: "90071992547409.92" }],
    selectedIds: ["exclusion-large"],
    otherDifferences: [],
  });

  assert.equal(state.titleTotal, "90071992547409.92");
  assert.equal(state.unexplained, "0.00");
  assert.equal(state.canSubmit, true);
});
