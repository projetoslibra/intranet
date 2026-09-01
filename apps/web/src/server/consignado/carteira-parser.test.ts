import assert from "node:assert/strict";
import test from "node:test";
import { parseConsignadoCarteira } from "./carteira-parser";

function sourceRow(input: {
  line: string;
  title: string;
  value: string;
  accountCode: string;
  shares?: string;
  quota?: string;
}) {
  const fields = Array.from({ length: 70 }, () => "");
  fields[0] = input.line;
  fields[1] = "LayCrtDiaDespRef";
  fields[2] = "V";
  fields[3] = "8866872";
  fields[10] = "25/08/2026";
  fields[11] = input.title;
  fields[18] = input.value;
  fields[27] = input.shares ?? "0";
  fields[28] = input.quota ?? "0";
  fields[29] = "0";
  fields[30] = "0";
  fields[31] = "0";
  fields[51] = input.accountCode;
  return fields.join(";");
}

test("classifica a conta 23703 de IR como outras despesas", () => {
  const csv = [
    sourceRow({ line: "16", title: "IR", value: "2827,78", accountCode: "23703" }),
    sourceRow({
      line: "24",
      title: "PATLIQ",
      value: "100,00",
      accountCode: "26000",
      shares: "10",
      quota: "10",
    }),
  ].join("\n");

  const parsed = parseConsignadoCarteira(Buffer.from(csv, "utf8"));
  const incomeTax = parsed.rows.find((row) => row.ativo === "Despesa - Imposto de Renda - IR");

  assert.ok(incomeTax);
  assert.equal(incomeTax.valor.toString(), "-2827.78");
});
