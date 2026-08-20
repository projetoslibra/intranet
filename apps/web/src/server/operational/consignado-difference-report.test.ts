import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import {
  DIFFERENCE_REPORT_CACHE_CONTROL,
  DIFFERENCE_REPORT_DEFAULT_LIMIT,
  DIFFERENCE_REPORT_MAX_LIMIT,
  DifferenceReportConflictError,
  DifferenceReportInputError,
  DifferenceReportLimitError,
  buildDifferenceWorkbook,
  classifyDifferenceReportError,
  getDifferenceExportReportWithDependencies,
  getDifferenceReportWithDependencies,
  getOpenDifferenceOverviewWithDependencies,
  loadInitialDifferenceReport,
  parseDifferenceReportFilters,
  resolveDifferenceReportAccess,
  resolveOtherDifferenceWithDependencies,
  transitionOtherDifference,
} from "./consignado-difference-report";

const baseReconciliation = {
  id: "reconciliation-active",
  status: "ACTIVE",
  createdAt: new Date("2026-08-20T13:00:00.000Z"),
  allocations: [{
    bankEntry: {
      id: "entry-alpha",
      transactionDate: new Date("2026-08-20T00:00:00.000Z"),
      description: "Crédito cliente Álfa",
      document: "DOC-123",
    },
    remittance: {
      id: "remittance-alpha",
      fileName: "REM_ÁLFA.REM",
      batch: { id: "batch-alpha", fileName: "BAIXA_ALFA.csv" },
    },
  }],
} as const;

const fixtures = [
  {
    id: "open-fee",
    category: "BANK_FEE",
    direction: "ENTRY_EXCESS",
    amount: new Prisma.Decimal("25.10"),
    reason: "Tarifa TED não prevista",
    status: "OPEN",
    createdAt: new Date("2026-08-20T14:00:00.000Z"),
    resolvedAt: null,
    resolutionNote: null,
    cancelledAt: null,
    createdBy: { id: "user-ana", name: "Ana Operadora" },
    resolvedBy: null,
    reconciliation: baseReconciliation,
  },
  {
    id: "open-credit",
    category: "UNIDENTIFIED_CREDIT",
    direction: "ENTRY_EXCESS",
    amount: new Prisma.Decimal("0.20"),
    reason: "Crédito residual sem contrato",
    status: "OPEN",
    createdAt: new Date("2026-08-19T15:00:00.000Z"),
    resolvedAt: null,
    resolutionNote: null,
    cancelledAt: null,
    createdBy: { id: "user-bruno", name: "Bruno" },
    resolvedBy: null,
    reconciliation: {
      ...baseReconciliation,
      id: "reconciliation-credit",
      allocations: [{
        bankEntry: {
          id: "entry-credit",
          transactionDate: new Date("2026-08-19T00:00:00.000Z"),
          description: "Crédito sem identificação",
          document: null,
        },
        remittance: {
          id: "remittance-credit",
          fileName: "REM_CREDITO.REM",
          batch: { id: "batch-credit", fileName: "BAIXA_CREDITO.csv" },
        },
      }],
    },
  },
  {
    id: "resolved-value",
    category: "VALUE_DIFFERENCE",
    direction: "REMITTANCE_EXCESS",
    amount: new Prisma.Decimal("10.00"),
    reason: "Diferença conhecida",
    status: "RESOLVED",
    createdAt: new Date("2026-08-18T12:00:00.000Z"),
    resolvedAt: new Date("2026-08-20T16:00:00.000Z"),
    resolutionNote: "Confirmado com o custodiante",
    cancelledAt: null,
    createdBy: { id: "user-ana", name: "Ana Operadora" },
    resolvedBy: { id: "user-caio", name: "Caio Gestor" },
    reconciliation: baseReconciliation,
  },
  {
    id: "cancelled-timing",
    category: "TIMING_DIFFERENCE",
    direction: "ENTRY_EXCESS",
    amount: new Prisma.Decimal("5.00"),
    reason: "Liquidação em outra competência",
    status: "CANCELLED",
    createdAt: new Date("2026-08-17T12:00:00.000Z"),
    resolvedAt: null,
    resolutionNote: null,
    cancelledAt: new Date("2026-08-18T12:00:00.000Z"),
    createdBy: { id: "user-ana", name: "Ana Operadora" },
    resolvedBy: null,
    reconciliation: { ...baseReconciliation, id: "reconciliation-undone", status: "UNDONE" },
  },
  {
    id: "stale-open-undone",
    category: "OTHER",
    direction: "ENTRY_EXCESS",
    amount: new Prisma.Decimal("999.00"),
    reason: "Estado inconsistente não deve virar pendência",
    status: "OPEN",
    createdAt: new Date("2026-08-16T12:00:00.000Z"),
    resolvedAt: null,
    resolutionNote: null,
    cancelledAt: null,
    createdBy: { id: "user-ana", name: "Ana Operadora" },
    resolvedBy: null,
    reconciliation: { ...baseReconciliation, id: "reconciliation-stale", status: "UNDONE" },
  },
] as const;

