import { Prisma } from "@prisma/client";
import { parseDateOnly } from "@/server/singulare/date-utils";
import type {
  CaixaSingulareInput,
  SingulareReportRecord,
} from "@/server/singulare/types";

function valueAsString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return String(value).trim() || null;
}

function valueAsInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function decimal(value: unknown): Prisma.Decimal {
  if (value === null || value === undefined || value === "") {
    return new Prisma.Decimal(0);
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return new Prisma.Decimal(value.toString());
  }

  const text = String(value).trim().replace(",", ".");
  try {
    return new Prisma.Decimal(text);
  } catch {
    return new Prisma.Decimal(0);
  }
}

export function transformSingulareCaixa(
  records: SingulareReportRecord[],
  dataAnalise: Date
): { rows: CaixaSingulareInput[]; skippedRows: number } {
  const rows: CaixaSingulareInput[] = [];
  let skippedRows = 0;

  for (const record of records) {
    const dataLiquidacao = parseDateOnly(
      valueAsString(record.dataLiquidação) ??
        valueAsString(record.dataLiquidacao) ??
        ""
    );
    const tipoDeRegistro = valueAsInt(record.tipoDeRegistro);
    const descricao = valueAsString(record.descrição) ?? valueAsString(record.descricao);
    const clienteNome = valueAsString(record.clienteNome);
    const clienteId = valueAsString(record.clienteId);

    if (!dataLiquidacao || tipoDeRegistro === null || !descricao || !clienteNome || !clienteId) {
      skippedRows += 1;
      continue;
    }

    rows.push({
      dataLiquidacao,
      tipoDeRegistro,
      descricao,
      entradas: decimal(record.entradas),
      saidas: decimal(record.saídas ?? record.saidas),
      saldo: decimal(record.saldo),
      historicoTraduzido: valueAsString(record.históricoTraduzido) ?? valueAsString(record.historicoTraduzido),
      idConta: valueAsInt(record.idConta),
      banco: valueAsString(record.banco),
      agencia: valueAsString(record.agencia),
      contaCorrente: valueAsString(record.contaCorrente),
      digito: valueAsString(record.digito),
      contaInvestimento: valueAsString(record.contaInvestimento),
      cpfDoCliente: valueAsString(record.cpfDoCliente),
      clienteNome,
      clienteId,
      dataAnalise,
    });
  }

  return { rows, skippedRows };
}
