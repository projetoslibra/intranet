import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";

const DIM_SHEET_ID = "1F4ziJnyxpLr9VuksbSvL21cjmGzoV0mDPSk7XzX72iQ";
const DIM_SHEET_NAME = "DIM_cedentes";

type SheetRow = Record<string, unknown>;

type ImportUser = {
  id: string;
};

export type OperationalImportResult = {
  batchId: string;
  importedRows: number;
  totalRows: number;
  errorRows: number;
  message: string;
  unmatchedRows?: number;
  referenceDate?: string;
  fundName?: string;
};

const SPECIAL_CEDENTS = new Set(
  [
    "UY3 SOCIEDADE DE CREDITO DIRETO S/ A",
    "MONEY PLUS SOCIEDADE DE CREDITO AO MICROEMPREENDED",
    "MONEY PLUS SOCIEDADE DE CREDITO AO MICRO",
    "BMP MONEY PLUS SOCIEDADE DE CRÉDITO DIRETO SA",
  ].map(normalizeName)
);

function normalizeName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function nullableText(value: unknown): string | null {
  const text = cleanText(value);
  return text ? text : null;
}

function onlyDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeDate(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return normalizeDate(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return normalizeDate(new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)));
    }
  }

  const text = cleanText(value);
  if (!text) {
    return null;
  }

  const brDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brDate) {
    return normalizeDate(
      new Date(Date.UTC(Number(brDate[3]), Number(brDate[2]) - 1, Number(brDate[1])))
    );
  }

  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) {
    return normalizeDate(
      new Date(Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])))
    );
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : normalizeDate(date);
}

function parseDateRequired(value: unknown, fieldName: string): Date {
  const date = parseDate(value);
  if (!date) {
    throw new Error(`Data inválida em ${fieldName}.`);
  }
  return date;
}

function parseDecimal(value: unknown): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Prisma.Decimal(value);
  }

  let text = cleanText(value)
    .replace(/R\$/gi, "")
    .replace(/\s/g, "");

  if (!text || text === "-") {
    return new Prisma.Decimal(0);
  }

  const hasComma = text.includes(",");
  const hasDot = text.includes(".");

  if (hasComma) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (hasDot && text.split(".").length > 2) {
    text = text.replace(/\./g, "");
  }

  try {
    return new Prisma.Decimal(text);
  } catch {
    return new Prisma.Decimal(0);
  }
}

function parseIntOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const text = cleanText(value);
  if (!text) {
    return null;
  }
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function rowsFromWorkbook(buffer: Buffer): SheetRow[] {
  const workbook = XLSX.read(buffer, { cellDates: true, type: "buffer" });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) {
    throw new Error("A planilha não possui abas.");
  }

  return XLSX.utils
    .sheet_to_json<SheetRow>(workbook.Sheets[firstSheet], { defval: null, raw: true })
    .filter((row) => Object.values(row).some((value) => cleanText(value)));
}

function get(row: SheetRow, key: string): unknown {
  return row[key];
}

async function createBatch(input: {
  user: ImportUser;
  module: "RECEIVABLE_STOCK" | "RISK_LIMITS" | "CEDENT_DIMENSION";
  fileName: string;
  fileHash?: string;
  source: string;
  referenceDate?: Date | null;
  fundId?: string | null;
}) {
  return prisma.importBatch.create({
    data: {
      importedByUserId: input.user.id,
      module: input.module,
      fileName: input.fileName,
      fileHash: input.fileHash,
      source: input.source,
      referenceDate: input.referenceDate ?? null,
      fundId: input.fundId ?? null,
      status: "PROCESSING",
    },
  });
}

async function completeBatch(
  batchId: string,
  input: { totalRows: number; importedRows: number; errorRows?: number }
) {
  await prisma.importBatch.update({
    where: { id: batchId },
    data: {
      status: "COMPLETED",
      totalRows: input.totalRows,
      importedRows: input.importedRows,
      errorRows: input.errorRows ?? 0,
      completedAt: new Date(),
    },
  });
}

async function failBatch(batchId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Erro desconhecido.";
  await prisma.importBatch.update({
    where: { id: batchId },
    data: { status: "FAILED", errorMessage: message, completedAt: new Date() },
  });
}

async function findFundByStockRow(row: SheetRow) {
  const fundDocument = onlyDigits(get(row, "DOC_FUNDO"));
  const fundName = normalizeName(get(row, "NOME_FUNDO"));

  const funds = await prisma.fund.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, cnpj: true, name: true, shortName: true },
  });

  const byDocument = funds.find((fund) => onlyDigits(fund.cnpj) === fundDocument);
  if (byDocument) {
    return byDocument;
  }

  const byName = funds.find((fund) => {
    const name = normalizeName(`${fund.name} ${fund.shortName}`);
    return fundName.includes(name) || name.includes(fundName.split(" ")[0] ?? "");
  });

  if (!byName) {
    throw new Error(
      `Fundo não encontrado para o estoque ${cleanText(get(row, "NOME_FUNDO"))} (${cleanText(
        get(row, "DOC_FUNDO")
      )}).`
    );
  }

  return byName;
}

