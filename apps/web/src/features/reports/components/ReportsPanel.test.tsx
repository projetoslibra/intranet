import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReportAvailability } from "@/server/reports/report-data";
import { ReportsPanel } from "./ReportsPanel";

const availability: ReportAvailability = {
  stock: [{ fund: "APUAMA LIBRA FIDC", dates: [{ date: "2026-09-30", periods: [] }] }],
  settled: [{ fund: "BRISTOL FIDC MULTISSETORIAL", dates: [{ date: "2026-09-30", periods: [] }] }],
  "open-movements": [{ fund: "APUAMA LIBRA FIDC", dates: [{ date: "2026-09-30", periods: ["MANHA", "TARDE"] }] }],
};

test("painel apresenta os três relatórios e começa sem exportação incompleta", () => {
  const html = renderToStaticMarkup(<ReportsPanel availability={availability} canExport />);

  assert.match(html, /Estoque/);
  assert.match(html, /Liquidados/);
  assert.match(html, /Movimentos em aberto/);
  assert.match(html, /APUAMA LIBRA FIDC/);
  assert.match(html, /Selecione o fundo/);
  assert.doesNotMatch(html, /href="\/api\/relatorios/);
});

test("painel explica quando o usuário pode visualizar mas não exportar", () => {
  const html = renderToStaticMarkup(<ReportsPanel availability={availability} canExport={false} />);

  assert.match(html, /Seu acesso permite visualizar os relatórios, mas não exportá-los/);
});
