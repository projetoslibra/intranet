import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import {
  buildExclusionWorkbook,
  EXCLUSION_REPORT_DEFAULT_LIMIT,
  EXCLUSION_REPORT_MAX_LIMIT,
  EXCLUSION_SCAN_BATCH_SIZE,
  ExclusionReportLimitError,
  excelCivilDateSerial,
  excelMoneyCellValue,
  excelSaoPauloDateTimeSerial,
  getExclusionExportReportWithDependencies,
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

type FindManyArgs = {
  cursor?: { id: string };
  skip?: number;
  take?: number;
  where?: { id?: { in?: string[] } };
  select?: Record<string, unknown>;
};

function createDatabase(rows: readonly any[] = fixtures, calls: FindManyArgs[] = []) {
  const sorted = [...rows].sort((left, right) => (
    right.remittance.generatedAt.getTime() - left.remittance.generatedAt.getTime() || left.id.localeCompare(right.id)
  ));
  return {
    fund: {
      findMany: async () => [{ id: "fund-consignado", cnpj: "54.842.157/0001-93", name: "Consignado" }],
    },
    consignadoRemittanceExclusion: {
      findMany: async (args: FindManyArgs) => {
        calls.push(args);
        const ids = args.where?.id?.in;
        if (ids) return sorted.filter((item) => ids.includes(item.id));
        const cursorIndex = args.cursor ? sorted.findIndex((item) => item.id === args.cursor?.id) + 1 : 0;
        return sorted.slice(cursorIndex, args.take ? cursorIndex + args.take : undefined);
      },
    },
  };
}

const dependencies = { database: createDatabase() };

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
    limit: "25",
    cursor: " active ",
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
    limit: 25,
    cursor: "active",
  });
  assert.throws(() => parseExclusionReportFilters(new URLSearchParams({ category: "INVALID" })), /Categoria inválida/);
  assert.throws(() => parseExclusionReportFilters(new URLSearchParams({ situation: "INVALID" })), /Situação inválida/);
  assert.throws(() => parseExclusionReportFilters(new URLSearchParams({ generatedFrom: "2026-08-31", generatedTo: "2026-08-01" })), /Período inválido/);
  assert.throws(() => parseExclusionReportFilters(new URLSearchParams({ search: "x".repeat(121) })), /Busca deve possuir no máximo 120 caracteres/);
  assert.throws(() => parseExclusionReportFilters(new URLSearchParams({ originator: "x".repeat(81) })), /Originador deve possuir no máximo 80 caracteres/);
  assert.throws(() => parseExclusionReportFilters(new URLSearchParams({ limit: "0" })), /Limite inválido/);
  assert.throws(() => parseExclusionReportFilters(new URLSearchParams({ limit: String(EXCLUSION_REPORT_MAX_LIMIT + 1) })), /Limite inválido/);
  assert.equal(parseExclusionReportFilters(new URLSearchParams()).limit, EXCLUSION_REPORT_DEFAULT_LIMIT);
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
    [{ search: "Jose" }, ["undone"]],
    [{ originator: "Júca" }, ["active"]],
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

test("pagina a tela, mantém totais do conjunto completo e usa cursor opaco do último resultado", async () => {
  const calls: FindManyArgs[] = [];
  const first = await getExclusionReportWithDependencies(
    parseExclusionReportFilters(new URLSearchParams({ limit: "1" })),
    { database: createDatabase(fixtures, calls) },
  );
  assert.deepEqual(first.items.map((item) => item.id), ["active"]);
  assert.deepEqual(first.page, { limit: 1, nextCursor: "active", hasMore: true });
  assert.equal(first.summary.total.count, 3);
  const detail = calls.find((call) => call.where?.id?.in);
  assert.match(JSON.stringify(detail?.select), /"take":1/);
  assert.match(JSON.stringify(detail?.select), /"status":"ACTIVE"/);

  const second = await getExclusionReportWithDependencies(
    parseExclusionReportFilters(new URLSearchParams({ limit: "1", cursor: first.page.nextCursor ?? "" })),
    { database: createDatabase() },
  );
  assert.deepEqual(second.items.map((item) => item.id), ["available"]);
  assert.deepEqual(second.page, { limit: 1, nextCursor: "available", hasMore: true });
  assert.equal(second.summary.total.count, 3);

  await assert.rejects(
    getExclusionReportWithDependencies(
      parseExclusionReportFilters(new URLSearchParams({ cursor: "inexistente" })),
      { database: createDatabase() },
    ),
    /Cursor inválido para os filtros aplicados/,
  );
});

