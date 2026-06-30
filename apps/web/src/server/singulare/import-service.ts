import { prisma } from "@/lib/prisma";
import { getSingulareApiToken, getSingulareCarteira } from "@/server/singulare/client";
import {
  getMostRecentBusinessDate,
  parseDateOnly,
  toDateKey,
} from "@/server/singulare/date-utils";
import { transformSingulareCarteira } from "@/server/singulare/transform";
import type {
  CarteiraConsolidadaInput,
  SingulareFundConfig,
  SingulareFundImportResult,
  SingulareImportResult,
} from "@/server/singulare/types";

const singularFunds: SingulareFundConfig[] = [
  { fundClassKey: "BRISTOL FIDC", label: "BRISTOL" },
  { fundClassKey: "APUAMA LIBRA", label: "APUAMA" },
];

function resolveDataAnalise(input?: string): Date {
  if (!input) {
    return getMostRecentBusinessDate();
  }

  const parsed = parseDateOnly(input);
  if (!parsed) {
    throw new Error("dataAnalise inválida. Use o formato YYYY-MM-DD.");
  }

  return parsed;
}

async function replaceCarteiras(rows: CarteiraConsolidadaInput[]) {
  if (rows.length === 0) {
    return 0;
  }

  const { dataAnalise, fundo } = rows[0];

  await prisma.$transaction([
    prisma.carteira.deleteMany({
      where: {
        dataAnalise,
        fundo,
      },
    }),
    prisma.carteira.createMany({
      data: rows,
    }),
  ]);

  return rows.length;
}

export async function importSingulareCarteiras(
  dataAnaliseInput?: string
): Promise<SingulareImportResult> {
  const dataAnalise = resolveDataAnalise(dataAnaliseInput);
  const dataAnaliseKey = toDateKey(dataAnalise);
  const apiToken = await getSingulareApiToken();
  const fundResults: SingulareFundImportResult[] = [];

  for (const fund of singularFunds) {
    try {
      const sections = await getSingulareCarteira(apiToken, fund, dataAnaliseKey);

      if (!sections) {
        fundResults.push({
          fundo: fund.label,
          fundClassKey: fund.fundClassKey,
          fetched: false,
          transformedRows: 0,
          upsertedRows: 0,
          skippedRows: 0,
          message: "Resposta ausente, inválida ou sem relatórios.",
        });
        continue;
      }

      const { rows, skippedRows } = transformSingulareCarteira(
        sections,
        fund,
        dataAnalise
      );
      const upsertedRows = await replaceCarteiras(rows);

      fundResults.push({
        fundo: fund.label,
        fundClassKey: fund.fundClassKey,
        fetched: true,
        transformedRows: rows.length,
        upsertedRows,
        skippedRows,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erro desconhecido na importação.";
      console.error(`[Singulare] importação ${fund.label} falhou: ${message}`);

      fundResults.push({
        fundo: fund.label,
        fundClassKey: fund.fundClassKey,
        fetched: false,
        transformedRows: 0,
        upsertedRows: 0,
        skippedRows: 0,
        message,
      });
    }
  }

  return {
    dataAnalise: dataAnaliseKey,
    totalRows: fundResults.reduce((total, fund) => total + fund.upsertedRows, 0),
    funds: fundResults,
  };
}
