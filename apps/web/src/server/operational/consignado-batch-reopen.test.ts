import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTO_EXCLUSION_REASON,
  assertBatchReopenAllowed,
  resolveRestoredStatus,
  selectReopenableItems,
  type ReopenableItem,
} from "./consignado-batch-reopen";

function item(overrides: Partial<ReopenableItem> = {}): ReopenableItem {
  return { id: "item-1", status: "EXCLUDED", exclusionReason: AUTO_EXCLUSION_REASON, matchedStockPositionId: null, ...overrides };
}

test("seleciona apenas os titulos excluidos pela geracao da remessa", () => {
  const selected = selectReopenableItems([
    item({ id: "auto" }),
    item({ id: "manual", exclusionReason: "Sacado contestou a cobranca." }),
    item({ id: "sem-motivo", exclusionReason: null }),
    item({ id: "ainda-em-revisao", status: "NOT_FOUND", exclusionReason: null }),
    item({ id: "aprovado", status: "FULL_MATCH", exclusionReason: null }),
  ]);
  assert.deepEqual(selected.map((entry) => entry.id), ["auto"]);
});

test("nao desfaz o seguir sem este titulo mesmo com texto parecido", () => {
  const selected = selectReopenableItems([item({ id: "manual", exclusionReason: "Excluído pelo operador." })]);
  assert.deepEqual(selected, []);
});

test("restaura o status gravado no evento da geracao", () => {
  assert.equal(resolveRestoredStatus({ recordedFromStatus: "AMBIGUOUS", matchedStockPositionId: null }), "AMBIGUOUS");
  assert.equal(resolveRestoredStatus({ recordedFromStatus: "PDD_REVIEW", matchedStockPositionId: null }), "PDD_REVIEW");
});

test("titulo ja baixado via OSHER volta como DUPLICATE e nao perde a trava", () => {
  assert.equal(resolveRestoredStatus({ recordedFromStatus: "DUPLICATE", matchedStockPositionId: null }), "DUPLICATE");
});

test("lote antigo sem evento cai para NOT_FOUND quando nao tem titulo casado", () => {
  assert.equal(resolveRestoredStatus({ recordedFromStatus: null, matchedStockPositionId: null }), "NOT_FOUND");
  assert.equal(resolveRestoredStatus({ matchedStockPositionId: null }), "NOT_FOUND");
});

test("lote antigo sem evento cai para DIVERGENT quando tem titulo casado", () => {
  assert.equal(resolveRestoredStatus({ recordedFromStatus: null, matchedStockPositionId: "pos-1" }), "DIVERGENT");
});

test("status gravado invalido ou EXCLUDED nao e usado como restauracao", () => {
  assert.equal(resolveRestoredStatus({ recordedFromStatus: "EXCLUDED", matchedStockPositionId: "pos-1" }), "DIVERGENT");
  assert.equal(resolveRestoredStatus({ recordedFromStatus: "QUALQUER_COISA", matchedStockPositionId: null }), "NOT_FOUND");
});

test("recusa reabrir lote excluido da visualizacao", () => {
  assert.throws(() => assertBatchReopenAllowed({ batchStatus: "CANCELLED", reopenableItems: 3 }), /exclu[ií]do da visualiza/i);
});

test("recusa reabrir quando nao ha titulo excluido pela geracao", () => {
  assert.throws(() => assertBatchReopenAllowed({ batchStatus: "READY", reopenableItems: 0 }), /nenhum t[ií]tulo/i);
});

test("permite reabrir lote com remessa ativa, porque reabrir nao cancela remessa", () => {
  assert.doesNotThrow(() => assertBatchReopenAllowed({ batchStatus: "GENERATED", reopenableItems: 1 }));
  assert.doesNotThrow(() => assertBatchReopenAllowed({ batchStatus: "READY", reopenableItems: 1 }));
  assert.doesNotThrow(() => assertBatchReopenAllowed({ batchStatus: "RECONCILED", reopenableItems: 2 }));
});
