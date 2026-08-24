import assert from "node:assert/strict";
import test from "node:test";
import * as batchLogModule from "./consignado-reconciliation";

type SummarizeBatchReconciliation = (input: {
  receivedAmount: string;
  remittances: Array<{
    id: string;
    status: string;
    totalAmount: string;
    allocatedAmount: string;
    adjustedAmount: string;
    allocations: Array<{
      amount: string;
      reconciliation: { id: string; status: string; createdAt: string };
      bankEntry: {
        id: string;
        transactionDate: string;
        description: string;
        document: string | null;
        amount: string;
      };
    }>;
  }>;
}) => unknown;

test("resume os valores e a entrada da conciliação ativa de um lote", () => {
  const summarize = (batchLogModule as unknown as { summarizeBatchReconciliation?: SummarizeBatchReconciliation })
    .summarizeBatchReconciliation;

  assert.equal(typeof summarize, "function", "summarizeBatchReconciliation ainda não foi implementada");

  const summary = summarize!({
    receivedAmount: "53.00",
    remittances: [{
      id: "remessa-1",
      status: "RECONCILED",
      totalAmount: "52.90",
      allocatedAmount: "52.90",
      adjustedAmount: "0.00",
      allocations: [
        {
          amount: "52.90",
          reconciliation: { id: "conciliacao-ativa", status: "ACTIVE", createdAt: "2026-08-19T18:30:00.000Z" },
          bankEntry: {
            id: "entrada-1",
            transactionDate: "2026-08-19T00:00:00.000Z",
            description: "PIX RECEBIDO REM: BMP",
            document: "1810533",
            amount: "53.00",
          },
        },
        {
          amount: "10.00",
          reconciliation: { id: "conciliacao-desfeita", status: "UNDONE", createdAt: "2026-08-18T18:30:00.000Z" },
          bankEntry: {
            id: "entrada-antiga",
            transactionDate: "2026-08-18T00:00:00.000Z",
            description: "ENTRADA DESFEITA",
            document: null,
            amount: "10.00",
          },
        },
      ],
    }],
  }) as {
    paidAmount: string;
    remittanceAmount: string;
    reconciliationStatus: string;
    entries: Array<{ id: string; allocatedAmount: string }>;
  };

  assert.deepEqual(summary, {
    paidAmount: "53.00",
    remittanceAmount: "52.90",
    reconciliationStatus: "RECONCILED",
    entries: [{
      id: "entrada-1",
      transactionDate: "2026-08-19T00:00:00.000Z",
      description: "PIX RECEBIDO REM: BMP",
      document: "1810533",
      amount: "53.00",
      allocatedAmount: "52.90",
      reconciliationId: "conciliacao-ativa",
      reconciledAt: "2026-08-19T18:30:00.000Z",
    }],
  });
});

test("distingue lote sem remessa, não conciliado e parcialmente conciliado", () => {
  const summarize = (batchLogModule as unknown as { summarizeBatchReconciliation?: SummarizeBatchReconciliation })
    .summarizeBatchReconciliation;

  assert.equal(typeof summarize, "function", "summarizeBatchReconciliation ainda não foi implementada");

  const base = { receivedAmount: "100.00" };

  assert.equal((summarize!({ ...base, remittances: [] }) as { reconciliationStatus: string }).reconciliationStatus, "NO_REMITTANCE");
  assert.equal((summarize!({
    ...base,
    remittances: [{ id: "r1", status: "GENERATED", totalAmount: "90.00", allocatedAmount: "0", adjustedAmount: "0", allocations: [] }],
  }) as { reconciliationStatus: string }).reconciliationStatus, "NOT_RECONCILED");
  assert.equal((summarize!({
    ...base,
    remittances: [{ id: "r1", status: "RECONCILING", totalAmount: "90.00", allocatedAmount: "40.00", adjustedAmount: "0", allocations: [] }],
  }) as { reconciliationStatus: string }).reconciliationStatus, "PARTIALLY_RECONCILED");
});
