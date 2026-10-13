import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { buildRiskRows, buildStockConcentrations } from "./data";

test("calcula o enquadramento pelo valor presente dos títulos", () => {
  const positions = [
    {
      nomeCedente: "Cedente A",
      docCedente: "01",
      nomeSacado: "Sacado A",
      docSacado: "02",
      valorNominal: new Prisma.Decimal("1000"),
      valorPresente: new Prisma.Decimal("800"),
    },
  ];

  const result = buildStockConcentrations(positions, 2000);

  assert.deepEqual(result.cedents, [
    { name: "Cedente A", document: "01", value: 800, share: 40 },
  ]);
  assert.deepEqual(result.debtors, [
    { name: "Sacado A", document: "02", value: 800, share: 40 },
  ]);
});

test("remove Total Geral do risco e calcula performance apenas dos cedentes", () => {
  const rows = buildRiskRows([
    { code: "Total Geral:", cedentName: "404950000", commercial: null, groupName: null, limitUsed: 300, limitAvailable: 0, overdueAmount: 20, identified: false },
    { code: "123", cedentName: "Cedente A", commercial: null, groupName: null, limitUsed: 75, limitAvailable: 10, overdueAmount: 0, identified: true },
    { code: "456", cedentName: "Cedente B", commercial: null, groupName: null, limitUsed: 25, limitAvailable: 5, overdueAmount: 0, identified: true },
    { code: null, cedentName: "Total Geral", commercial: null, groupName: null, limitUsed: 100, limitAvailable: 0, overdueAmount: 0, identified: false },
  ]);

  assert.deepEqual(rows.map((row) => [row.cedentName, row.performance]), [
    ["Cedente A", 0.75],
    ["Cedente B", 0.25],
  ]);
});
