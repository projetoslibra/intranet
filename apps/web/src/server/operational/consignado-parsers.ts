import * as XLSX from "xlsx";

export type ParsedSettlementItem = {
  sourceRow: number;
  sourceRaw: string | null;
  occurrence: string;
  contractNumber: string | null;
  installmentNumber: string | null;
  yourNumber: string | null;
  documentNumber: string | null;
  debtorName: string | null;
  debtorDocument: string | null;
  dueDate: Date | null;
  titleAmount: string;
  paidAmount: string;
  parseIssue: string | null;
};

const RECORD_LENGTH = 444;

function field(line: string, start: number, end: number) {
  return line.slice(start - 1, end).trim();
}

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function cnabMoney(value: string) {
  const raw = digits(value);
  return (Number(raw || 0) / 100).toFixed(2);
}

function decimalText(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(2);
  let raw = String(value ?? "").replace(/R\$/gi, "").replace(/\s/g, "");
  if (!raw) return "0.00";
  if (raw.includes(",")) raw = raw.replace(/\./g, "").replace(",", ".");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

function parseBrDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)) : null;
  }
  const text = String(value ?? "").trim();
  const short = text.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (short) return new Date(Date.UTC(2000 + Number(short[3]), Number(short[2]) - 1, Number(short[1])));
  const full = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (!full) return null;
  const year = Number(full[3]) < 100 ? 2000 + Number(full[3]) : Number(full[3]);
  return new Date(Date.UTC(year, Number(full[2]) - 1, Number(full[1])));
}

export function parseBmpCnab(buffer: Buffer): ParsedSettlementItem[] {
  const decoded = new TextDecoder("windows-1252").decode(buffer).replace(/^\uFEFF/, "");
  const lines = decoded.split(/\r?\n/).filter((line) => line.length > 0);
  if (!lines.length || lines[0]?.[0] !== "0" || lines.at(-1)?.[0] !== "9") {
    throw new Error("CNAB BMP inválido: header 0 e trailer 9 são obrigatórios.");
  }
  lines.forEach((line, index) => {
    if (line.length !== RECORD_LENGTH) {
      throw new Error(`CNAB BMP inválido: linha ${index + 1} possui ${line.length}, esperado 444 caracteres.`);
    }
  });

  const result: ParsedSettlementItem[] = [];
  lines.forEach((line, index) => {
    if (line[0] !== "1") return;
    const occurrence = field(line, 109, 110);
    const titleAmount = cnabMoney(field(line, 127, 139));
    const paidAmount = cnabMoney(field(line, 83, 92));
    result.push({
      sourceRow: index + 1,
      sourceRaw: line,
      occurrence,
      contractNumber: field(line, 38, 62) || null,
      installmentNumber: null,
      yourNumber: field(line, 38, 62) || null,
      documentNumber: field(line, 111, 120) || null,
      debtorName: field(line, 235, 274) || null,
      debtorDocument: digits(field(line, 224, 234)) || null,
      dueDate: parseBrDate(field(line, 121, 126)),
      titleAmount,
      paidAmount,
      parseIssue: ["14", "77"].includes(occurrence)
        ? null
        : `Ocorrência ${occurrence || "vazia"} não suportada; esperado 14 ou 77.`,
    });
  });
  if (!result.length) throw new Error("CNAB BMP não possui registros detalhe do tipo 1.");
  return result;
}

const UY3_ALIASES = {
  contract: ["numcontrato", "numerocontrato", "contrato", "noperacaouyzy", "noperacaouy3", "noperacaodataprev"],
  face: ["parcela", "valorparcela", "valorface"],
  paid: ["valorretorno", "vlaorretorno", "valorpago", "valorrepasse"],
  status: ["status", "situacao"],
  cpf: ["cpf", "cpfsacado"],
  name: ["cliente", "sacado", "nomesacado"],
  due: ["vencimento", "datavencimento"],
} as const;

function findHeader(headers: unknown[], aliases: readonly string[], required = true) {
  const index = headers.findIndex((header) => aliases.includes(normalize(header)));
  if (index < 0 && required) throw new Error(`Planilha UY3 sem a coluna obrigatória ${aliases[0]}.`);
  return index;
}

export function buildUy3YourNumber(contract: unknown) {
  const raw = digits(contract);
  if (raw.length < 3 || raw.length > 13) throw new Error(`Contrato UY3 inválido: ${String(contract ?? "")}.`);
  const base = raw.slice(0, -2);
  const installment = raw.slice(-2);
  return { contract: raw, installment, yourNumber: `U${base.padStart(9, "0")}${installment.padStart(4, "0")}` };
}

