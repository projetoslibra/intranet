import { createHash } from "node:crypto";
import { del, get, head } from "@vercel/blob";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";

const CONSIGNADO_CNPJ = "54842157000193";
const STOCK_SOURCE = "CONSIGNADO_STOCK_MANUAL";
const STOCK_PATH_PREFIX = "operacional/consignado/estoques/";
const STOCK_MODULE = "RECEIVABLE_STOCK" as const;
const CHUNK_SIZE = 1_000;
const MAX_FILE_SIZE = 50 * 1024 * 1024;

type SheetRow = Record<string, unknown>;

type RegisterStockUploadInput = {
  userId: string;
  fileName: string;
  fileHash: string;
  fileSize: number;
  storageKey: string;
};

type StockSummary = {
  sheetName: string;
  totalNominalValue: string;
  totalPresentValue: string;
  unsafeIdentifierRows: number;
  requiresActivation: boolean;
  cedents: Array<{
    name: string;
    count: number;
    nominalValue: string;
    presentValue: string;
  }>;
};

export type ConsignadoStockBatchView = {
  id: string;
  fileName: string;
  fileSize: number | null;
  referenceDate: string | null;
  version: number;
  isActive: boolean;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  totalRows: number;
  progressRows: number;
  importedRows: number;
  errorRows: number;
  warningRows: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  importedBy: string;
  fundName: string | null;
  summary: StockSummary | null;
};

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
  const valueAsText = cleanText(value);
  return valueAsText || null;
}

function onlyDigits(value: unknown): string {
  return cleanText(value).replace(/\D/g, "");
}

function identifierText(value: unknown): { value: string | null; unsafe: boolean } {
  if (value === null || value === undefined || value === "") {
    return { value: null, unsafe: false };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return {
      value: Number.isInteger(value) ? value.toFixed(0) : String(value),
      unsafe: !Number.isSafeInteger(value),
    };
  }

  const text = cleanText(value);
  return { value: text || null, unsafe: false };
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
      return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
    }
  }

  const text = cleanText(value);
  const brDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brDate) {
    return new Date(Date.UTC(Number(brDate[3]), Number(brDate[2]) - 1, Number(brDate[1])));
  }

  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) {
    return new Date(Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])));
  }

  return null;
}

function requiredDate(value: unknown, fieldName: string, sourceRow: number): Date {
  const parsed = parseDate(value);
  if (!parsed) {
    throw new Error(`Linha ${sourceRow}: data inválida em ${fieldName}.`);
  }
  return parsed;
}

function parseDecimal(value: unknown): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Prisma.Decimal(value);
  }

  let text = cleanText(value).replace(/R\$/gi, "").replace(/\s/g, "");
  if (!text || text === "-") {
    return new Prisma.Decimal(0);
  }
  if (text.includes(",")) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if ((text.match(/\./g) ?? []).length > 1) {
    text = text.replace(/\./g, "");
  }

  try {
    return new Prisma.Decimal(text);
  } catch {
    return new Prisma.Decimal(0);
  }
}

function parseInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const parsed = Number.parseInt(cleanText(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseSummary(value: Prisma.JsonValue | null): StockSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as unknown as StockSummary;
}

async function findConsignadoFund() {
  const funds = await prisma.fund.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, cnpj: true, name: true, shortName: true },
  });
  const fund = funds.find(
    (candidate) =>
      onlyDigits(candidate.cnpj) === CONSIGNADO_CNPJ ||
      normalizeName(`${candidate.name} ${candidate.shortName}`).includes("CONSIGNADO")
  );

  if (!fund) {
    throw new Error("O fundo Consignado não está cadastrado no OSHER.");
  }
  return fund;
}

async function discardUploadedBlob(storageKey: string) {
  try {
    await del(storageKey);
  } catch {
    // A duplicidade já foi tratada no banco. Falha de limpeza não bloqueia o usuário.
  }
}

