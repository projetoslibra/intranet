import type { FundVopSummary } from "./vop-snapshots";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

export type VopDisplay = {
  dailyLabel: string;
  monthlyLabel: string;
  dateLabel: string;
};

export function toVopDisplay(summary: FundVopSummary | null): VopDisplay {
  if (!summary) {
    return {
      dailyLabel: "Indisponível",
      monthlyLabel: "Indisponível",
      dateLabel: "Sem posição de VOP",
    };
  }

  return {
    dailyLabel: currencyFormatter.format(summary.dailyAmount),
    monthlyLabel: currencyFormatter.format(summary.monthlyAmount),
    dateLabel: `Posição em ${dateFormatter.format(summary.referenceDate)}`,
  };
}
