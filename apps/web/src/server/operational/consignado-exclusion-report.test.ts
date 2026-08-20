import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import {
  buildExclusionWorkbook,
  getExclusionReportWithDependencies,
  parseExclusionReportFilters,
} from "./consignado-exclusion-report";

const decimal = (value: string) => new Prisma.Decimal(value);

const fixtures = [
  {
    id: "available",
    category: "NOT_FOUND_IN_STOCK",
    reason: "Título não encontrado no estoque ativo.",
    titleAmount: decimal("100.00"),
    paidAmount: decimal("99.24"),
    createdAt: new Date("2026-08-20T13:00:00.000Z"),
    remittance: {
      id: "remittance-available",
      fileName: "REM_GIBB_2008.rem",
      generatedAt: new Date("2026-08-20T13:00:00.000Z"),
      batch: {
        id: "batch-available",
        source: "BMP",
        fileName: "baixa-gibb.rem",
        originator: { id: "originator-gibb", code: "GIBB", name: "GIBB" },
      },
    },
    settlementItem: {
      sourceRow: 12,
      contractNumber: "94608325001",
      documentNumber: "DOC-001",
      yourNumber: "YN-001",
      debtorName: "João da Silva",
      debtorDocument: "123.456.789-01",
      dueDate: new Date("2026-09-10T00:00:00.000Z"),
    },
    differenceTitles: [],
  },
  {
    id: "active",
    category: "OPERATOR_EXCLUDED",
    reason: "Retirado após validação operacional.",
    titleAmount: decimal("80.00"),
    paidAmount: decimal("75.00"),
    createdAt: new Date("2026-08-21T15:00:00.000Z"),
    remittance: {
      id: "remittance-active",
      fileName: "REM_JUCA_2108.rem",
      generatedAt: new Date("2026-08-21T15:00:00.000Z"),
      batch: {
        id: "batch-active",
        source: "BMP",
        fileName: "baixa-juca.rem",
        originator: { id: "originator-juca", code: "JUCA", name: "Juca" },
      },
    },
    settlementItem: {
      sourceRow: 8,
      contractNumber: "94608325002",
      documentNumber: "DOC-002",
      yourNumber: "YN-002",
      debtorName: "Maria Souza",
      debtorDocument: "987.654.321-00",
      dueDate: new Date("2026-09-11T00:00:00.000Z"),
    },
    differenceTitles: [
      {
        reconciliation: {
          id: "reconciliation-undone-before-active",
          status: "UNDONE",
          createdAt: new Date("2026-08-21T16:00:00.000Z"),
          allocations: [],
        },
      },
      {
        reconciliation: {
          id: "reconciliation-active",
          status: "ACTIVE",
          createdAt: new Date("2026-08-21T17:00:00.000Z"),
          allocations: [{
            bankEntry: {
              transactionDate: new Date("2026-08-21T00:00:00.000Z"),
              description: "Crédito consignado",
              document: "BANK-002",
            },
          }],
        },
      },
    ],
  },
  {
    id: "undone",
    category: "PDD_RECOVERY",
    reason: "Baixa histórica por PDD.",
    titleAmount: decimal("50.00"),
    paidAmount: decimal("45.00"),
    createdAt: new Date("2026-08-15T12:00:00.000Z"),
    remittance: {
      id: "remittance-undone",
      fileName: "REM_UY3_1508.xlsx",
      generatedAt: new Date("2026-08-15T12:00:00.000Z"),
      batch: {
        id: "batch-undone",
        source: "UY3",
        fileName: "baixa-uy3.xlsx",
        originator: { id: "originator-uy3", code: "UY3", name: "UY3" },
      },
    },
    settlementItem: {
      sourceRow: 21,
      contractNumber: "94608325003",
      documentNumber: "DOC-003",
      yourNumber: "YN-003",
      debtorName: "José Oliveira",
      debtorDocument: "111.222.333-44",
      dueDate: new Date("2026-09-12T00:00:00.000Z"),
    },
    differenceTitles: [{
      reconciliation: {
        id: "reconciliation-undone",
        status: "UNDONE",
        createdAt: new Date("2026-08-16T12:00:00.000Z"),
        allocations: [{
          bankEntry: {
            transactionDate: new Date("2026-08-16T00:00:00.000Z"),
            description: "Crédito desfeito",
            document: null,
          },
        }],
      },
    }],
  },
] as const;

const dependencies = {
  database: {
    fund: {
      findMany: async () => [{ id: "fund-consignado", cnpj: "54.842.157/0001-93", name: "Consignado" }],
    },
    consignadoRemittanceExclusion: {
      findMany: async () => fixtures,
    },
  },
};