export async function registerConsignadoStockUpload(input: RegisterStockUploadInput) {
  if (!input.fileName.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Envie um arquivo de estoque no formato .xlsx.");
  }
  if (!/^[a-f0-9]{64}$/i.test(input.fileHash)) {
    throw new Error("Hash do arquivo inválido.");
  }
  if (!Number.isInteger(input.fileSize) || input.fileSize <= 0 || input.fileSize > MAX_FILE_SIZE) {
    throw new Error("O arquivo deve possuir no máximo 50 MB.");
  }
  if (!input.storageKey.startsWith(STOCK_PATH_PREFIX)) {
    throw new Error("Caminho de armazenamento inválido.");
  }

  const [fund, blob] = await Promise.all([
    findConsignadoFund(),
    head(input.storageKey),
  ]);
  if (blob.size !== input.fileSize) {
    throw new Error("O tamanho do arquivo armazenado não confere com o upload.");
  }

  const duplicate = await prisma.importBatch.findFirst({
    where: {
      module: STOCK_MODULE,
      fundId: fund.id,
      fileHash: input.fileHash.toLowerCase(),
    },
    select: { id: true, status: true },
  });
  if (duplicate) {
    await discardUploadedBlob(input.storageKey);
    return { batchId: duplicate.id, duplicate: true, status: duplicate.status };
  }

  try {
    const batch = await prisma.importBatch.create({
      data: {
        importedByUserId: input.userId,
        module: STOCK_MODULE,
        fileName: input.fileName,
        fileHash: input.fileHash.toLowerCase(),
        fileSize: input.fileSize,
        source: STOCK_SOURCE,
        storageKey: input.storageKey,
        fundId: fund.id,
        status: "PENDING",
      },
      select: { id: true, status: true },
    });
    return { batchId: batch.id, duplicate: false, status: batch.status };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.importBatch.findFirstOrThrow({
        where: { module: STOCK_MODULE, fundId: fund.id, fileHash: input.fileHash.toLowerCase() },
        select: { id: true, status: true },
      });
      await discardUploadedBlob(input.storageKey);
      return { batchId: existing.id, duplicate: true, status: existing.status };
    }
    throw error;
  }
}

function workbookRows(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { cellDates: true, type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("A planilha não possui abas.");
  }
  const sheet = workbook.Sheets[sheetName];
  const rangeValue = sheet["!ref"];
  if (!rangeValue) {
    throw new Error("A planilha de estoque está vazia.");
  }
  const range = XLSX.utils.decode_range(rangeValue);
  const requiredHeaders = [
    "NOME_FUNDO",
    "DOC_FUNDO",
    "NOME_CEDENTE",
    "DOC_CEDENTE",
    "NOME_SACADO",
    "DOC_SACADO",
    "NU_DOCUMENTO",
    "SEU_NUMERO",
    "VALOR_NOMINAL",
    "VALOR_PRESENTE",
    "DATA_REFERENCIA",
  ];

  let headerRow = -1;
  let headers = new Map<string, number>();
  for (let rowIndex = range.s.r; rowIndex <= Math.min(range.e.r, range.s.r + 20); rowIndex++) {
    const candidate = new Map<string, number>();
    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
      const name = normalizeName(cell?.v).replace(/\s+/g, "_");
      if (name) {
        candidate.set(name, columnIndex);
      }
    }
    if (requiredHeaders.every((name) => candidate.has(name))) {
      headerRow = rowIndex;
      headers = candidate;
      break;
    }
  }
  if (headerRow < 0) {
    throw new Error(`Layout inválido. Colunas obrigatórias: ${requiredHeaders.join(", ")}.`);
  }

  const valueAt = (rowIndex: number, fieldName: string) => {
    const columnIndex = headers.get(fieldName);
    if (columnIndex === undefined) {
      return null;
    }
    return sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })]?.v ?? null;
  };

  return { sheetName, range, headerRow, valueAt };
}

