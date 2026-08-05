import { Prisma } from "@prisma/client";

const CONSIGNADO_CLASS_CODE = "8866872";
const CONSIGNADO_FUND_LABEL = "CONSIGNADO";
const MIN_COLUMN_COUNT = 53;

type ParsedSourceRow = {
  positionDate: Date;
  title: string;
  value: Prisma.Decimal;
  accountCode: string;
  fields: string[];
};

export type ConsignadoCarteiraRow = {
  dataPosicao: Date;
  ativo: string;
  valor: Prisma.Decimal;
  fundo: string;
  dataAnalise: Date;
};

export type ParsedConsignadoCarteira = {
  referenceDate: Date;
  rows: ConsignadoCarteiraRow[];
  sourceRows: number;
  skippedRows: number;
  netAssetValue: Prisma.Decimal;
  sharesQuantity: Prisma.Decimal;
  quotaValue: Prisma.Decimal;
};

function decodeCsv(buffer: Buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString("utf8");
  }

  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("\uFFFD")) {
    return utf8;
  }

  return new TextDecoder("windows-1252").decode(buffer);
}

function parseBrazilianDate(value: string): Date | null {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return null;
  }

  const date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDecimal(value: string, fieldName: string): Prisma.Decimal {
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  if (!normalized) {
    throw new Error(`O campo ${fieldName} está vazio.`);
  }

  try {
    return new Prisma.Decimal(normalized);
  } catch {
    throw new Error(`Valor inválido em ${fieldName}: ${value}.`);
  }
}

function negativeMagnitude(value: Prisma.Decimal) {
  return value.abs().negated();
}

function canonicalAsset(row: ParsedSourceRow): { name: string; value: Prisma.Decimal } | null {
  const title = row.title || row.accountCode;

  switch (row.accountCode) {
    case "10108":
      return { name: `Conciliação - ${title}`, value: row.value };
    case "10405":
      return { name: "Conciliação - Valores a Receber", value: row.value };
    case "11701":
      return { name: "Cotas Sênior", value: negativeMagnitude(row.value) };
    case "11703":
      return { name: "Cotas Mezanino", value: negativeMagnitude(row.value) };
    case "11902":
      return { name: "PDD - Direitos Creditórios", value: negativeMagnitude(row.value) };
    case "13290":
      return { name: "Direitos Creditórios a Vencer - Com Coobrigação", value: row.value };
    case "13390":
      return { name: "Direitos Creditórios Vencidos - Com Coobrigação", value: row.value };
    case "13490":
      return { name: "Direitos Creditórios a Vencer - Sem Coobrigação", value: row.value };
    case "13590":
      return { name: "Direitos Creditórios Vencidos - Sem Coobrigação", value: row.value };
    case "15805":
      return { name: `Fundo de Renda Fixa - ${title}`, value: row.value };
    case "19709":
      return { name: `Diferimento - ${title}`, value: row.value };
    case "23015":
      return {
        name: "Conciliação - Direitos Creditórios a Identificar",
        value: negativeMagnitude(row.value),
      };
    case "23701":
      return { name: `Auditoria - ${title}`, value: negativeMagnitude(row.value) };
    case "23702":
      return { name: `Taxa de Administração - ${title}`, value: negativeMagnitude(row.value) };
    case "23711":
      return { name: `Taxa de Gestão - ${title}`, value: negativeMagnitude(row.value) };
    case "23719":
      return { name: `Taxa de Custódia - ${title}`, value: negativeMagnitude(row.value) };
    case "23726":
    case "23753":
      return { name: `Consultoria - ${title}`, value: negativeMagnitude(row.value) };
    case "23741":
      return { name: `Despesa - Serviços de Estruturação - ${title}`, value: negativeMagnitude(row.value) };
    case "23750":
      return { name: `Serviços de Cobrança - ${title}`, value: negativeMagnitude(row.value) };
    case "24005":
      return { name: `Despesa - Ajuste de Cota Devedor - ${title}`, value: negativeMagnitude(row.value) };
    case "24010":
      return { name: `IOF - ${title}`, value: negativeMagnitude(row.value) };
    case "26000":
      return null;
    default:
      throw new Error(`Conta contábil não mapeada no arquivo: ${row.accountCode} (${title}).`);
  }
}

