import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSidebarCollapsedState,
  synchronizeScrollLeft,
} from "./dashboard-layout-behavior";

test("sincroniza a posição horizontal entre as barras da tabela", () => {
  const source = { scrollLeft: 376 };
  const target = { scrollLeft: 0 };

  synchronizeScrollLeft(source, target);

  assert.equal(target.scrollLeft, 376);
});

test("restaura o sidebar recolhido somente para a preferência válida", () => {
  assert.equal(parseSidebarCollapsedState("true"), true);
  assert.equal(parseSidebarCollapsedState("false"), false);
  assert.equal(parseSidebarCollapsedState(null), false);
  assert.equal(parseSidebarCollapsedState("valor-invalido"), false);
});
