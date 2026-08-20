import assert from "node:assert/strict";
import test from "node:test";
import type { ExclusionReport } from "./consignado-exclusion-report";
import {
  ExclusionReportInputError,
  ExclusionReportLimitError,
} from "./consignado-exclusion-report";
import { loadInitialExclusionReport } from "./consignado-exclusion-report-page";

const emptyReport = (filters: ExclusionReport["filters"]): ExclusionReport => ({
  filters,
  items: [],
  summary: { total: { count: 0, titleAmount: "0", paidAmount: "0" }, byCategory: [], bySituation: [] },
  page: { limit: filters.limit, nextCursor: null, hasMore: false },
});

test("carregamento inicial transforma query inválida em estado recuperável com filtros seguros", async () => {
  let calls = 0;

  const state = await loadInitialExclusionReport(
    new URLSearchParams({ limit: "999" }),
    async (filters) => { calls += 1; return emptyReport(filters); },
  );

  assert.equal(calls, 0);
  assert.deepEqual(state, {
    kind: "recoverable",
    report: null,
    filters: { limit: 50 },
    message: "Limite inválido. Informe um inteiro entre 1 e 100.",
  });
});

test("carregamento inicial preserva filtros úteis ao atingir o teto e remove cursor", async () => {
  const error = new ExclusionReportLimitError("Consulta ampla demais. Restrinja os filtros informados.");

  const state = await loadInitialExclusionReport(
    new URLSearchParams({ generatedFrom: "2026-08-20", category: "NOT_APPROVED", cursor: "exclusion-50", limit: "25" }),
    async () => { throw error; },
  );

  assert.deepEqual(state, {
    kind: "recoverable",
    report: null,
    filters: { generatedFrom: "2026-08-20", category: "NOT_APPROVED", limit: 25 },
    message: error.message,
  });
});

test("carregamento inicial também recupera erro público de entrada produzido pelo serviço", async () => {
  const error = new ExclusionReportInputError("Cursor inválido.");

  const state = await loadInitialExclusionReport(
    new URLSearchParams({ generatedTo: "2026-08-20", cursor: "inexistente", limit: "50" }),
    async () => { throw error; },
  );

  assert.deepEqual(state, {
    kind: "recoverable",
    report: null,
    filters: { generatedTo: "2026-08-20", limit: 50 },
    message: "Cursor inválido.",
  });
});

test("carregamento inicial deixa falha interna seguir para o error boundary", async () => {
  const error = new Error("prisma connection details");

  await assert.rejects(
    loadInitialExclusionReport(new URLSearchParams(), async () => { throw error; }),
    (received) => received === error,
  );
});

test("carregamento inicial retorna relatório pronto quando a consulta é válida", async () => {
  const state = await loadInitialExclusionReport(
    new URLSearchParams({ source: "bmp", limit: "25" }),
    async (filters) => emptyReport(filters),
  );

  assert.equal(state.kind, "ready");
  assert.deepEqual(state.filters, { source: "BMP", limit: 25 });
  assert.deepEqual(state.report, emptyReport({ source: "BMP", limit: 25 }));
});
