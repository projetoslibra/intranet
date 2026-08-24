import assert from "node:assert/strict";
import test from "node:test";
import type { DifferenceReport } from "@/server/operational/consignado-difference-report";
import {
  applyDifferenceResolutionToReport,
  retryFiltersWithoutInvalidCursor,
} from "./consignado-difference-resolution";

const report: DifferenceReport = {
  filters: { status: "OPEN", limit: 25, cursor: "difference-previous" },
  items: [{
    id: "difference-1",
    reconciliationId: "reconciliation-1",
    reconciliationStatus: "ACTIVE",
    category: "BANK_FEE",
    direction: "ENTRY_EXCESS",
    amount: "10.00",
    reason: "Tarifa",
    status: "OPEN",
    createdAt: "2026-08-20T12:00:00.000Z",
    createdBy: { id: "user-1", name: "Ana" },
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
    cancelledAt: null,
    ageDays: 1,
    entries: [],
    remittances: [],
  }],
  summary: {
    open: { count: 1, amount: "10.00" },
    byCategory: [{ key: "BANK_FEE", count: 1, amount: "10.00" }],
    byDirection: [{ key: "ENTRY_EXCESS", count: 1, amount: "10.00" }],
  },
  page: { limit: 25, nextCursor: null, hasMore: false },
};

test("aplica RESOLVED imediatamente à linha e aos indicadores locais", () => {
  const updated = applyDifferenceResolutionToReport(report, {
    id: "difference-1",
    status: "RESOLVED",
    resolvedAt: "2026-08-21T15:00:00.000Z",
    resolutionNote: "Confirmada pelo banco",
    resolvedBy: { id: "user-2", name: "Bruno" },
  });
  assert.equal(updated.items[0]?.status, "RESOLVED");
  assert.equal(updated.items[0]?.resolvedAt, "2026-08-21T15:00:00.000Z");
  assert.deepEqual(updated.items[0]?.resolvedBy, { id: "user-2", name: "Bruno" });
  assert.equal(updated.items[0]?.resolutionNote, "Confirmada pelo banco");
  assert.deepEqual(updated.summary, { open: { count: 0, amount: "0.00" }, byCategory: [], byDirection: [] });
});

test("cursor inválido repete a consulta sem cursor e não mascara outros erros", () => {
  assert.deepEqual(retryFiltersWithoutInvalidCursor(report.filters, 400, "Cursor inválido para os filtros aplicados."), {
    status: "OPEN",
    limit: 25,
  });
  assert.equal(retryFiltersWithoutInvalidCursor(report.filters, 422, "Restrinja os filtros."), null);
  assert.equal(retryFiltersWithoutInvalidCursor({ limit: 50 }, 400, "Cursor inválido para os filtros aplicados."), null);
});
