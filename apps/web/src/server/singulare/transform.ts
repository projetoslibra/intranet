import { Prisma } from "@prisma/client";
import { parseDateOnly } from "@/server/singulare/date-utils";
import type {
  CarteiraConsolidadaInput,
  SingulareFundConfig,
  SingulareReportRecord,
  SingulareReportSections,
} from "@/server/singulare/types";

type SectionMapping = {
  dateKeys: string[];
  assetKeys: string[];
  valueKeys: string[];
};

const sectionMappings: Record<string, SectionMapping> = {
  "outros-fundos": {
    dateKeys: ["dataDaPosição", "dataDaPosicao"],
    assetKeys: ["fundo"],
    valueKeys: ["valorLíquido", "valorLiquido"],
  },
  rf: {
    dateKeys: ["dataDaPosição", "dataDaPosicao"],
    assetKeys: ["nomeDoPapel"],
    valueKeys: ["valorLíquido", "valorLiquido"],
  },
  cpr: {
    dateKeys: ["dataDaPosição", "dataDaPosicao"],
    assetKeys: ["descrição", "descricao"],
    valueKeys: ["valor"],
  },
  tesouraria: {
    dateKeys: ["dataDaPosição", "dataDaPosicao"],
    assetKeys: ["descrição", "descricao"],
    valueKeys: ["valor"],
  },
  "conta-corrente": {
    dateKeys: ["dataDaPosição", "dataDaPosicao"],
    assetKeys: ["código", "codigo"],
    valueKeys: ["valorTotal"],
  },
  "outros-ativos": {
    dateKeys: ["dataDaPosição", "dataDaPosicao"],
    assetKeys: ["descrição", "descricao"],
    valueKeys: ["valorTotal"],
  },
};

const mecRows = [
  { ativo: "Patrimônio", valueKeys: ["patrimonio"] },
  { ativo: "Variação Diária", valueKeys: ["variaçãoDiaria", "variacaoDiaria"] },
  { ativo: "Variação Mensal", valueKeys: ["variaçãoMensal", "variacaoMensal"] },
  { ativo: "Variação Anual", valueKeys: ["variaçãoAnual", "variacaoAnual"] },
] as const;

function firstValue(record: SingulareReportRecord, keys: readonly string[]) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== "") {
      return record[key];
    }
  }

  return null;
}

function parseDecimal(value: unknown): Prisma.Decimal | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (Prisma.Decimal.isDecimal(value)) {
    return value;
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return new Prisma.Decimal(value.toString());
  }

  const originalText = String(value).trim();
  if (!originalText) {
    return null;
  }

  let text = originalText.replace("%", "").replace("R$", "").trim();
  text = text.replace(/[^\d,.-]/g, "");

  if (!text || text === "-" || text === "." || text === ",") {
    return null;
  }

  if (text.includes(",") && text.includes(".")) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (text.includes(",")) {
    text = text.replace(",", ".");
  }

  try {
    return new Prisma.Decimal(text);
  } catch {
    console.warn(`[Singulare] valor decimal inválido ignorado: ${originalText}`);
    return null;
  }
}

function parseAsset(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const asset = String(value).trim();
  return asset ? asset : null;
}

function buildRow(
  dataPosicao: Date | null,
  ativo: string | null,
  valor: Prisma.Decimal | null,
  fund: SingulareFundConfig,
  dataAnalise: Date
): CarteiraConsolidadaInput | null {
  if (!dataPosicao || !ativo || !valor) {
    return null;
  }

  return {
    dataPosicao,
    ativo,
    valor,
    fundo: fund.label,
    dataAnalise,
  };
}

export function transformSingulareCarteira(
  sections: SingulareReportSections,
  fund: SingulareFundConfig,
  dataAnalise: Date
): { rows: CarteiraConsolidadaInput[]; skippedRows: number } {
  const rows: CarteiraConsolidadaInput[] = [];
  let skippedRows = 0;

  for (const [sectionName, mapping] of Object.entries(sectionMappings)) {
    const records = sections[sectionName] ?? [];

    for (const record of records) {
      const row = buildRow(
        parseDateOnly(String(firstValue(record, mapping.dateKeys) ?? "")),
        parseAsset(firstValue(record, mapping.assetKeys)),
        parseDecimal(firstValue(record, mapping.valueKeys)),
        fund,
        dataAnalise
      );

      if (row) {
        rows.push(row);
      } else {
        skippedRows += 1;
      }
    }
  }

  const mec = sections.mec?.[0];
  if (mec) {
    const dataPosicao = parseDateOnly(
      String(firstValue(mec, ["dataDaPosição", "dataDaPosicao"]) ?? "")
    );

    for (const mecRow of mecRows) {
      const row = buildRow(
        dataPosicao,
        mecRow.ativo,
        parseDecimal(firstValue(mec, mecRow.valueKeys)),
        fund,
        dataAnalise
      );

      if (row) {
        rows.push(row);
      } else {
        skippedRows += 1;
      }
    }
  }

  return { rows, skippedRows };
}
