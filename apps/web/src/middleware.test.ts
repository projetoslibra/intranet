import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

test("redireciona páginas da conciliação de fundos para o financeiro", async () => {
  const request = new NextRequest(
    "https://osher.example/dashboard/operacional/financeiro/conciliacao/consignado/baixas",
  );

  const response = await middleware(request);

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "https://osher.example/dashboard/operacional/financeiro?module=archived",
  );
});

test("bloqueia APIs do módulo de conciliação arquivado", async () => {
  const request = new NextRequest(
    "https://osher.example/api/operacional/consignado/estoques",
  );

  const response = await middleware(request);

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    message: "Módulo de Conciliação de Fundos arquivado temporariamente.",
  });
});
