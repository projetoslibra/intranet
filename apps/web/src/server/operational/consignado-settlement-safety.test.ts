import assert from "node:assert/strict";
import test from "node:test";
import { assertRemittanceCancellationAllowed, DuplicateSettlementFileError, findPreviouslyRemittedTitle, remittanceDownloadEligibility } from "./consignado-settlement-safety";

test("arquivo com o mesmo conteudo e nome diferente e bloqueado definitivamente", () => {
  const error = new DuplicateSettlementFileError({ batchId: "batch-1", fileName: "CB18081ECO.REM", processedAt: new Date("2026-08-18T15:52:00Z") });
  assert.equal(error.code, "DUPLICATE_SETTLEMENT_FILE");
  assert.match(error.message, /j[aá] foi processado/i);
  assert.match(error.message, /CB18081ECO\.REM/);
});

test("identifica titulo ja remetido pelo OSHER mesmo que tenha sumido do estoque", () => {
  const match = findPreviouslyRemittedTitle({ source: "BMP", originatorCode: "BANKERIZE", yourNumber: "95633055002", documentNumber: null, contractNumber: "95633055", installmentNumber: "002", debtorDocument: "50430313870", paidAmount: 365.54 }, [{ id: "item-old", source: "BMP", originatorCode: "BANKERIZE", yourNumber: "95633055002", documentNumber: null, contractNumber: "95633055", installmentNumber: "002", debtorDocument: "504.303.138-70", amount: 365.54, remittanceId: "rem-old", remittanceFileName: "BMP_BANKERIZE_20260818.REM", remittanceStatus: "RECONCILED", generatedAt: new Date("2026-08-18T15:53:00Z") }]);
  assert.equal(match?.remittanceId, "rem-old");
});

test("nao trata pagamento posterior com valor diferente como duplicado", () => {
  const match = findPreviouslyRemittedTitle({ source: "BMP", originatorCode: "BANKERIZE", yourNumber: "95633055002", documentNumber: null, contractNumber: "95633055", installmentNumber: "002", debtorDocument: "50430313870", paidAmount: 100 }, [{ id: "item-old", source: "BMP", originatorCode: "BANKERIZE", yourNumber: "95633055002", documentNumber: null, contractNumber: "95633055", installmentNumber: "002", debtorDocument: "50430313870", amount: 365.54, remittanceId: "rem-old", remittanceFileName: "old.REM", remittanceStatus: "RECONCILED", generatedAt: new Date() }]);
  assert.equal(match, null);
});

test("download so e liberado por conciliacao ativa e matematicamente completa", () => {
  assert.deepEqual(remittanceDownloadEligibility({ status: "GENERATED", totalAmount: 900, allocatedAmount: 0, adjustedAmount: 0, activeReconciliations: 0 }), { allowed: false, reason: "Aguardando conciliação bancária." });
  assert.deepEqual(remittanceDownloadEligibility({ status: "RECONCILED", totalAmount: 900, allocatedAmount: 900, adjustedAmount: 0, activeReconciliations: 1 }), { allowed: true, reason: null });
  assert.deepEqual(remittanceDownloadEligibility({ status: "RECONCILED", totalAmount: 900, allocatedAmount: 850, adjustedAmount: 50, activeReconciliations: 1 }), { allowed: true, reason: null });
  assert.equal(remittanceDownloadEligibility({ status: "RECONCILED", totalAmount: 900, allocatedAmount: 900, adjustedAmount: 0, activeReconciliations: 0 }).allowed, false);
});

test("permite cancelar remessa pendente sem vinculo financeiro ativo", () => {
  assert.doesNotThrow(() => assertRemittanceCancellationAllowed({ status: "GENERATED", activeReconciliations: 0 }));
  assert.doesNotThrow(() => assertRemittanceCancellationAllowed({ status: "RECONCILING", activeReconciliations: 0 }));
});

test("impede cancelar remessa conciliada, ja cancelada ou com conciliacao ativa", () => {
  assert.throws(() => assertRemittanceCancellationAllowed({ status: "GENERATED", activeReconciliations: 1 }), /desfaça a conciliação/i);
  assert.throws(() => assertRemittanceCancellationAllowed({ status: "RECONCILED", activeReconciliations: 1 }), /desfaça a conciliação/i);
  assert.throws(() => assertRemittanceCancellationAllowed({ status: "CANCELLED", activeReconciliations: 0 }), /já foi cancelada/i);
});
