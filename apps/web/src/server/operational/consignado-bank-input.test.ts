import assert from "node:assert/strict";
import test from "node:test";
import * as bankInputModule from "./consignado-bank-input";

const validPayload = {
  entryIds: ["entry-1"],
  remittanceIds: ["remittance-1"],
  exclusionIds: ["exclusion-1"],
  otherDifferences: [{
    category: "VALUE_DIFFERENCE",
    amount: "10.25",
    reason: "Crédito complementar",
  }],
  note: "Conciliação conferida",
};

type ReconciliationInputSchema = {
  parse(input: unknown): typeof validPayload;
  safeParse(input: unknown): { success: boolean };
};

const reconciliationInputSchema = (bankInputModule as unknown as {
  bankReconciliationInputSchema?: ReconciliationInputSchema;
}).bankReconciliationInputSchema;

test("aceita o payload completo da conciliação", () => {
  assert.ok(reconciliationInputSchema, "bankReconciliationInputSchema ainda não foi implementado");
  assert.deepEqual(reconciliationInputSchema.parse(validPayload), validPayload);
});

test("rejeita valores não positivos ou com fração de centavo", () => {
  assert.ok(reconciliationInputSchema, "bankReconciliationInputSchema ainda não foi implementado");

  for (const amount of ["0", "-1.00", "1.001"]) {
    assert.equal(reconciliationInputSchema.safeParse({
      ...validPayload,
      otherDifferences: [{ ...validPayload.otherDifferences[0], amount }],
    }).success, false, `amount ${amount} deveria ser rejeitado`);
  }
});

test("aceita o limite de Decimal(24,2) e rejeita overflow inteiro", () => {
  assert.ok(reconciliationInputSchema, "bankReconciliationInputSchema ainda não foi implementado");

  assert.equal(reconciliationInputSchema.safeParse({
    ...validPayload,
    otherDifferences: [{
      ...validPayload.otherDifferences[0],
      amount: "9999999999999999999999.99",
    }],
  }).success, true);
  assert.equal(reconciliationInputSchema.safeParse({
    ...validPayload,
    otherDifferences: [{
      ...validPayload.otherDifferences[0],
      amount: "10000000000000000000000.00",
    }],
  }).success, false);
});

test("rejeita justificativa de outro ajuste com menos de cinco caracteres", () => {
  assert.ok(reconciliationInputSchema, "bankReconciliationInputSchema ainda não foi implementado");
  assert.equal(reconciliationInputSchema.safeParse({
    ...validPayload,
    otherDifferences: [{ ...validPayload.otherDifferences[0], reason: " curt " }],
  }).success, false);
});

test("rejeita categoria de outro ajuste fora da enumeração", () => {
  assert.ok(reconciliationInputSchema, "bankReconciliationInputSchema ainda não foi implementado");
  assert.equal(reconciliationInputSchema.safeParse({
    ...validPayload,
    otherDifferences: [{ ...validPayload.otherDifferences[0], category: "INVALID" }],
  }).success, false);
});

type NormalizeSelection = (input: {
  entryIds: string[];
  remittanceIds: string[];
  exclusionIds: string[];
}) => {
  entryIds: string[];
  remittanceIds: string[];
  exclusionIds: string[];
};

const normalizeBankReconciliationSelection = (bankInputModule as unknown as {
  normalizeBankReconciliationSelection?: NormalizeSelection;
}).normalizeBankReconciliationSelection;

test("deduplica os IDs selecionados antes da transação", () => {
  assert.ok(normalizeBankReconciliationSelection, "normalizeBankReconciliationSelection ainda não foi implementada");
  assert.deepEqual(normalizeBankReconciliationSelection({
    entryIds: ["entry-1", "entry-1", "entry-2"],
    remittanceIds: ["remittance-1", "remittance-1"],
    exclusionIds: ["exclusion-1", "exclusion-2", "exclusion-1"],
  }), {
    entryIds: ["entry-1", "entry-2"],
    remittanceIds: ["remittance-1"],
    exclusionIds: ["exclusion-1", "exclusion-2"],
  });
});

