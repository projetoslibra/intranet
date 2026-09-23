import assert from "node:assert/strict";
import test from "node:test";
import { toVopDisplay } from "./vop-display";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

test("mostra indisponível quando nenhum snapshot foi criado", () => {
  assert.deepEqual(toVopDisplay(null), {
    dailyLabel: "Indisponível",
    monthlyLabel: "Indisponível",
    dateLabel: "Sem posição de VOP",
  });
});

test("diferencia snapshot real de valor zero de ausência de dados", () => {
  assert.deepEqual(
    toVopDisplay({
      referenceDate: new Date("2026-09-21T00:00:00.000Z"),
      dailyAmount: 0,
      monthlyAmount: 0,
    }),
    {
      dailyLabel: currency.format(0),
      monthlyLabel: currency.format(0),
      dateLabel: "Posição em 21/09/2026",
    }
  );
});

test("formata VOP diário, mensal e data da posição", () => {
  assert.deepEqual(
    toVopDisplay({
      referenceDate: new Date("2026-09-21T00:00:00.000Z"),
      dailyAmount: 123456.78,
      monthlyAmount: 987654.32,
    }),
    {
      dailyLabel: currency.format(123456.78),
      monthlyLabel: currency.format(987654.32),
      dateLabel: "Posição em 21/09/2026",
    }
  );
});
