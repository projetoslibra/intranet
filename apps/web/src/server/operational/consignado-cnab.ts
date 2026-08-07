import { createHash } from "node:crypto";

const LENGTH = 444;

type CnabItem = {
  sourceRaw: string | null;
  occurrence: string | null;
  paidAmount: { toString(): string };
  matchedStockPosition: {
    yourNumber: string | null;
    documentNumber: string | null;
    debtorDocument: string;
    debtorName: string;
    nominalValue: { toString(): string };
    acquisitionValue: { toString(): string };
    adjustedDueDate: Date | null;
    originalDueDate: Date | null;
    issuedAt: Date | null;
  };
};

function ascii(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "");
}

function setField(line: string, start: number, end: number, value: unknown, numeric = false) {
  const width = end - start + 1;
  const raw = numeric ? String(value ?? "").replace(/\D/g, "") : ascii(value);
  if (raw.length > width) throw new Error(`Campo CNAB ${start}-${end} excede ${width} caracteres.`);
  const formatted = numeric ? raw.padStart(width, "0") : raw.padEnd(width, " ");
  return `${line.slice(0, start - 1)}${formatted}${line.slice(end)}`;
}

function cents(value: { toString(): string }) {
  const number = Number(value.toString());
  if (!Number.isFinite(number) || number < 0) throw new Error("Valor inválido para geração da remessa.");
  return Math.round(number * 100).toString();
}

function ddmmyy(value: Date | null | undefined) {
  const date = value ?? new Date();
  return `${String(date.getUTCDate()).padStart(2, "0")}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCFullYear()).slice(-2)}`;
}

function buildHeader(sequence: number) {
  let line = " ".repeat(LENGTH);
  line = setField(line, 1, 2, "01", true);
  line = setField(line, 3, 9, "REMESSA");
  line = setField(line, 10, 11, "01", true);
  line = setField(line, 12, 19, "COBRANCA");
  line = setField(line, 27, 46, "00000000000000000002");
  line = setField(line, 47, 76, "LIBRA CONSIGNADO FIDC DE RESP.");
  line = setField(line, 77, 79, "707", true);
  line = setField(line, 80, 94, "DAYCOVAL");
  line = setField(line, 95, 100, ddmmyy(new Date()), true);
  line = setField(line, 109, 110, "MX");
  line = setField(line, 111, 117, sequence, true);
  line = setField(line, 118, 137, "LIBRA");
  return setField(line, 439, 444, 1, true);
}

function buildDetail(item: CnabItem, sequence: number) {
  const stock = item.matchedStockPosition;
  let line = item.sourceRaw?.length === LENGTH ? item.sourceRaw : " ".repeat(LENGTH);
  line = setField(line, 1, 1, "1");
  line = setField(line, 38, 62, stock.yourNumber ?? stock.documentNumber ?? "");
  line = setField(line, 83, 92, cents(item.paidAmount), true);
  line = setField(line, 95, 100, ddmmyy(new Date()), true);
  line = setField(line, 101, 101, 0, true);
  line = setField(line, 102, 108, 0, true);
  line = setField(line, 109, 110, item.occurrence ?? "77", true);
  line = setField(line, 111, 120, stock.documentNumber ?? "0", true);
  line = setField(line, 121, 126, ddmmyy(stock.adjustedDueDate ?? stock.originalDueDate), true);
  line = setField(line, 127, 139, cents(stock.nominalValue), true);
  const emission = `0000000041N${ddmmyy(stock.issuedAt)}00002            `;
  line = setField(line, 140, 173, emission);
  line = setField(line, 174, 192, (stock.yourNumber ?? "").slice(0, -3));
  line = setField(line, 193, 223, `${cents(stock.acquisitionValue).padStart(13, "0")}000000000000001000`);
  line = setField(line, 224, 234, stock.debtorDocument, true);
  line = setField(line, 235, 274, stock.debtorName);
  if (!item.sourceRaw) line = setField(line, 335, 438, "UY3");
  return setField(line, 439, 444, sequence, true);
}

function buildTrailer(sequence: number) {
  let line = " ".repeat(LENGTH);
  line = setField(line, 1, 1, "9");
  return setField(line, 439, 444, sequence, true);
}

export function generateDaycovalCnab(items: CnabItem[], fileSequence = 1) {
  if (!items.length) throw new Error("Nenhum título apto para gerar a remessa.");
  const lines = [buildHeader(fileSequence)];
  items.forEach((item, index) => lines.push(buildDetail(item, index + 2)));
  lines.push(buildTrailer(lines.length + 1));
  lines.forEach((line, index) => {
    if (line.length !== LENGTH) throw new Error(`Linha ${index + 1} não possui 444 caracteres.`);
  });
  const seen = new Set<string>();
  items.forEach((item) => {
    const key = item.matchedStockPosition.yourNumber ?? item.matchedStockPosition.documentNumber;
    if (!key || seen.has(key)) throw new Error(`Título duplicado ou sem identificador definitivo: ${key ?? "vazio"}.`);
    seen.add(key);
  });
  const buffer = Buffer.from(`${lines.join("\r\n")}\r\n`, "latin1");
  return { buffer, hash: createHash("sha256").update(buffer).digest("hex"), lineCount: lines.length };
}