type AssertRecordsAvailable = (input: {
  fundId: string;
  entryIds: string[];
  remittanceIds: string[];
  exclusionIds: string[];
  entries: Array<{ id: string; fundId: string; status: string }>;
  remittances: Array<{
    id: string;
    fundId: string;
    status: string;
    batch: { status: string };
  }>;
  exclusions: Array<{
    id: string;
    remittanceId: string;
    remittance: { fundId: string; status: string; batch: { status: string } };
    differenceTitles: unknown[];
  }>;
}) => void;

const assertBankReconciliationRecordsAvailable = (bankInputModule as unknown as {
  assertBankReconciliationRecordsAvailable?: AssertRecordsAvailable;
}).assertBankReconciliationRecordsAvailable;

function loadedSelection() {
  return {
    fundId: "fund-1",
    entryIds: ["entry-1"],
    remittanceIds: ["remittance-1"],
    exclusionIds: ["exclusion-1"],
    entries: [{ id: "entry-1", fundId: "fund-1", status: "PENDING" }],
    remittances: [{
      id: "remittance-1",
      fundId: "fund-1",
      status: "GENERATED",
      batch: { status: "GENERATED" },
    }],
    exclusions: [{
      id: "exclusion-1",
      remittanceId: "remittance-1",
      remittance: {
        fundId: "fund-1",
        status: "GENERATED",
        batch: { status: "GENERATED" },
      },
      differenceTitles: [],
    }],
  };
}

test("aceita snapshots recarregados e disponíveis do mesmo fundo", () => {
  assert.ok(assertBankReconciliationRecordsAvailable, "assertBankReconciliationRecordsAvailable ainda não foi implementada");
  assert.doesNotThrow(() => assertBankReconciliationRecordsAvailable(loadedSelection()));
});

test("rejeita seleção alterada ou pertencente a outro fundo", () => {
  assert.ok(assertBankReconciliationRecordsAvailable, "assertBankReconciliationRecordsAvailable ainda não foi implementada");

  assert.throws(() => assertBankReconciliationRecordsAvailable({
    ...loadedSelection(),
    entries: [],
  }), /alterado.*Atualize a tela/i);

  assert.throws(() => assertBankReconciliationRecordsAvailable({
    ...loadedSelection(),
    entries: [{ id: "entry-1", fundId: "fund-2", status: "PENDING" }],
  }), /alterado.*Atualize a tela/i);
});

test("rejeita exclusão inexistente ou de remessa não selecionada", () => {
  assert.ok(assertBankReconciliationRecordsAvailable, "assertBankReconciliationRecordsAvailable ainda não foi implementada");

  assert.throws(() => assertBankReconciliationRecordsAvailable({
    ...loadedSelection(),
    exclusions: [],
  }), /título.*alterado.*Atualize a tela/i);

  assert.throws(() => assertBankReconciliationRecordsAvailable({
    ...loadedSelection(),
    exclusions: [{
      ...loadedSelection().exclusions[0],
      remittanceId: "remittance-2",
    }],
  }), /remessa não selecionada/i);
});

test("rejeita exclusão de remessa ou lote cancelado", () => {
  assert.ok(assertBankReconciliationRecordsAvailable, "assertBankReconciliationRecordsAvailable ainda não foi implementada");

  for (const remittance of [
    { ...loadedSelection().exclusions[0].remittance, status: "CANCELLED" },
    {
      ...loadedSelection().exclusions[0].remittance,
      batch: { status: "CANCELLED" },
    },
  ]) {
    assert.throws(() => assertBankReconciliationRecordsAvailable({
      ...loadedSelection(),
      exclusions: [{ ...loadedSelection().exclusions[0], remittance }],
    }), /remessa ou lote cancelado/i);
  }
});

test("rejeita exclusão já vinculada a conciliação ativa", () => {
  assert.ok(assertBankReconciliationRecordsAvailable, "assertBankReconciliationRecordsAvailable ainda não foi implementada");
  assert.throws(() => assertBankReconciliationRecordsAvailable({
    ...loadedSelection(),
    exclusions: [{
      ...loadedSelection().exclusions[0],
      differenceTitles: [{ reconciliationId: "reconciliation-active" }],
    }],
  }), /já foi usado em outra conciliação ativa/i);
});