type FindManyArgs = {
  cursor?: { id: string };
  skip?: number;
  take?: number;
  where?: Record<string, unknown>;
  select?: Record<string, unknown>;
};

function createReportDatabase(rows: readonly any[] = fixtures, calls: FindManyArgs[] = []) {
  const sorted = [...rows].sort((left, right) => (
    right.createdAt.getTime() - left.createdAt.getTime() || left.id.localeCompare(right.id)
  ));
  return {
    consignadoBankOtherDifference: {
      findMany: async (args: FindManyArgs) => {
        calls.push(args);
        const cursorIndex = args.cursor ? sorted.findIndex((item) => item.id === args.cursor?.id) + 1 : 0;
        return sorted.slice(cursorIndex, args.take ? cursorIndex + args.take : undefined);
      },
    },
  };
}

test("normaliza filtros compartilhados e rejeita enum, período, texto ou limite inválido", () => {
  assert.deepEqual(parseDifferenceReportFilters(new URLSearchParams({
    createdFrom: "2026-08-01",
    createdTo: "2026-08-31",
    status: "open",
    category: "bank_fee",
    direction: "entry_excess",
    entry: "  crédito ",
    remittance: " rem_ ",
    search: "  tarifa ",
    limit: "25",
    cursor: " open-fee ",
  })), {
    createdFrom: "2026-08-01",
    createdTo: "2026-08-31",
    status: "OPEN",
    category: "BANK_FEE",
    direction: "ENTRY_EXCESS",
    entry: "crédito",
    remittance: "rem_",
    search: "tarifa",
    limit: 25,
    cursor: "open-fee",
  });
  assert.equal(parseDifferenceReportFilters(new URLSearchParams()).limit, DIFFERENCE_REPORT_DEFAULT_LIMIT);
  assert.throws(() => parseDifferenceReportFilters(new URLSearchParams({ status: "INVALID" })), /Status inválido/);
  assert.throws(() => parseDifferenceReportFilters(new URLSearchParams({ category: "INVALID" })), /Categoria inválida/);
  assert.throws(() => parseDifferenceReportFilters(new URLSearchParams({ direction: "INVALID" })), /Direção inválida/);
  assert.throws(() => parseDifferenceReportFilters(new URLSearchParams({ createdFrom: "2026-08-31", createdTo: "2026-08-01" })), /Período inválido/);
  assert.throws(() => parseDifferenceReportFilters(new URLSearchParams({ search: "x".repeat(121) })), /Busca deve possuir no máximo 120 caracteres/);
  assert.throws(() => parseDifferenceReportFilters(new URLSearchParams({ limit: String(DIFFERENCE_REPORT_MAX_LIMIT + 1) })), /Limite inválido/);
});

