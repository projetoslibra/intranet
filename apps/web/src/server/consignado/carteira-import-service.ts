import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { parseConsignadoCarteira } from "@/server/consignado/carteira-parser";

type ImportUser = {
  id: string;
};

export type ConsignadoCarteiraImportResult = {
  batchId: string;
  referenceDate: string;
  importedRows: number;
  sourceRows: number;
  skippedRows: number;
  netAssetValue: string;
  sharesQuantity: string;
  quotaValue: string;
};

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

async function findConsignadoFund() {
  const fund = await prisma.fund.findFirst({
    where: {
      OR: [
        { name: { contains: "CONSIGNADO", mode: "insensitive" } },
        { shortName: { contains: "CONSIGNADO", mode: "insensitive" } },
        { cnpj: "54.842.157/0001-93" },
      ],
    },
    select: { id: true },
  });

  if (!fund) {
    throw new Error("O fundo Consignado não está cadastrado no OSHER.");
  }

  return fund;
}

export async function importConsignadoCarteira(input: {
  buffer: Buffer;
  fileName: string;
  user: ImportUser;
  source?: string;
}): Promise<ConsignadoCarteiraImportResult> {
  const parsed = parseConsignadoCarteira(input.buffer);
  const fund = await findConsignadoFund();
  const fileHash = createHash("sha256").update(input.buffer).digest("hex");
  const batch = await prisma.importBatch.create({
    data: {
      importedByUserId: input.user.id,
      module: "DRE",
      fileName: input.fileName,
      fileHash,
      source: input.source ?? "Sinqia - upload carteira Consignado",
      referenceDate: parsed.referenceDate,
      fundId: fund.id,
      status: "PROCESSING",
      totalRows: parsed.sourceRows,
    },
    select: { id: true },
  });

  try {
    await prisma.$transaction([
      prisma.carteira.deleteMany({
        where: {
          fundo: "CONSIGNADO",
          dataAnalise: parsed.referenceDate,
        },
      }),
      prisma.carteira.createMany({ data: parsed.rows }),
      prisma.importBatch.update({
        where: { id: batch.id },
        data: {
          status: "COMPLETED",
          importedRows: parsed.rows.length,
          errorRows: 0,
          completedAt: new Date(),
        },
      }),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido.";
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        status: "FAILED",
        errorMessage: message,
        completedAt: new Date(),
      },
    });
    throw error;
  }

  return {
    batchId: batch.id,
    referenceDate: dateKey(parsed.referenceDate),
    importedRows: parsed.rows.length,
    sourceRows: parsed.sourceRows,
    skippedRows: parsed.skippedRows,
    netAssetValue: parsed.netAssetValue.toFixed(2),
    sharesQuantity: parsed.sharesQuantity.toString(),
    quotaValue: parsed.quotaValue.toString(),
  };
}
