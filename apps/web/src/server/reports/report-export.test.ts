import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import {
  ReportExportInputError,
  buildReportWorkbook,
  parseReportExportFilters,
  resolveReportExportAccess,
} from "./report-export";

test("valida fundo e data nos relatórios de estoque e liquidados", () => {
  assert.deepEqual(
    parseReportExportFilters("stock", new URLSearchParams({ fund: " APUAMA LIBRA FIDC ", date: "2026-09-30" })),
    { fund: "APUAMA LIBRA FIDC", date: "2026-09-30" },
  );
  assert.deepEqual(
    parseReportExportFilters("settled", new URLSearchParams({ fund: "BRISTOL FIDC MULTISSETORIAL", date: "2026-02-28" })),
    { fund: "BRISTOL FIDC MULTISSETORIAL", date: "2026-02-28" },
  );

  assert.throws(
    () => parseReportExportFilters("stock", new URLSearchParams({ fund: "APUAMA", date: "2026-02-30" })),
    (error) => error instanceof ReportExportInputError && error.message === "Informe uma data válida.",
  );
  assert.throws(
    () => parseReportExportFilters("settled", new URLSearchParams({ date: "2026-09-30" })),
    (error) => error instanceof ReportExportInputError && error.message === "Selecione um fundo.",
  );
});

test("movimentos em aberto exige período manhã ou tarde", () => {
  assert.deepEqual(
    parseReportExportFilters("open-movements", new URLSearchParams({ fund: "APUAMA", date: "2026-09-30", period: "tarde" })),
    { fund: "APUAMA", date: "2026-09-30", period: "TARDE" },
  );
  assert.throws(
    () => parseReportExportFilters("open-movements", new URLSearchParams({ fund: "APUAMA", date: "2026-09-30", period: "noite" })),
    (error) => error instanceof ReportExportInputError && error.message === "Selecione o período Manhã ou Tarde.",
  );
});

test("Excel de estoque contém apenas colunas de negócio e preserva tipos", () => {
  const workbookBuffer = buildReportWorkbook("stock", [{
    id: "tecnico",
    nomeFundo: "APUAMA LIBRA FIDC",
    docFundo: "00.000.000/0001-00",
    dataFundo: new Date("2026-09-30T00:00:00.000Z"),
    nomeGestor: "Gestora",
    docGestor: null,
    nomeOriginador: "Originador",
    docOriginador: null,
    nomeCedente: "Cedente",
    docCedente: "123",
    nomeSacado: "Sacado",
    docSacado: "456",
    seuNumero: "SEU-1",
    numeroDocumento: "DOC-1",
    tipoRecebivel: "Duplicata",
    valorNominal: new Prisma.Decimal("1234.56"),
    valorPresente: new Prisma.Decimal("1200.12"),
    valorAquisicao: new Prisma.Decimal("1190.10"),
    valorPdd: new Prisma.Decimal("10.02"),
    faixaPdd: "A",
    dataReferencia: new Date("2026-09-30T00:00:00.000Z"),
    dataVencimentoOriginal: new Date("2026-10-15T00:00:00.000Z"),
    dataVencimentoAjustada: null,
    dataEmissao: new Date("2026-09-01T00:00:00.000Z"),
    dataAquisicao: new Date("2026-09-02T00:00:00.000Z"),
    prazo: 44,
    prazoAnual: 365,
    situacaoRecebivel: "Em aberto",
    taxaCessao: new Prisma.Decimal("0.015"),
    taxaRecebivel: new Prisma.Decimal("0.02"),
    coobrigacao: "Sim",
    createdAt: new Date("2026-09-30T12:00:00.000Z"),
  }]);

  const workbook = XLSX.read(workbookBuffer, { type: "buffer", cellNF: true });
  assert.deepEqual(workbook.SheetNames, ["Estoque"]);
  const sheet = workbook.Sheets.Estoque;
  const rows = XLSX.utils.sheet_to_json<Array<string | number>>(sheet, { header: 1, raw: true });

  assert.equal(rows[0]?.[0], "Fundo");
  assert.equal(rows[0]?.includes("ID"), false);
  assert.equal(rows[0]?.includes("Criado em"), false);
  assert.equal(rows[1]?.[0], "APUAMA LIBRA FIDC");
  assert.equal(typeof rows[1]?.[2], "number");
  assert.equal(typeof rows[1]?.[14], "number");
  assert.equal(sheet.C2.z, "dd/mm/yyyy");
  assert.equal(sheet.O2.z, "#,##0.00");
  assert.deepEqual(sheet["!autofilter"], { ref: sheet["!ref"] });
});