test("consulta em lotes com where estrutural, select mínimo e cursor, sem pré-filtro textual com acentos", async () => {
  const calls: FindManyArgs[] = [];
  await getExclusionReportWithDependencies(
    parseExclusionReportFilters(new URLSearchParams({
      generatedFrom: "2026-08-20",
      source: "BMP",
      category: "OPERATOR_EXCLUDED",
      originator: "Júca",
      search: "Jose",
    })),
    { database: createDatabase([], calls) },
  );

  const scan = calls[0];
  assert.equal(scan?.take, EXCLUSION_SCAN_BATCH_SIZE);
  assert.equal(scan?.cursor, undefined);
  assert.equal("include" in (scan ?? {}), false);
  assert.deepEqual(Object.keys(scan?.select ?? {}).sort(), [
    "category", "differenceTitles", "id", "paidAmount", "remittance", "settlementItem", "titleAmount",
  ]);
  const where = JSON.stringify(scan?.where);
  assert.match(where, /generatedAt/);
  assert.match(where, /OPERATOR_EXCLUDED/);
  assert.match(where, /BMP/);
  assert.doesNotMatch(where, /Júca|Jose|contains/);
});

test("continua a varredura com cursor Prisma e aplica teto aos candidatos estruturais", async () => {
  const rows = Array.from({ length: EXCLUSION_SCAN_BATCH_SIZE + 1 }, (_, index) => ({
    ...fixtures[0],
    id: `row-${String(index).padStart(3, "0")}`,
  }));
  const calls: FindManyArgs[] = [];
  await getExclusionReportWithDependencies(
    parseExclusionReportFilters(new URLSearchParams({ limit: "1" })),
    { database: createDatabase(rows, calls) },
  );
  const scans = calls.filter((call) => call.take === EXCLUSION_SCAN_BATCH_SIZE);
  assert.equal(scans.length, 2);
  assert.deepEqual(scans[1]?.cursor, { id: "row-499" });
  assert.equal(scans[1]?.skip, 1);

  await assert.rejects(
    getExclusionReportWithDependencies(
      parseExclusionReportFilters(new URLSearchParams()),
      { database: createDatabase(), limits: { maxScanRows: 2 } },
    ),
    (error: unknown) => error instanceof ExclusionReportLimitError && /teto operacional de 2 títulos candidatos/.test(error.message),
  );
});