test("lista histórico, mas mede como pendências somente OPEN de conciliações ACTIVE", async () => {
  const report = await getDifferenceReportWithDependencies(
    parseDifferenceReportFilters(new URLSearchParams()),
    { database: createReportDatabase(), now: () => new Date("2026-08-21T14:00:00.000Z") },
  );

  assert.deepEqual(report.items.map((item) => item.id), ["open-fee", "open-credit", "resolved-value", "cancelled-timing"]);
  assert.deepEqual(report.summary.open, { count: 2, amount: "25.30" });
  assert.deepEqual(report.summary.byCategory, [
    { key: "BANK_FEE", count: 1, amount: "25.10" },
    { key: "UNIDENTIFIED_CREDIT", count: 1, amount: "0.20" },
  ]);
  assert.deepEqual(report.summary.byDirection, [
    { key: "ENTRY_EXCESS", count: 2, amount: "25.30" },
  ]);
  assert.equal(report.items[0]?.ageDays, 1);
  assert.deepEqual(report.items[0]?.entries, [{
    id: "entry-alpha",
    transactionDate: "2026-08-20T00:00:00.000Z",
    description: "Crédito cliente Álfa",
    document: "DOC-123",
  }]);
  assert.deepEqual(report.items[0]?.remittances, [{
    id: "remittance-alpha",
    fileName: "REM_ÁLFA.REM",
    batchId: "batch-alpha",
    batchFile: "BAIXA_ALFA.csv",
  }]);
});

test("aplica direção, categoria, data, status, entrada, remessa e busca sem acentos ao mesmo conjunto do resumo", async () => {
  const cases = [
    [{ direction: "REMITTANCE_EXCESS" }, ["resolved-value"], "0.00"],
    [{ category: "BANK_FEE" }, ["open-fee"], "25.10"],
    [{ status: "CANCELLED" }, ["cancelled-timing"], "0.00"],
    [{ createdFrom: "2026-08-20", createdTo: "2026-08-20" }, ["open-fee"], "25.10"],
    [{ entry: "credito cliente alfa" }, ["open-fee", "resolved-value", "cancelled-timing"], "25.10"],
    [{ remittance: "rem_alfa" }, ["open-fee", "resolved-value", "cancelled-timing"], "25.10"],
    [{ search: "ana operadora" }, ["open-fee", "resolved-value", "cancelled-timing"], "25.10"],
    [{ search: "custodiante" }, ["resolved-value"], "0.00"],
  ] as const;

  for (const [query, ids, openAmount] of cases) {
    const report = await getDifferenceReportWithDependencies(
      parseDifferenceReportFilters(new URLSearchParams(query)),
      { database: createReportDatabase(), now: () => new Date("2026-08-21T14:00:00.000Z") },
    );
    assert.deepEqual(report.items.map((item) => item.id), ids, JSON.stringify(query));
    assert.equal(report.summary.open.amount, openAmount, JSON.stringify(query));
  }
});

test("pagina com cursor, varre por lotes e impõe tetos na consulta e no Excel", async () => {
  const calls: FindManyArgs[] = [];
  const first = await getDifferenceReportWithDependencies(
    parseDifferenceReportFilters(new URLSearchParams({ limit: "1" })),
    { database: createReportDatabase(fixtures, calls), now: () => new Date("2026-08-21T14:00:00.000Z") },
  );
  assert.deepEqual(first.items.map((item) => item.id), ["open-fee"]);
  assert.deepEqual(first.page, { limit: 1, nextCursor: "open-fee", hasMore: true });
  assert.equal(first.summary.open.count, 2);
  assert.equal(calls[0]?.take, 500);
  assert.equal("include" in (calls[0] ?? {}), false);
  assert.match(JSON.stringify(calls[0]?.where), /"status":"OPEN"/);
  assert.match(JSON.stringify(calls[0]?.where), /"status":"ACTIVE"/);

  await assert.rejects(
    getDifferenceReportWithDependencies(
      parseDifferenceReportFilters(new URLSearchParams()),
      { database: createReportDatabase(), limits: { maxScanRows: 2 }, now: () => new Date() },
    ),
    (error: unknown) => error instanceof DifferenceReportLimitError && /2 ajustes candidatos/.test(error.message),
  );
  await assert.rejects(
    getDifferenceExportReportWithDependencies(
      parseDifferenceReportFilters(new URLSearchParams()),
      { database: createReportDatabase(), limits: { maxScanRows: 100, maxExportRows: 2 }, now: () => new Date() },
    ),
    (error: unknown) => error instanceof DifferenceReportLimitError && /no máximo 2 diferenças/.test(error.message),
  );
});

