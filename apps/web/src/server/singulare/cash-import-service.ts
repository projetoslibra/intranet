import { prisma } from "@/lib/prisma";
import {
  getSingulareApiToken,
  getSingulareDemonstrativoCaixa,
} from "@/server/singulare/client";
import {
  getMostRecentBusinessDate,
  parseDateOnly,
  toDateKey,
} from "@/server/singulare/date-utils";
import { transformSingulareCaixa } from "@/server/singulare/cash-transform";
import type {
  CaixaSingulareInput,
  SingulareCaixaImportResult,
} from "@/server/singulare/types";

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

async function replaceCaixaSingulare(rows: CaixaSingulareInput[], dataAnalise: Date) {
  await prisma.$transaction([
    prisma.caixaSingulare.deleteMany({
      where: { dataAnalise },
    }),
    ...(rows.length > 0
      ? [
          prisma.caixaSingulare.createMany({
            data: rows,
          }),
        ]
      : []),
  ]);

  return rows.length;
}

export async function importSingulareCaixa(
  dataAnaliseInput?: string
): Promise<SingulareCaixaImportResult> {
  const dataAnalise = resolveDataAnalise(dataAnaliseInput);
  const dataAnaliseKey = toDateKey(dataAnalise);
  const apiToken = await getSingulareApiToken();
  const records = await getSingulareDemonstrativoCaixa(apiToken, dataAnaliseKey);

  if (!records) {
    return {
      dataAnalise: dataAnaliseKey,
      fetchedRows: 0,
      importedRows: 0,
      skippedRows: 0,
    };
  }

  const { rows, skippedRows } = transformSingulareCaixa(records, dataAnalise);
  const importedRows = await replaceCaixaSingulare(rows, dataAnalise);

  return {
    dataAnalise: dataAnaliseKey,
    fetchedRows: records.length,
    importedRows,
    skippedRows,
  };
}