test("normaliza os filtros do relatório e rejeita enum ou período inválido", () => {
  const filters = parseExclusionReportFilters(new URLSearchParams({
    generatedFrom: "2026-08-01",
    generatedTo: "2026-08-31",
    source: "BMP",
    originator: "  JUCA ",
    batchFile: " baixa ",
    remittanceFile: " REM_ ",
    category: "OPERATOR_EXCLUDED",
    situation: "ACTIVE_RECONCILIATION",
    search: " Maria ",
    batchId: " batch-active ",
    remittanceId: " remittance-active ",
  }));

  assert.deepEqual(filters, {
    generatedFrom: "2026-08-01",
    generatedTo: "2026-08-31",
    source: "BMP",
    originator: "JUCA",
    batchFile: "baixa",
    remittanceFile: "REM_",
    category: "OPERATOR_EXCLUDED",
    situation: "ACTIVE_RECONCILIATION",
    search: "Maria",
    batchId: "batch-active",
    remittanceId: "remittance-active",
  });
  assert.throws(() => parseExclusionReportFilters(new URLSearchParams({ category: "INVALID" })), /Categoria inválida/);
  assert.throws(() => parseExclusionReportFilters(new URLSearchParams({ situation: "INVALID" })), /Situação inválida/);
  assert.throws(() => parseExclusionReportFilters(new URLSearchParams({ generatedFrom: "2026-08-31", generatedTo: "2026-08-01" })), /Período inválido/);
});

test("aplica data, fluxo, originador, categoria, situação e busca com precedência ativa", async () => {
  const byDate = await getExclusionReportWithDependencies(parseExclusionReportFilters(new URLSearchParams({
    generatedFrom: "2026-08-20",
    generatedTo: "2026-08-21",
  })), dependencies);
  assert.deepEqual(byDate.items.map((item) => item.id), ["active", "available"]);

  const cases = [
    [{ source: "UY3" }, ["undone"]],
    [{ originator: "JUCA" }, ["active"]],
    [{ category: "PDD_RECOVERY" }, ["undone"]],
    [{ situation: "AVAILABLE" }, ["available"]],
    [{ situation: "ACTIVE_RECONCILIATION" }, ["active"]],
    [{ situation: "UNDONE_HISTORY" }, ["undone"]],
    [{ search: "maria" }, ["active"]],
    [{ search: "11122233344" }, ["undone"]],
    [{ batchFile: "gibb" }, ["available"]],
    [{ remittanceFile: "2108" }, ["active"]],
    [{ batchId: "batch-undone" }, ["undone"]],
    [{ remittanceId: "remittance-available" }, ["available"]],
  ] as const;

  for (const [input, expectedIds] of cases) {
    const report = await getExclusionReportWithDependencies(
      parseExclusionReportFilters(new URLSearchParams(input)),
      dependencies,
    );
    assert.deepEqual(report.items.map((item) => item.id), expectedIds, JSON.stringify(input));
  }
});

test("resume quantidade e valores por categoria e situação sem perder centavos", async () => {
  const report = await getExclusionReportWithDependencies(parseExclusionReportFilters(new URLSearchParams()), dependencies);

  assert.deepEqual(report.summary.total, { count: 3, titleAmount: "230.00", paidAmount: "219.24" });
  assert.deepEqual(report.summary.byCategory, [
    { key: "NOT_FOUND_IN_STOCK", count: 1, titleAmount: "100.00", paidAmount: "99.24" },
    { key: "OPERATOR_EXCLUDED", count: 1, titleAmount: "80.00", paidAmount: "75.00" },
    { key: "PDD_RECOVERY", count: 1, titleAmount: "50.00", paidAmount: "45.00" },
  ]);
  assert.deepEqual(report.summary.bySituation, [
    { key: "AVAILABLE", count: 1, titleAmount: "100.00", paidAmount: "99.24" },
    { key: "ACTIVE_RECONCILIATION", count: 1, titleAmount: "80.00", paidAmount: "75.00" },
    { key: "UNDONE_HISTORY", count: 1, titleAmount: "50.00", paidAmount: "45.00" },
  ]);
});

test("gera workbook relível com resumo e colunas operacionais dos títulos", async () => {
  const report = await getExclusionReportWithDependencies(
    parseExclusionReportFilters(new URLSearchParams({ situation: "AVAILABLE" })),
    dependencies,
  );
  const buffer = buildExclusionWorkbook(report);
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

  assert.deepEqual(workbook.SheetNames, ["Resumo", "Titulos"]);
  const detailRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Titulos, { raw: true });
  assert.equal(detailRows[0]?.Contrato, "94608325001");
  assert.equal(detailRows[0]?.["Valor pago"], 99.24);
  assert.equal(detailRows[0]?.Situação, "Disponível");
  assert.deepEqual(Object.keys(detailRows[0] ?? {}), [
    "Data da remessa", "Fluxo", "Originador", "Lote", "Remessa", "Linha", "Contrato",
    "Documento", "Sacado", "CPF", "Vencimento", "Valor de face", "Valor pago", "Categoria",
    "Motivo", "Situação", "Entrada bancária", "Data da conciliação",
  ]);
  const summaryRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Resumo, { raw: true });
  assert.deepEqual(summaryRows.slice(0, 4), [
    { Indicador: "Situação", Valor: "Disponível" },
    { Indicador: "Quantidade", Valor: 1 },
    { Indicador: "Valor de face", Valor: 100 },
    { Indicador: "Valor pago", Valor: 99.24 },
  ]);
});
