import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { createReportExportHandler, REPORT_EXPORT_CACHE_CONTROL } from "./report-http";

function request(query = "") {
  return new NextRequest(`https://osher.test/api/relatorios/export${query}`);
}

test("exportação exige sessão antes de consultar permissão ou banco", async () => {
  let permissionChecks = 0;
  let loads = 0;
  const handler = createReportExportHandler("stock", {
    authenticate: async () => null,
    checkPermission: async () => { permissionChecks += 1; return true; },
    loadRows: async () => { loads += 1; return []; },
    buildWorkbook: () => Buffer.from("xlsx"),
  });

  const response = await handler(request("?fund=APUAMA&date=2026-09-30"));

  assert.equal(response.status, 401);
  assert.equal(await response.text(), "Sessão expirada.");
  assert.equal(permissionChecks, 0);
  assert.equal(loads, 0);
  assert.equal(response.headers.get("cache-control"), REPORT_EXPORT_CACHE_CONTROL);
});

test("exportação exige reports.export", async () => {
  let permission = "";
  const handler = createReportExportHandler("settled", {
    authenticate: async () => ({ user: { id: "user-1" } }),
    checkPermission: async (received) => { permission = received; return false; },
    loadRows: async () => [],
    buildWorkbook: () => Buffer.from("xlsx"),
  });

  const response = await handler(request("?fund=BRISTOL&date=2026-09-30"));

  assert.equal(response.status, 403);
  assert.equal(permission, "reports.export");
  assert.equal(await response.text(), "Sem permissão para exportar relatórios.");
});

test("filtro inválido retorna erro público sem consultar dados", async () => {
  let loads = 0;
  const handler = createReportExportHandler("open-movements", {
    authenticate: async () => ({ user: { id: "user-1" } }),
    checkPermission: async () => true,
    loadRows: async () => { loads += 1; return []; },
    buildWorkbook: () => Buffer.from("xlsx"),
  });

  const response = await handler(request("?fund=APUAMA&date=2026-09-30"));

  assert.equal(response.status, 400);
  assert.equal(await response.text(), "Selecione o período Manhã ou Tarde.");
  assert.equal(loads, 0);
});

test("resposta Excel usa filtros validados e nome de arquivo seguro", async () => {
  let received: unknown;
  const handler = createReportExportHandler("open-movements", {
    authenticate: async () => ({ user: { id: "user-1" } }),
    checkPermission: async () => true,
    loadRows: async (_type, filters) => { received = filters; return [{ periodo: "MANHA" }]; },
    buildWorkbook: () => Buffer.from([80, 75, 3, 4]),
  });

  const response = await handler(request("?fund=APUAMA%20LIBRA%20FIDC&date=2026-09-30&period=manha"));

  assert.equal(response.status, 200);
  assert.deepEqual(received, { fund: "APUAMA LIBRA FIDC", date: "2026-09-30", period: "MANHA" });
  assert.equal(response.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="movimentos-em-aberto-apuama-libra-fidc-2026-09-30-manha.xlsx"');
  assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), [80, 75, 3, 4]);
});

test("falha interna não expõe detalhes do banco", async () => {
  const handler = createReportExportHandler("stock", {
    authenticate: async () => ({ user: { id: "user-1" } }),
    checkPermission: async () => true,
    loadRows: async () => { throw new Error("postgresql://segredo"); },
    buildWorkbook: () => Buffer.from("xlsx"),
    logError: () => undefined,
  });

  const response = await handler(request("?fund=APUAMA&date=2026-09-30"));

  assert.equal(response.status, 500);
  assert.equal(await response.text(), "Erro interno ao gerar o relatório.");
});