test("gera workbook relível com filtros compartilhados, abas e valores monetários exatos", async () => {
  const report = await getDifferenceExportReportWithDependencies(
    parseDifferenceReportFilters(new URLSearchParams({ category: "BANK_FEE", search: "tarifa" })),
    { database: createReportDatabase(), now: () => new Date("2026-08-21T14:00:00.000Z") },
  );
  const workbook = XLSX.read(buildDifferenceWorkbook(report), { type: "buffer", cellDates: true });
  assert.deepEqual(workbook.SheetNames, ["Resumo", "Diferencas"]);
  const summaryRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Resumo, { raw: true });
  assert.deepEqual(summaryRows.slice(0, 4), [
    { Indicador: "Categoria", Valor: "Tarifa bancária" },
    { Indicador: "Busca", Valor: "tarifa" },
    { Indicador: "Pendências em aberto", Valor: 1 },
    { Indicador: "Valor em aberto", Valor: 25.1 },
  ]);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Diferencas, { raw: true });
  assert.equal(rows[0]?.Valor, 25.1);
  assert.equal(rows[0]?.Status, "Em aberto");
  assert.equal(rows[0]?.Direção, "Excesso de entrada");
  assert.equal(rows[0]?.Entrada, "20/08/2026 · Crédito cliente Álfa · DOC-123");
  assert.equal(rows[0]?.Remessa, "REM_ÁLFA.REM · BAIXA_ALFA.csv");
});

test("transição pura aceita somente OPEN e nota entre cinco e quinhentos caracteres", () => {
  const now = new Date("2026-08-21T18:00:00.000Z");
  assert.deepEqual(transitionOtherDifference("OPEN", "  Confirmado pelo banco  ", "user-1", now), {
    status: "RESOLVED",
    resolvedAt: now,
    resolvedByUserId: "user-1",
    resolutionNote: "Confirmado pelo banco",
  });
  assert.throws(() => transitionOtherDifference("OPEN", "curt", "user-1", now), /ao menos 5 caracteres/);
  assert.throws(() => transitionOtherDifference("RESOLVED", "Tentativa repetida", "user-1", now), /já foi resolvida/);
  assert.throws(() => transitionOtherDifference("CANCELLED", "Tentativa cancelada", "user-1", now), /cancelada/);
});

function createResolutionDatabase(initialStatus: "OPEN" | "RESOLVED" | "CANCELLED", reconciliationStatus: "ACTIVE" | "UNDONE" = "ACTIVE") {
  let record = {
    ...fixtures[0],
    reconciliationId: "reconciliation-active",
    status: initialStatus,
    reconciliation: { ...baseReconciliation, status: reconciliationStatus },
  } as any;
  const events: any[] = [];
  const transactionOptions: any[] = [];
  const database = {
    $transaction: async <T>(operation: (tx: any) => Promise<T>, options: unknown): Promise<T> => {
      transactionOptions.push(options);
      return operation({
        consignadoBankOtherDifference: {
          updateMany: async (args: any) => {
            if (record.status !== "OPEN" || record.reconciliation.status !== "ACTIVE") return { count: 0 };
            record = { ...record, ...args.data };
            return { count: 1 };
          },
          findUnique: async () => record,
        },
        consignadoStatusEvent: {
          create: async (args: any) => { events.push(args.data); return args.data; },
        },
      });
    },
  };
  return { database, events, transactionOptions, record: () => record };
}

test("resolução é atômica, auditada e idempotente sob tentativa repetida", async () => {
  const state = createResolutionDatabase("OPEN");
  const now = new Date("2026-08-21T18:00:00.000Z");
  const first = await resolveOtherDifferenceWithDependencies("open-fee", "user-caio", " Confirmado pelo banco ", {
    database: state.database,
    now: () => now,
  });
  assert.equal(first.status, "RESOLVED");
  assert.equal(state.record().resolutionNote, "Confirmado pelo banco");
  assert.deepEqual(state.events, [{
    userId: "user-caio",
    entityType: "BANK_OTHER_DIFFERENCE",
    entityId: "open-fee",
    fromStatus: "OPEN",
    toStatus: "RESOLVED",
    metadata: {
      reconciliationId: "reconciliation-active",
      category: "BANK_FEE",
      direction: "ENTRY_EXCESS",
      amount: "25.10",
      resolutionNote: "Confirmado pelo banco",
    },
  }]);
  assert.deepEqual(state.transactionOptions, [{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }]);

  await assert.rejects(
    resolveOtherDifferenceWithDependencies("open-fee", "user-caio", "Confirmado pelo banco", { database: state.database, now: () => now }),
    (error: unknown) => error instanceof DifferenceReportConflictError && /já foi resolvida/.test(error.message),
  );
  assert.equal(state.events.length, 1);
});