async function streamToBuffer(stream: ReadableStream): Promise<Buffer> {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

export async function processConsignadoStockBatch(batchId: string) {
  const staleBefore = new Date(Date.now() - 6 * 60 * 1_000);
  const claimed = await prisma.importBatch.updateMany({
    where: {
      id: batchId,
      module: STOCK_MODULE,
      source: STOCK_SOURCE,
      OR: [
        { status: { in: ["PENDING", "FAILED"] } },
        { status: "PROCESSING", startedAt: { lt: staleBefore } },
      ],
    },
    data: {
      status: "PROCESSING",
      startedAt: new Date(),
      completedAt: null,
      errorMessage: null,
      progressRows: 0,
      importedRows: 0,
      errorRows: 0,
      warningRows: 0,
    },
  });
  if (!claimed.count) {
    return prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  }

  const batch = await prisma.importBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: { fund: { select: { id: true, name: true, shortName: true } } },
  });

  try {
    if (!batch.storageKey || !batch.fileHash || !batch.fundId) {
      throw new Error("Lote sem arquivo, hash ou fundo associado.");
    }
    await prisma.receivableStockPosition.deleteMany({ where: { batchId } });
    const stored = await get(batch.storageKey, { access: "private", useCache: false });
    if (!stored || stored.statusCode !== 200 || !stored.stream) {
      throw new Error("O arquivo privado do estoque não foi encontrado.");
    }
    const buffer = await streamToBuffer(stored.stream);
    const actualHash = createHash("sha256").update(buffer).digest("hex");
    if (actualHash !== batch.fileHash) {
      throw new Error("O conteúdo armazenado não corresponde ao arquivo enviado.");
    }

    const { sheetName, range, headerRow, valueAt } = workbookRows(buffer);
    const estimatedRows = Math.max(0, range.e.r - headerRow);
    await prisma.importBatch.update({ where: { id: batchId }, data: { totalRows: estimatedRows } });

    const positions: Prisma.ReceivableStockPositionCreateManyInput[] = [];
    const cedents = new Map<
      string,
      { count: number; nominalValue: Prisma.Decimal; presentValue: Prisma.Decimal }
    >();
    let totalNominalValue = new Prisma.Decimal(0);
    let totalPresentValue = new Prisma.Decimal(0);
    let importedRows = 0;
    let unsafeIdentifierRows = 0;
    let referenceDate: Date | null = null;
    let fundName = "";
    let fundDocument = "";

    const flush = async () => {
      if (!positions.length) {
        return;
      }
      const current = positions.splice(0, positions.length);
      await prisma.receivableStockPosition.createMany({ data: current });
      importedRows += current.length;
      await prisma.importBatch.update({
        where: { id: batchId },
        data: { progressRows: importedRows, importedRows },
      });
    };

    for (let rowIndex = headerRow + 1; rowIndex <= range.e.r; rowIndex++) {
      const sourceRow = rowIndex + 1;
      const rowFundName = cleanText(valueAt(rowIndex, "NOME_FUNDO"));
      const rowDocumentNumber = identifierText(valueAt(rowIndex, "NU_DOCUMENTO"));
      const rowYourNumber = identifierText(valueAt(rowIndex, "SEU_NUMERO"));
      if (!rowFundName && !rowDocumentNumber.value && !rowYourNumber.value) {
        continue;
      }

      const rowFundDocument = cleanText(valueAt(rowIndex, "DOC_FUNDO"));
      const rowReferenceDate = requiredDate(
        valueAt(rowIndex, "DATA_REFERENCIA"),
        "DATA_REFERENCIA",
        sourceRow
      );
      if (!referenceDate) {
        referenceDate = rowReferenceDate;
        fundName = rowFundName;
        fundDocument = rowFundDocument;
        if (
          onlyDigits(rowFundDocument) !== CONSIGNADO_CNPJ &&
          !normalizeName(rowFundName).includes("CONSIGNADO")
        ) {
          throw new Error(`O arquivo não pertence ao fundo Consignado (${rowFundName}).`);
        }
      } else if (
        dateKey(referenceDate) !== dateKey(rowReferenceDate) ||
        normalizeName(fundName) !== normalizeName(rowFundName) ||
        onlyDigits(fundDocument) !== onlyDigits(rowFundDocument)
      ) {
        throw new Error(`Linha ${sourceRow}: fundo ou data diverge do início do arquivo.`);
      }

      const cedentName = cleanText(valueAt(rowIndex, "NOME_CEDENTE"));
      const debtorName = cleanText(valueAt(rowIndex, "NOME_SACADO"));
      const nominalValue = parseDecimal(valueAt(rowIndex, "VALOR_NOMINAL"));
      const presentValue = parseDecimal(valueAt(rowIndex, "VALOR_PRESENTE"));
      if (!cedentName || !debtorName || !rowDocumentNumber.value || !rowYourNumber.value) {
        throw new Error(`Linha ${sourceRow}: identificadores obrigatórios não preenchidos.`);
      }

      const unsafeIdentifier = rowDocumentNumber.unsafe || rowYourNumber.unsafe;
      if (unsafeIdentifier) {
        unsafeIdentifierRows++;
      }
      const summary = cedents.get(cedentName) ?? {
        count: 0,
        nominalValue: new Prisma.Decimal(0),
        presentValue: new Prisma.Decimal(0),
      };
      summary.count++;
      summary.nominalValue = summary.nominalValue.add(nominalValue);
      summary.presentValue = summary.presentValue.add(presentValue);
      cedents.set(cedentName, summary);
      totalNominalValue = totalNominalValue.add(nominalValue);
      totalPresentValue = totalPresentValue.add(presentValue);

      const rowForHash: SheetRow = {
        fund: rowFundName,
        referenceDate: dateKey(rowReferenceDate),
        cedent: cedentName,
        debtorDocument: cleanText(valueAt(rowIndex, "DOC_SACADO")),
        documentNumber: rowDocumentNumber.value,
        yourNumber: rowYourNumber.value,
        nominalValue: nominalValue.toString(),
        originalDueDate: parseDate(valueAt(rowIndex, "DATA_VENCIMENTO_ORIGINAL"))?.toISOString(),
      };

      positions.push({
        batchId,
        fundId: batch.fundId,
        fundName: rowFundName,
        fundDocument: rowFundDocument,
        fundDate: parseDate(valueAt(rowIndex, "DATA_FUNDO")),
        originatorName: nullableText(valueAt(rowIndex, "NOME_ORIGINADOR")),
        originatorDocument: nullableText(valueAt(rowIndex, "DOC_ORIGINADOR")),
        cedentName,
        cedentDocument: cleanText(valueAt(rowIndex, "DOC_CEDENTE")),
        debtorName,
        debtorDocument: cleanText(valueAt(rowIndex, "DOC_SACADO")),
        yourNumber: rowYourNumber.value,
        documentKey: nullableText(valueAt(rowIndex, "CHAVE")),
        status: nullableText(valueAt(rowIndex, "STATUS")),
        documentNumber: rowDocumentNumber.value,
        receivableType: nullableText(valueAt(rowIndex, "TIPO_RECEBIVEL")),
        nominalValue,
        presentValue,
        acquisitionValue: parseDecimal(valueAt(rowIndex, "VALOR_AQUISICAO")),
        pddValue: parseDecimal(valueAt(rowIndex, "VALOR_PDD")),
        pddRange: nullableText(valueAt(rowIndex, "FAIXA_PDD")),
        referenceDate: rowReferenceDate,
        originalDueDate: parseDate(valueAt(rowIndex, "DATA_VENCIMENTO_ORIGINAL")),
        adjustedDueDate: parseDate(valueAt(rowIndex, "DATA_VENCIMENTO_AJUSTADA")),
        issuedAt: parseDate(valueAt(rowIndex, "DATA_EMISSAO")),
        acquiredAt: parseDate(valueAt(rowIndex, "DATA_AQUISICAO")),
        term: parseInteger(valueAt(rowIndex, "PRAZO")),
        currentTerm: parseInteger(valueAt(rowIndex, "PRAZO_ATUAL")),
        receivableSituation: nullableText(valueAt(rowIndex, "SITUACAO_RECEBIVEL")),
        assignmentRate: parseDecimal(valueAt(rowIndex, "TAXA_CESSAO")),
        receivableRate: parseDecimal(valueAt(rowIndex, "TX_RECEBIVEL")),
        coobligation: nullableText(valueAt(rowIndex, "COOBRIGACAO")),
        sourceRow,
        rowHash: createHash("sha256").update(JSON.stringify(rowForHash)).digest("hex"),
      });

      if (positions.length >= CHUNK_SIZE) {
        await flush();
      }
    }
    await flush();

    if (!referenceDate || importedRows === 0) {
      throw new Error("A planilha de estoque não possui posições válidas.");
    }

    const latestVersion = await prisma.importBatch.aggregate({
      where: {
        id: { not: batchId },
        module: STOCK_MODULE,
        source: STOCK_SOURCE,
        fundId: batch.fundId,
        referenceDate,
      },
      _max: { version: true },
    });
    const version = (latestVersion._max.version ?? 0) + 1;
    const activeForDate = await prisma.importBatch.findFirst({
      where: {
        id: { not: batchId },
        module: STOCK_MODULE,
        source: STOCK_SOURCE,
        fundId: batch.fundId,
        referenceDate,
        isActive: true,
      },
      select: { id: true },
    });
    const summary: StockSummary = {
      sheetName,
      totalNominalValue: totalNominalValue.toFixed(2),
      totalPresentValue: totalPresentValue.toFixed(2),
      unsafeIdentifierRows,
      requiresActivation: Boolean(activeForDate),
      cedents: Array.from(cedents.entries())
        .map(([name, values]) => ({
          name,
          count: values.count,
          nominalValue: values.nominalValue.toFixed(2),
          presentValue: values.presentValue.toFixed(2),
        }))
        .sort((left, right) => right.count - left.count),
    };

    await prisma.importBatch.update({
      where: { id: batchId },
      data: {
        referenceDate,
        version,
        isActive: !activeForDate,
        status: "COMPLETED",
        totalRows: importedRows,
        progressRows: importedRows,
        importedRows,
        warningRows: unsafeIdentifierRows,
        metadata: summary as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });

    return prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  } catch (error) {
    await prisma.receivableStockPosition.deleteMany({ where: { batchId } });
    const message = error instanceof Error ? error.message : "Erro desconhecido ao importar estoque.";
    await prisma.importBatch.update({
      where: { id: batchId },
      data: {
        status: "FAILED",
        isActive: false,
        progressRows: 0,
        importedRows: 0,
        errorRows: 1,
        errorMessage: message.slice(0, 2_000),
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

export async function activateConsignadoStockBatch(batchId: string) {
  const batch = await prisma.importBatch.findFirstOrThrow({
    where: { id: batchId, module: STOCK_MODULE, source: STOCK_SOURCE, status: "COMPLETED" },
    select: { id: true, fundId: true, referenceDate: true },
  });
  if (!batch.fundId || !batch.referenceDate) {
    throw new Error("O lote ainda não possui fundo e data de referência.");
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.importBatch.updateMany({
      where: {
        module: STOCK_MODULE,
        source: STOCK_SOURCE,
        fundId: batch.fundId!,
        referenceDate: batch.referenceDate!,
        isActive: true,
      },
      data: { isActive: false },
    });
    await transaction.importBatch.update({
      where: { id: batch.id },
      data: { isActive: true },
    });
  });
}

export async function getConsignadoStockHistory(): Promise<ConsignadoStockBatchView[]> {
  const fund = await findConsignadoFund();
  const batches = await prisma.importBatch.findMany({
    where: { module: STOCK_MODULE, source: STOCK_SOURCE, fundId: fund.id },
    orderBy: [{ referenceDate: "desc" }, { version: "desc" }, { createdAt: "desc" }],
    take: 50,
    include: {
      fund: { select: { name: true, shortName: true } },
      importedByUser: { select: { name: true } },
    },
  });

  return batches.map((batch) => ({
    id: batch.id,
    fileName: batch.fileName,
    fileSize: batch.fileSize,
    referenceDate: batch.referenceDate ? dateKey(batch.referenceDate) : null,
    version: batch.version,
    isActive: batch.isActive,
    status: batch.status,
    totalRows: batch.totalRows,
    progressRows: batch.progressRows,
    importedRows: batch.importedRows,
    errorRows: batch.errorRows,
    warningRows: batch.warningRows,
    errorMessage: batch.errorMessage,
    createdAt: batch.createdAt.toISOString(),
    startedAt: batch.startedAt?.toISOString() ?? null,
    completedAt: batch.completedAt?.toISOString() ?? null,
    importedBy: batch.importedByUser.name,
    fundName: batch.fund?.shortName ?? batch.fund?.name ?? null,
    summary: parseSummary(batch.metadata),
  }));
}

export const consignadoStockUploadConfig = {
  maxFileSize: MAX_FILE_SIZE,
  pathPrefix: STOCK_PATH_PREFIX,
};