async function createManyInChunks<T>(
  rows: T[],
  createMany: (chunk: T[]) => Promise<unknown>,
  chunkSize = 1000
) {
  for (let index = 0; index < rows.length; index += chunkSize) {
    await createMany(rows.slice(index, index + chunkSize));
  }
}

export async function importReceivableStock(input: {
  user: ImportUser;
  buffer: Buffer;
  fileName: string;
}): Promise<OperationalImportResult> {
  const rows = rowsFromWorkbook(input.buffer);
  if (!rows.length) {
    throw new Error("A planilha de estoque está vazia.");
  }

  const firstRow = rows[0];
  const referenceDate = parseDateRequired(get(firstRow, "DATA_REFERENCIA"), "DATA_REFERENCIA");
  const fund = await findFundByStockRow(firstRow);

  const batch = await createBatch({
    user: input.user,
    module: "RECEIVABLE_STOCK",
    fileName: input.fileName,
    fileHash: hashBuffer(input.buffer),
    source: "OPERACIONAL_ESTOQUE",
    referenceDate,
    fundId: fund.id,
  });

  try {
    const positions = rows.map((row) => {
      const replaceCedent = SPECIAL_CEDENTS.has(normalizeName(get(row, "NOME_CEDENTE")));
      const cedentName = replaceCedent ? get(row, "NOME_SACADO") : get(row, "NOME_CEDENTE");
      const cedentDocument = replaceCedent ? get(row, "DOC_SACADO") : get(row, "DOC_CEDENTE");

      return {
        batchId: batch.id,
        fundId: fund.id,
        fundName: cleanText(get(row, "NOME_FUNDO")),
        fundDocument: cleanText(get(row, "DOC_FUNDO")),
        fundDate: parseDate(get(row, "DATA_FUNDO")),
        originatorName: nullableText(get(row, "NOME_ORIGINADOR")),
        originatorDocument: nullableText(get(row, "DOC_ORIGINADOR")),
        cedentName: cleanText(cedentName),
        cedentDocument: cleanText(cedentDocument),
        debtorName: cleanText(get(row, "NOME_SACADO")),
        debtorDocument: cleanText(get(row, "DOC_SACADO")),
        yourNumber: nullableText(get(row, "SEU_NUMERO")),
        documentKey: nullableText(get(row, "CHAVE")),
        status: nullableText(get(row, "STATUS")),
        documentNumber: nullableText(get(row, "NU_DOCUMENTO")),
        receivableType: nullableText(get(row, "TIPO_RECEBIVEL")),
        nominalValue: parseDecimal(get(row, "VALOR_NOMINAL")),
        presentValue: parseDecimal(get(row, "VALOR_PRESENTE")),
        acquisitionValue: parseDecimal(get(row, "VALOR_AQUISICAO")),
        pddValue: parseDecimal(get(row, "VALOR_PDD")),
        pddRange: nullableText(get(row, "FAIXA_PDD")),
        referenceDate: parseDateRequired(get(row, "DATA_REFERENCIA"), "DATA_REFERENCIA"),
        originalDueDate: parseDate(get(row, "DATA_VENCIMENTO_ORIGINAL")),
        adjustedDueDate: parseDate(get(row, "DATA_VENCIMENTO_AJUSTADA")),
        issuedAt: parseDate(get(row, "DATA_EMISSAO")),
        acquiredAt: parseDate(get(row, "DATA_AQUISICAO")),
        term: parseIntOrNull(get(row, "PRAZO")),
        currentTerm: parseIntOrNull(get(row, "PRAZO_ATUAL")),
        receivableSituation: nullableText(get(row, "SITUACAO_RECEBIVEL")),
        assignmentRate: parseDecimal(get(row, "TAXA_CESSAO")),
        receivableRate: parseDecimal(get(row, "TX_RECEBIVEL")),
        coobligation: nullableText(get(row, "COOBRIGACAO")),
      };
    });

    await createManyInChunks(positions, (chunk) =>
      prisma.receivableStockPosition.createMany({ data: chunk })
    );
    await completeBatch(batch.id, { totalRows: rows.length, importedRows: positions.length });

    return {
      batchId: batch.id,
      importedRows: positions.length,
      totalRows: rows.length,
      errorRows: 0,
      referenceDate: referenceDate.toISOString().slice(0, 10),
      fundName: fund.shortName,
      message: `Estoque importado: ${positions.length} linhas para ${fund.shortName}.`,
    };
  } catch (error) {
    await failBatch(batch.id, error);
    throw error;
  }
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

async function fetchDimensionRows(): Promise<SheetRow[]> {
  const url = `https://docs.google.com/spreadsheets/d/${DIM_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(DIM_SHEET_NAME)}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Não foi possível carregar a DIM_cedentes do Google Sheets.");
  }

  const csv = await response.text();
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0] ?? "");

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

export async function importCedentDimension(input: {
  user: ImportUser;
  referenceDate?: Date | null;
}): Promise<OperationalImportResult> {
  const rows = await fetchDimensionRows();
  const validRows = rows.filter((row) => cleanText(get(row, "Código")));
  const batch = await createBatch({
    user: input.user,
    module: "CEDENT_DIMENSION",
    fileName: `${DIM_SHEET_NAME}.csv`,
    source: "GOOGLE_SHEETS",
    referenceDate: input.referenceDate ?? null,
  });

  try {
    const snapshot = await prisma.cedentDimensionSnapshot.create({
      data: {
        batchId: batch.id,
        importedByUserId: input.user.id,
        referenceDate: input.referenceDate ?? null,
        rowCount: validRows.length,
      },
    });

    await createManyInChunks(
      validRows.map((row) => ({
        snapshotId: snapshot.id,
        commercial: nullableText(get(row, "Comercial")),
        code: cleanText(get(row, "Código")),
        groupName: nullableText(get(row, "Grupo")),
        cedentName: cleanText(get(row, "Cedente")),
      })),
      (chunk) => prisma.cedentDimensionEntry.createMany({ data: chunk })
    );

    await completeBatch(batch.id, {
      totalRows: rows.length,
      importedRows: validRows.length,
      errorRows: rows.length - validRows.length,
    });

    return {
      batchId: batch.id,
      importedRows: validRows.length,
      totalRows: rows.length,
      errorRows: rows.length - validRows.length,
      message: `DIM_cedentes importada: ${validRows.length} códigos válidos.`,
    };
  } catch (error) {
    await failBatch(batch.id, error);
    throw error;
  }
}

async function getLatestDimensionSnapshot(referenceDate: Date) {
  return prisma.cedentDimensionSnapshot.findFirst({
    where: {
      OR: [{ referenceDate: null }, { referenceDate: { lte: referenceDate } }],
    },
    orderBy: [{ referenceDate: "desc" }, { createdAt: "desc" }],
    include: { entries: true },
  });
}

export async function importRiskLimits(input: {
  user: ImportUser;
  buffer: Buffer;
  fileName: string;
  referenceDate: Date;
}): Promise<OperationalImportResult> {
  const rows = rowsFromWorkbook(input.buffer);
  if (!rows.length) {
    throw new Error("A planilha de risco está vazia.");
  }

  const referenceDate = normalizeDate(input.referenceDate);
  const batch = await createBatch({
    user: input.user,
    module: "RISK_LIMITS",
    fileName: input.fileName,
    fileHash: hashBuffer(input.buffer),
    source: "OPERACIONAL_RISCO",
    referenceDate,
  });

  try {
    const snapshot = await getLatestDimensionSnapshot(referenceDate);
    const entriesByCode = new Map(snapshot?.entries.map((entry) => [entry.code, entry]) ?? []);
    let unmatchedRows = 0;

    const positions = rows
      .filter((row) => cleanText(get(row, "Código")) || cleanText(get(row, "Cedente")))
      .map((row) => {
        const code = nullableText(get(row, "Código"));
        const entry = code ? entriesByCode.get(code) : undefined;
        if (!entry) {
          unmatchedRows += 1;
        }

        return {
          batchId: batch.id,
          referenceDate,
          cedentDimensionEntryId: entry?.id ?? null,
          code,
          cedentName: cleanText(get(row, "Cedente")) || entry?.cedentName || "Não identificado",
          limitGlobal: parseDecimal(get(row, "Limite Global")),
          limitUsed: parseDecimal(get(row, "Lim. Uti.")),
          limitAvailable: parseDecimal(get(row, "Lim. Disponível") ?? get(row, "Lim. Disponivel")),
          overdueAmount: parseDecimal(get(row, "Vencidos")),
          pendingFinancialAmount: parseDecimal(get(row, "Pend. Fin.")),
          checkProblemAmount: parseDecimal(get(row, "Chec. Problema")),
          checkToConfirmAmount: parseDecimal(get(row, "Chec. a conf.")),
          proofOkAmount: parseDecimal(get(row, "Canhoto ok")),
          trancheTotal: parseDecimal(get(row, "Tranche Total")),
          trancheUsed: parseDecimal(get(row, "Tranche Uti.")),
          trancheAvailable: parseDecimal(get(row, "Tranche Disp.")),
        };
      });

    await createManyInChunks(positions, (chunk) =>
      prisma.riskLimitPosition.createMany({ data: chunk })
    );
    await completeBatch(batch.id, {
      totalRows: rows.length,
      importedRows: positions.length,
      errorRows: unmatchedRows,
    });

    return {
      batchId: batch.id,
      importedRows: positions.length,
      totalRows: rows.length,
      errorRows: unmatchedRows,
      unmatchedRows,
      referenceDate: referenceDate.toISOString().slice(0, 10),
      message: `Risco importado: ${positions.length} linhas, ${unmatchedRows} sem DIM.`,
    };
  } catch (error) {
    await failBatch(batch.id, error);
    throw error;
  }
}
