import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { buildStockConcentrations } from "./data";

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