function portfolioRow(
  referenceDate: Date,
  ativo: string,
  valor: Prisma.Decimal
): ConsignadoCarteiraRow {
  return {
    dataPosicao: referenceDate,
    ativo,
    valor,
    fundo: CONSIGNADO_FUND_LABEL,
    dataAnalise: referenceDate,
  };
}

export function parseConsignadoCarteira(buffer: Buffer): ParsedConsignadoCarteira {
  const lines = decodeCsv(buffer)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error("O CSV está vazio.");
  }

  const parsedRows: ParsedSourceRow[] = [];
  let skippedRows = 0;

  for (const line of lines) {
    const fields = line.split(";");
    if (fields.length < MIN_COLUMN_COUNT) {
      skippedRows += 1;
      continue;
    }

    if (fields[1]?.trim() !== "LayCrtDiaDespRef" || fields[2]?.trim() !== "V") {
      skippedRows += 1;
      continue;
    }

    if (fields[3]?.trim() !== CONSIGNADO_CLASS_CODE) {
      skippedRows += 1;
      continue;
    }

    const positionDate = parseBrazilianDate(fields[10] ?? "");
    if (!positionDate) {
      throw new Error(`Data de posição inválida no CSV: ${fields[10] ?? "vazia"}.`);
    }

    parsedRows.push({
      positionDate,
      title: fields[11]?.trim() ?? "",
      value: parseDecimal(fields[18] ?? "", `saldo da linha ${fields[0] ?? "?"}`),
      accountCode: fields[51]?.trim() ?? "",
      fields,
    });
  }

  if (parsedRows.length === 0) {
    throw new Error(
      "O arquivo não possui o fechamento da classe subordinada 8866872 do FIDC Libra Consignado."
    );
  }

  const referenceDate = parsedRows[0].positionDate;
  if (parsedRows.some((row) => row.positionDate.getTime() !== referenceDate.getTime())) {
    throw new Error("O arquivo contém mais de uma data de posição para a classe subordinada.");
  }

  const netAssetRow = parsedRows.find((row) => row.accountCode === "26000" && row.title === "PATLIQ");
  if (!netAssetRow) {
    throw new Error("O arquivo não contém a linha PATLIQ do patrimônio subordinado.");
  }

  const sharesQuantity = parseDecimal(netAssetRow.fields[27] ?? "", "quantidade de cotas");
  const quotaValue = parseDecimal(netAssetRow.fields[28] ?? "", "valor da cota");
  const dailyReturn = parseDecimal(netAssetRow.fields[29] ?? "", "rentabilidade diária");
  const monthReturn = parseDecimal(netAssetRow.fields[30] ?? "", "rentabilidade mensal");
  const yearReturn = parseDecimal(netAssetRow.fields[31] ?? "", "rentabilidade anual");
  const calculatedNetAssetValue = sharesQuantity.mul(quotaValue);

  if (calculatedNetAssetValue.sub(netAssetRow.value).abs().greaterThan(1)) {
    throw new Error(
      "O patrimônio não confere com quantidade de cotas × valor da cota. Confira o arquivo antes de importar."
    );
  }

  const rows = parsedRows.flatMap((row) => {
    const mapped = canonicalAsset(row);
    return mapped ? [portfolioRow(referenceDate, mapped.name, mapped.value)] : [];
  });

  rows.push(
    portfolioRow(referenceDate, "Patrimônio", netAssetRow.value),
    portfolioRow(referenceDate, "Quantidade de Cotas", sharesQuantity),
    portfolioRow(referenceDate, "Valor da Cota", quotaValue),
    portfolioRow(referenceDate, "Variação Diária", dailyReturn),
    portfolioRow(referenceDate, "Variação Mensal", monthReturn),
    portfolioRow(referenceDate, "Variação Anual", yearReturn)
  );

  return {
    referenceDate,
    rows,
    sourceRows: parsedRows.length,
    skippedRows,
    netAssetValue: netAssetRow.value,
    sharesQuantity,
    quotaValue,
  };
}