test("Excel de liquidados organiza posição, valores e movimento", () => {
  const workbook = XLSX.read(buildReportWorkbook("settled", [{
    fundoNome: "BRISTOL FIDC MULTISSETORIAL",
    fundoCnpj: null,
    dataDaPosicao: new Date("2026-09-30T00:00:00.000Z"),
    cedente: "Cedente",
    identificacaoCedente: "123",
    sacado: "Sacado",
    identificacaoSacado: "456",
    txAquisicao: new Prisma.Decimal("0.01"),
    idRecebivel: "REC-1",
    valorAquisicao: new Prisma.Decimal("100"),
    valorVencimento: new Prisma.Decimal("110"),
    dataAquisicao: null,
    dataVencimento: new Date("2026-10-01T00:00:00.000Z"),
    valorPago: new Prisma.Decimal("105"),
    stRecebivel: "Liquidado",
    ajuste: new Prisma.Decimal("5"),
    numeroCorrespondente: null,
    seuNumero: null,
    documento: "DOC-2",
    tipoRecebivel: "Duplicata",
    tipoMovimento: "LIQUIDACAO",
  }]), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Array<string | number>>(workbook.Sheets.Liquidados, { header: 1, raw: true });

  assert.deepEqual(workbook.SheetNames, ["Liquidados"]);
  assert.equal(rows[0]?.[2], "Data da posição");
  assert.equal(rows[0]?.[20], "Tipo de movimento");
  assert.equal(rows[1]?.[20], "LIQUIDACAO");
  assert.equal(typeof rows[1]?.[9], "number");
});

test("Excel de movimentos em aberto inclui período e valores numéricos", () => {
  const workbook = XLSX.read(buildReportWorkbook("open-movements", [{
    nomeFundo: "APUAMA LIBRA FIDC",
    docFundo: null,
    dataMovimento: new Date("2026-09-30T00:00:00.000Z"),
    seuNumero: "SEU-2",
    numeroDocumento: "DOC-3",
    tipoMovimento: "AQUISICAO",
    dataVencimento: new Date("2026-11-01T00:00:00.000Z"),
    valorAquisicao: new Prisma.Decimal("200"),
    valorNominal: new Prisma.Decimal("210"),
    valorMovimentacao: new Prisma.Decimal("200"),
    dataReferencia: new Date("2026-09-30T00:00:00.000Z"),
    periodo: "MANHA",
  }]), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Array<string | number>>(workbook.Sheets["Movimentos em aberto"], { header: 1, raw: true });

  assert.equal(rows[0]?.[11], "Período");
  assert.equal(rows[1]?.[11], "Manhã");
  assert.equal(typeof rows[1]?.[7], "number");
});

test("acesso à exportação exige sessão e reports.export", async () => {
  let checked = "";
  assert.deepEqual(await resolveReportExportAccess(undefined, async () => true), { status: 401, message: "Sessão expirada." });
  assert.deepEqual(await resolveReportExportAccess("user-1", async (permission) => { checked = permission; return false; }), { status: 403, message: "Sem permissão para exportar relatórios." });
  assert.equal(checked, "reports.export");
  assert.equal(await resolveReportExportAccess("user-1", async () => true), null);
});
