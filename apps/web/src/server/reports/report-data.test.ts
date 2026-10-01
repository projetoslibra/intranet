import assert from "node:assert/strict";
import test from "node:test";
import { ReportExportNotFoundError } from "./report-export";
import {
  getReportAvailabilityWithDependencies,
  getReportRowsWithDependencies,
} from "./report-data";

function database(overrides: Record<string, unknown> = {}) {
  return {
    fidcEstoque: {
      groupBy: async () => [],
      findMany: async () => [],
    },
    fidcLiquidadoBaixado: {
      groupBy: async () => [],
      findMany: async () => [],
    },
    fidcMovimentoAberto: {
      groupBy: async () => [],
      findMany: async () => [],
    },
    ...overrides,
  };
}

test("disponibilidade agrupa fundos, datas e períodos existentes", async () => {
  const availability = await getReportAvailabilityWithDependencies(database({
    fidcEstoque: {
      groupBy: async () => [
        { nomeFundo: "APUAMA", dataReferencia: new Date("2026-09-30T00:00:00.000Z") },
        { nomeFundo: "APUAMA", dataReferencia: new Date("2026-09-29T00:00:00.000Z") },
      ],
      findMany: async () => [],
    },
    fidcLiquidadoBaixado: {
      groupBy: async () => [{ fundoNome: "BRISTOL", dataDaPosicao: new Date("2026-09-30T00:00:00.000Z") }],
      findMany: async () => [],
    },
    fidcMovimentoAberto: {
      groupBy: async () => [
        { nomeFundo: "APUAMA", dataReferencia: new Date("2026-09-30T00:00:00.000Z"), periodo: "TARDE" },
        { nomeFundo: "APUAMA", dataReferencia: new Date("2026-09-30T00:00:00.000Z"), periodo: "MANHA" },
        { nomeFundo: "APUAMA", dataReferencia: new Date("2026-09-29T00:00:00.000Z"), periodo: "MANHA" },
      ],
      findMany: async () => [],
    },
  }));

  assert.deepEqual(availability, {
    stock: [{ fund: "APUAMA", dates: [{ date: "2026-09-30", periods: [] }, { date: "2026-09-29", periods: [] }] }],
    settled: [{ fund: "BRISTOL", dates: [{ date: "2026-09-30", periods: [] }] }],
    "open-movements": [{
      fund: "APUAMA",
      dates: [
        { date: "2026-09-30", periods: ["MANHA", "TARDE"] },
        { date: "2026-09-29", periods: ["MANHA"] },
      ],
    }],
  });
});

test("estoque consulta exatamente o fundo e a data selecionados", async () => {
  let received: Record<string, unknown> | undefined;
  const rows = [{ nomeFundo: "APUAMA" }];
  const db = database({
    fidcEstoque: {
      groupBy: async () => [],
      findMany: async (args: Record<string, unknown>) => { received = args; return rows; },
    },
  });

  assert.equal(await getReportRowsWithDependencies("stock", { fund: "APUAMA", date: "2026-09-30" }, db), rows);
  assert.deepEqual(received?.where, { nomeFundo: "APUAMA", dataReferencia: new Date("2026-09-30T00:00:00.000Z") });
});

test("movimentos em aberto consulta também o período selecionado", async () => {
  let received: Record<string, unknown> | undefined;
  const rows = [{ nomeFundo: "BRISTOL", periodo: "TARDE" }];
  const db = database({
    fidcMovimentoAberto: {
      groupBy: async () => [],
      findMany: async (args: Record<string, unknown>) => { received = args; return rows; },
    },
  });

  assert.equal(await getReportRowsWithDependencies("open-movements", { fund: "BRISTOL", date: "2026-09-30", period: "TARDE" }, db), rows);
  assert.deepEqual(received?.where, {
    nomeFundo: "BRISTOL",
    dataReferencia: new Date("2026-09-30T00:00:00.000Z"),
    periodo: "TARDE",
  });
});

test("combinação sem dados retorna erro público", async () => {
  await assert.rejects(
    getReportRowsWithDependencies("settled", { fund: "APUAMA", date: "2026-09-30" }, database()),
    (error) => error instanceof ReportExportNotFoundError && error.message === "Não existem dados para os filtros selecionados.",
  );
});
