const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const SAO_PAULO_UTC_OFFSET_HOURS = 3;

function dateParts(value: string) {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) throw new Error("Data inválida. Use o formato AAAA-MM-DD.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    throw new Error("Data inválida. Use uma data existente.");
  }
  return { year, month, day, utc };
}

export function parseDateOnly(value: string) {
  return dateParts(value).utc;
}

export function saoPauloDayRange(value: string) {
  const { year, month, day } = dateParts(value);
  const gte = new Date(Date.UTC(year, month - 1, day, SAO_PAULO_UTC_OFFSET_HOURS));
  const lt = new Date(Date.UTC(year, month - 1, day + 1, SAO_PAULO_UTC_OFFSET_HOURS));
  return { gte, lt };
}
