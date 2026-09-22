import assert from "node:assert/strict";
import test from "node:test";
import { authorizeCronRequest, statusForVopSync } from "./route-logic";

test("recusa execução quando CRON_SECRET não está configurado", () => {
  assert.deepEqual(authorizeCronRequest(new Headers(), undefined), {
    ok: false,
    status: 500,
    message: "CRON_SECRET nao configurada no ambiente.",
  });
});

test("recusa token inválido", () => {
  assert.deepEqual(
    authorizeCronRequest(new Headers({ authorization: "Bearer errado" }), "segredo"),
    { ok: false, status: 401, message: "Token invalido para gerar snapshots de VOP." }
  );
});

test("aceita bearer token e x-osher-api-key válidos", () => {
  assert.deepEqual(
    authorizeCronRequest(new Headers({ authorization: "Bearer segredo" }), "segredo"),
    { ok: true }
  );
  assert.deepEqual(
    authorizeCronRequest(new Headers({ "x-osher-api-key": "segredo" }), "segredo"),
    { ok: true }
  );
});

test("usa 200 para sucesso total e 207 para falha parcial", () => {
  assert.equal(statusForVopSync({ ok: true, funds: [] }), 200);
  assert.equal(statusForVopSync({ ok: false, funds: [] }), 207);
});