test("período diário usa a borda 03:00Z de America/Sao_Paulo", async () => {
  const rows = [
    { ...fixtures[0], id: "before-03", remittance: { ...fixtures[0].remittance, generatedAt: new Date("2026-08-21T02:59:59.000Z") } },
    { ...fixtures[0], id: "at-03", remittance: { ...fixtures[0].remittance, generatedAt: new Date("2026-08-21T03:00:00.000Z") } },
  ];
  const day20 = await getExclusionReportWithDependencies(
    parseExclusionReportFilters(new URLSearchParams({ generatedFrom: "2026-08-20", generatedTo: "2026-08-20" })),
    { database: createDatabase(rows) },
  );
  const day21 = await getExclusionReportWithDependencies(
    parseExclusionReportFilters(new URLSearchParams({ generatedFrom: "2026-08-21", generatedTo: "2026-08-21" })),
    { database: createDatabase(rows) },
  );
  assert.deepEqual(day20.items.map((item) => item.id), ["before-03"]);
  assert.deepEqual(day21.items.map((item) => item.id), ["at-03"]);
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

test("exporta dinheiro como número somente quando o round-trip de centavos é seguro", async () => {
  assert.equal(excelMoneyCellValue("99.24"), 99.24);
  assert.equal(excelMoneyCellValue("90071992547409.91"), "90071992547409.91");
  assert.equal(excelMoneyCellValue("9999999999999999999999.99"), "9999999999999999999999.99");

  const ordinary = await getExclusionReportWithDependencies(
    parseExclusionReportFilters(new URLSearchParams({ situation: "AVAILABLE" })),
    { database: createDatabase() },
  );
  const item = ordinary.items[0];
  assert.ok(item);
  const report = {
    ...ordinary,
    items: [
      item,
      { ...item, id: "unsafe", contractNumber: "unsafe", titleAmount: "90071992547409.91", paidAmount: "90071992547409.91" },
      { ...item, id: "max", contractNumber: "max", titleAmount: "9999999999999999999999.99", paidAmount: "9999999999999999999999.99" },
    ],
  };
  const workbook = XLSX.read(buildExclusionWorkbook(report), { type: "buffer", raw: true });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Titulos, { raw: true });
  assert.equal(rows[0]?.["Valor pago"], 99.24);
  assert.equal(rows[1]?.["Valor pago"], "90071992547409.91");
  assert.equal(rows[2]?.["Valor pago"], "9999999999999999999999.99");
});

test("converte timestamp para São Paulo e mantém @db.Date como data civil no XLSX", async () => {
  const beforeBoundary = excelSaoPauloDateTimeSerial("2026-08-21T02:59:59.000Z");
  const atBoundary = excelSaoPauloDateTimeSerial("2026-08-21T03:00:00.000Z");
  assert.equal(XLSX.SSF.format("dd/mm/yyyy hh:mm:ss", beforeBoundary), "20/08/2026 23:59:59");
  assert.equal(XLSX.SSF.format("dd/mm/yyyy hh:mm:ss", atBoundary), "21/08/2026 00:00:00");
  assert.equal(XLSX.SSF.format("dd/mm/yyyy", excelCivilDateSerial("2026-08-21T00:00:00.000Z")), "21/08/2026");

  const base = await getExclusionReportWithDependencies(
    parseExclusionReportFilters(new URLSearchParams({ situation: "AVAILABLE" })),
    { database: createDatabase() },
  );
  const item = base.items[0];
  assert.ok(item);
  const workbook = XLSX.read(buildExclusionWorkbook({
    ...base,
    items: [{ ...item, generatedAt: "2026-08-21T02:59:59.000Z", dueDate: "2026-08-21T00:00:00.000Z" }],
  }), { type: "buffer", cellDates: false });
  assert.equal(workbook.Sheets.Titulos.A2?.w, "20/08/2026 23:59:59");
  assert.equal(workbook.Sheets.Titulos.K2?.w, "21/08/2026");
});

test("mantém workbook vazio válido e interrompe export acima do teto operacional", async () => {
  const empty = await getExclusionReportWithDependencies(
    parseExclusionReportFilters(new URLSearchParams()),
    { database: createDatabase([]) },
  );
  const workbook = XLSX.read(buildExclusionWorkbook(empty), { type: "buffer" });
  assert.deepEqual(workbook.SheetNames, ["Resumo", "Titulos"]);
  assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets.Titulos), []);

  await assert.rejects(
    getExclusionExportReportWithDependencies(
      parseExclusionReportFilters(new URLSearchParams()),
      { database: createDatabase(), limits: { maxExportRows: 2, maxScanRows: 100 } },
    ),
    (error: unknown) => error instanceof ExclusionReportLimitError && /no máximo 2 títulos/.test(error.message),
  );
});
