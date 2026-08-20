import assert from "node:assert/strict";
import test from "node:test";
import { permissionSetHas } from "./permission-keys";

test("operational.manage reconhece a chave financeira legada sem ampliar outras permissões", () => {
  assert.equal(permissionSetHas(new Set(["operational.manage"]), "operational.manage"), true);
  assert.equal(permissionSetHas(new Set(["operational.finance.manage"]), "operational.manage"), true);
  assert.equal(permissionSetHas(new Set(["operational.view"]), "operational.manage"), false);
  assert.equal(permissionSetHas(new Set(["operational.manage"]), "operational.finance.manage"), false);
});
