import assert from "node:assert/strict";
import test from "node:test";
import { ExclusionReportInputError, ExclusionReportLimitError } from "./consignado-exclusion-report";
import {
  EXCLUSION_REPORT_CACHE_CONTROL,
  classifyExclusionReportError,
  exclusionReportAccessFailure,
  parseExclusionReportRequest,
  resolveExclusionReportAccess,
} from "./consignado-exclusion-report-http";

test("política de acesso distingue sessão ausente e falta de operational.view", () => {
  assert.deepEqual(exclusionReportAccessFailure(null, false), { status: 401, message: "Sessão expirada." });
  assert.deepEqual(exclusionReportAccessFailure("user-1", false), { status: 403, message: "Sem permissão." });
  assert.equal(exclusionReportAccessFailure("user-1", true), null);
});

test("boundary consulta exatamente operational.view e não avalia permissão sem sessão", async () => {
  const checked: string[] = [];
  const check = async (permission: string) => { checked.push(permission); return true; };
  assert.deepEqual(await resolveExclusionReportAccess(null, check), { status: 401, message: "Sessão expirada." });
  assert.deepEqual(checked, []);
  assert.equal(await resolveExclusionReportAccess("user-1", check), null);
  assert.deepEqual(checked, ["operational.view"]);
});

test("política de erro expõe somente falhas públicas e oculta detalhes internos", () => {
  assert.deepEqual(classifyExclusionReportError(new ExclusionReportInputError("Filtro inválido.")), { status: 400, message: "Filtro inválido.", internal: false });
  assert.deepEqual(classifyExclusionReportError(new ExclusionReportLimitError("Restrinja os filtros.")), { status: 422, message: "Restrinja os filtros.", internal: false });
  assert.deepEqual(classifyExclusionReportError(new Error("relation consignado_remittance_exclusions does not exist")), {
    status: 500,
    message: "Erro interno ao processar títulos fora da remessa.",
    internal: true,
  });
});

test("JSON e Excel compartilham parser e política de cache privada", () => {
  const filters = parseExclusionReportRequest(new URL("https://intranet.test/api?search=Jose&limit=25"));
  assert.equal(filters.search, "Jose");
  assert.equal(filters.limit, 25);
  assert.equal(EXCLUSION_REPORT_CACHE_CONTROL, "private, no-store, max-age=0");
});
