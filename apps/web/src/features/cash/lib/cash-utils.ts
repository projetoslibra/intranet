/**
 * Utilitários de caixa compartilhados entre client e server.
 * Não importa Prisma — pode ser usado no browser.
 *
 * Regra: dinheiro nunca é manipulado como float em cálculo. As contas
 * (totais, "Caixa") são feitas em centavos inteiros.
 */

const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatBRL(value: number): string {
  return brlFormatter.format(value);
}

/** Converte um valor digitado em padrão BR ("1.234,56" / "R$ 1.234,56") para number. */
export function parseBRNumber(input: string | number): number {
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : 0;
  }

  const cleaned = String(input)
    .trim()
    .replace(/R\$/gi, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".");

  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

/** Converte uma string decimal vinda do banco ("1234.56") para centavos inteiros. */
export function decimalStringToCents(value: string): number {
  const negative = value.trim().startsWith("-");
  const [intPart, fracPart = ""] = value.replace("-", "").trim().split(".");
  const cents = Number(intPart || "0") * 100 + Number((fracPart + "00").slice(0, 2));
  return negative ? -cents : cents;
}

export function centsToBRL(cents: number): string {
  return formatBRL(cents / 100);
}

/** Soma exata de uma lista de strings decimais, devolvendo centavos inteiros. */
export function sumDecimalStringsToCents(values: string[]): number {
  return values.reduce((total, value) => total + decimalStringToCents(value), 0);
}

/** Caixa = Conta pgto − Reserva − Usado. Usado para o preview ao vivo no formulário. */
export function computeCash(
  paymentBalance: number,
  reserveBalance: number,
  usedAmount: number
): number {
  const cents =
    Math.round(paymentBalance * 100) -
    Math.round(reserveBalance * 100) -
    Math.round(usedAmount * 100);
  return cents / 100;
}

/** Formata uma string decimal do banco ("1234.56") como moeda BR. */
export function formatDecimalString(value: string): string {
  return centsToBRL(decimalStringToCents(value));
}

const editableFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Converte "1234.56" em "1.234,56" para preencher inputs editáveis. */
export function decimalStringToEditable(value: string): string {
  return editableFormatter.format(decimalStringToCents(value) / 100);
}
