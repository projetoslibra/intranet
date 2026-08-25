export type SettlementUploadSource = "BMP" | "UY3";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const PATH_PREFIX = "operacional/consignado/baixas/uploads/";

export const consignadoSettlementUploadConfig = {
  maxFileSize: MAX_FILE_SIZE,
  pathPrefix: PATH_PREFIX,
  allowedContentTypes: [
    "text/plain",
    "application/octet-stream",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
} as const;

export type SettlementUploadMetadata = {
  source: SettlementUploadSource;
  originator: string;
  fileName: string;
  fileHash: string;
  fileSize: number;
  storageKey: string;
};

function safeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-");
}

function hasAllowedExtension(source: SettlementUploadSource, value: string) {
  const lower = value.toLowerCase();
  return source === "BMP"
    ? lower.endsWith(".rem") || lower.endsWith(".txt")
    : lower.endsWith(".xlsx");
}

export function buildSettlementUploadPath(input: {
  source: SettlementUploadSource;
  fileName: string;
  timestamp?: number;
}) {
  return `${PATH_PREFIX}${input.source.toLowerCase()}/${input.timestamp ?? Date.now()}-${safeFileName(input.fileName)}`;
}

export function validateSettlementUploadPath(pathname: string): SettlementUploadSource {
  const lower = pathname.toLowerCase();
  if (lower.startsWith(`${PATH_PREFIX}bmp/`) && hasAllowedExtension("BMP", lower)) return "BMP";
  if (lower.startsWith(`${PATH_PREFIX}uy3/`) && hasAllowedExtension("UY3", lower)) return "UY3";
  throw new Error("Caminho de armazenamento do arquivo de baixa inválido.");
}

export function validateSettlementUploadMetadata(input: SettlementUploadMetadata) {
  if (!(["BMP", "UY3"] as const).includes(input.source)) {
    throw new Error("Selecione BMP ou UY3.");
  }
  const fileName = input.fileName.trim();
  if (!fileName || fileName.length > 255) {
    throw new Error("Nome do arquivo de baixa inválido.");
  }
  if (!hasAllowedExtension(input.source, fileName)) {
    throw new Error(input.source === "BMP" ? "O arquivo BMP deve ser REM ou TXT." : "O arquivo UY3 deve ser XLSX.");
  }
  if (!/^[a-f0-9]{64}$/i.test(input.fileHash)) {
    throw new Error("Hash do arquivo de baixa inválido.");
  }
  if (!Number.isInteger(input.fileSize) || input.fileSize <= 0 || input.fileSize > MAX_FILE_SIZE) {
    throw new Error("O arquivo de baixa deve possuir no máximo 50 MB.");
  }
  if (validateSettlementUploadPath(input.storageKey) !== input.source) {
    throw new Error("Caminho de armazenamento do arquivo de baixa inválido.");
  }
  return {
    ...input,
    fileName,
    fileHash: input.fileHash.toLowerCase(),
    originator: input.originator.trim().toUpperCase(),
  };
}

export function assertSettlementBlobIntegrity(input: {
  declaredSize: number;
  declaredHash: string;
  actualSize: number;
  actualHash: string;
}) {
  if (input.actualSize !== input.declaredSize) {
    throw new Error("O tamanho do arquivo armazenado não confere com o upload.");
  }
  if (input.actualHash.toLowerCase() !== input.declaredHash.toLowerCase()) {
    throw new Error("O conteúdo armazenado não corresponde ao arquivo enviado.");
  }
}

export async function readSettlementApiResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = await response.json() as Record<string, unknown>;
    return {
      ...payload,
      ok: typeof payload.ok === "boolean" ? payload.ok : response.ok,
      message: typeof payload.message === "string" ? payload.message : response.ok ? "Operação concluída." : `Falha HTTP ${response.status}.`,
    };
  }
  const text = (await response.text()).trim();
  return {
    ok: false,
    message: text.slice(0, 300) || `Falha HTTP ${response.status}.`,
  };
}