test("registro cancelado ou OPEN de conciliação desfeita permanece histórico e não pode resolver", async () => {
  for (const [status, reconciliationStatus, message] of [
    ["CANCELLED", "UNDONE", /cancelada/],
    ["OPEN", "UNDONE", /conciliação não está ativa/],
  ] as const) {
    const state = createResolutionDatabase(status, reconciliationStatus);
    await assert.rejects(
      resolveOtherDifferenceWithDependencies("open-fee", "user-caio", "Confirmação válida", { database: state.database, now: () => new Date() }),
      (error: unknown) => error instanceof DifferenceReportConflictError && message.test(error.message),
    );
    assert.equal(state.events.length, 0);
  }
});

test("boundaries usam permissões exatas, cache privado e política de erros públicos", async () => {
  const checked: string[] = [];
  const check = async (permission: string) => { checked.push(permission); return true; };
  assert.deepEqual(await resolveDifferenceReportAccess(null, "view", check), { status: 401, message: "Sessão expirada." });
  assert.deepEqual(checked, []);
  assert.equal(await resolveDifferenceReportAccess("user-1", "view", check), null);
  assert.equal(await resolveDifferenceReportAccess("user-1", "manage", check), null);
  assert.deepEqual(checked, ["operational.view", "operational.manage"]);
  assert.equal(DIFFERENCE_REPORT_CACHE_CONTROL, "private, no-store, max-age=0");
  assert.deepEqual(classifyDifferenceReportError(new DifferenceReportInputError("Filtro inválido.")), { status: 400, message: "Filtro inválido.", internal: false });
  assert.deepEqual(classifyDifferenceReportError(new DifferenceReportConflictError("Registro alterado.")), { status: 409, message: "Registro alterado.", internal: false });
  assert.deepEqual(classifyDifferenceReportError(new DifferenceReportLimitError("Restrinja os filtros.")), { status: 422, message: "Restrinja os filtros.", internal: false });
  assert.deepEqual(classifyDifferenceReportError(new Error("database secret")), { status: 500, message: "Erro interno ao processar diferenças bancárias.", internal: true });
});

test("badge agrega somente OPEN de conciliações ACTIVE sem varrer detalhes", async () => {
  const calls: any[] = [];
  const overview = await getOpenDifferenceOverviewWithDependencies({
    consignadoBankOtherDifference: {
      aggregate: async (args: any) => {
        calls.push(args);
        return { _count: { _all: 3 }, _sum: { amount: new Prisma.Decimal("30.30") } };
      },
    },
  });
  assert.deepEqual(overview, { count: 3, amount: "30.30" });
  assert.deepEqual(calls, [{
    where: { status: "OPEN", reconciliation: { status: "ACTIVE" } },
    _count: { _all: true },
    _sum: { amount: true },
  }]);
});

test("carregamento inicial recupera erro público, remove cursor e propaga falha interna", async () => {
  let calls = 0;
  const invalid = await loadInitialDifferenceReport(new URLSearchParams({ limit: "999" }), async () => {
    calls += 1;
    throw new Error("não deveria consultar");
  });
  assert.equal(calls, 0);
  assert.deepEqual(invalid, {
    kind: "recoverable",
    report: null,
    filters: { limit: 50 },
    message: "Limite inválido. Informe um inteiro entre 1 e 100.",
  });

  const limited = await loadInitialDifferenceReport(
    new URLSearchParams({ category: "BANK_FEE", cursor: "open-fee", limit: "25" }),
    async () => { throw new DifferenceReportLimitError("Consulta ampla demais."); },
  );
  assert.deepEqual(limited, {
    kind: "recoverable",
    report: null,
    filters: { category: "BANK_FEE", limit: 25 },
    message: "Consulta ampla demais.",
  });

  const internal = new Error("database connection details");
  await assert.rejects(
    loadInitialDifferenceReport(new URLSearchParams(), async () => { throw internal; }),
    (error) => error === internal,
  );
});