export function parseUy3Workbook(buffer: Buffer): ParsedSettlementItem[] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  let rows: unknown[][] = [];
  let headerIndex = -1;
  for (const sheetName of workbook.SheetNames) {
    const candidateRows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });
    const candidateHeader = candidateRows.slice(0, 50).findIndex((row) => {
      if (!Array.isArray(row)) return false;
      return [UY3_ALIASES.contract, UY3_ALIASES.face, UY3_ALIASES.paid, UY3_ALIASES.status, UY3_ALIASES.cpf, UY3_ALIASES.name]
        .every((aliases) => findHeader(row, aliases, false) >= 0);
    });
    if (candidateHeader >= 0) {
      rows = candidateRows;
      headerIndex = candidateHeader;
      break;
    }
  }
  if (headerIndex < 0) throw new Error("Planilha UY3 sem cabeçalho compatível nas primeiras 50 linhas de suas abas.");
  const headers = rows[headerIndex];
  const indexes = {
    contract: findHeader(headers, UY3_ALIASES.contract),
    face: findHeader(headers, UY3_ALIASES.face),
    paid: findHeader(headers, UY3_ALIASES.paid),
    status: findHeader(headers, UY3_ALIASES.status),
    cpf: findHeader(headers, UY3_ALIASES.cpf),
    name: findHeader(headers, UY3_ALIASES.name),
    due: findHeader(headers, UY3_ALIASES.due, false),
  };
  const result: ParsedSettlementItem[] = [];
  rows.slice(headerIndex + 1).forEach((row, offset) => {
    if (!row.some((cell) => cell !== null && cell !== "")) return;
    const sourceRow = headerIndex + offset + 2;
    try {
      const identity = buildUy3YourNumber(row[indexes.contract]);
      const status = normalize(row[indexes.status]);
      result.push({
        sourceRow,
        sourceRaw: JSON.stringify(row),
        occurrence: status === normalize("DataPrev - Retorno a Menor") ? "14" : "77",
        contractNumber: identity.contract,
        installmentNumber: identity.installment,
        yourNumber: identity.yourNumber,
        documentNumber: identity.contract,
        debtorName: String(row[indexes.name] ?? "").trim() || null,
        debtorDocument: digits(row[indexes.cpf]) || null,
        dueDate: indexes.due >= 0 ? parseBrDate(row[indexes.due]) : null,
        titleAmount: decimalText(row[indexes.face]),
        paidAmount: decimalText(row[indexes.paid]),
        parseIssue: null,
      });
    } catch (error) {
      result.push({
        sourceRow,
        sourceRaw: JSON.stringify(row),
        occurrence: "",
        contractNumber: null,
        installmentNumber: null,
        yourNumber: null,
        documentNumber: null,
        debtorName: String(row[indexes.name] ?? "").trim() || null,
        debtorDocument: digits(row[indexes.cpf]) || null,
        dueDate: null,
        titleAmount: decimalText(row[indexes.face]),
        paidAmount: decimalText(row[indexes.paid]),
        parseIssue: error instanceof Error ? error.message : `Linha ${sourceRow} inválida.`,
      });
    }
  });
  if (!result.length) throw new Error("Planilha UY3 sem linhas de dados.");
  return result;
}

export type ParsedBankEntry = {
  sourceRow: number;
  transactionDate: Date;
  description: string;
  document: string | null;
  amount: string;
};

export function parseBradescoStatement(buffer: Buffer) {
  const text = new TextDecoder("windows-1252").decode(buffer).replace(/^\uFEFF/, "");
  const lines = text.split(/\r\n|\n|\r/);
  let agency: string | null = null;
  let account: string | null = null;
  let headerIndex = -1;
  let delimiter = ";";
  for (let index = 0; index < Math.min(lines.length, 30); index++) {
    const line = lines[index];
    const agencyMatch = line.match(/ag[eê]ncia[^0-9]*([0-9-]+)/i);
    const accountMatch = line.match(/conta[^0-9]*([0-9-]+)/i);
    if (agencyMatch) agency = agencyMatch[1];
    if (accountMatch) account = accountMatch[1];
    if (/data/i.test(line) && /lan[cç]amento/i.test(line) && /(cr[eé]dito|valor)/i.test(line)) {
      headerIndex = index;
      delimiter = line.includes(";") ? ";" : ",";
      break;
    }
  }
  if (headerIndex < 0) throw new Error("Extrato Bradesco inválido: cabeçalho DATA/LANÇAMENTO/CRÉDITO não encontrado.");

  const parseCsvLine = (line: string) => {
    const cells: string[] = [];
    let current = "";
    let quoted = false;
    for (const char of line) {
      if (char === '"') quoted = !quoted;
      else if (char === delimiter && !quoted) { cells.push(current.trim()); current = ""; }
      else current += char;
    }
    cells.push(current.trim());
    return cells.map((cell) => cell.replace(/^"|"$/g, "").trim());
  };
  const headers = parseCsvLine(lines[headerIndex]);
  const dateIndex = headers.findIndex((value) => normalize(value) === "data");
  const descriptionIndex = headers.findIndex((value) => normalize(value).includes("lancamento"));
  const documentIndex = headers.findIndex((value) => ["dcto", "documento"].includes(normalize(value)));
  const creditIndex = headers.findIndex((value) => normalize(value).includes("credito"));
  if ([dateIndex, descriptionIndex, creditIndex].some((index) => index < 0)) {
    throw new Error("Extrato Bradesco sem as colunas DATA, LANÇAMENTO e CRÉDITO.");
  }

  const entries: ParsedBankEntry[] = [];
  let ignoredRows = 0;
  lines.slice(headerIndex + 1).forEach((line, offset) => {
    if (!line.trim()) return;
    const cells = parseCsvLine(line);
    const date = parseBrDate(cells[dateIndex]);
    const description = cells[descriptionIndex]?.trim() ?? "";
    const amount = decimalText(cells[creditIndex]);
    if (!date || !description || Number(amount) <= 0 || /saldo anterior|total/i.test(description)) {
      ignoredRows++;
      return;
    }
    entries.push({
      sourceRow: headerIndex + offset + 2,
      transactionDate: date,
      description,
      document: documentIndex >= 0 ? cells[documentIndex]?.trim() || null : null,
      amount,
    });
  });
  return { agency, account, entries, ignoredRows, totalRows: Math.max(0, lines.length - headerIndex - 1) };
}
