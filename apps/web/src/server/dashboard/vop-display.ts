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

const termFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const monthlyRateFormatter = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

export type VopDisplay = {
  dailyLabel: string;
  monthlyLabel: string;
  termLabel: string;
  monthlyRateLabel: string;
  dateLabel: string;
};

export function toVopDisplay(summary: FundVopSummary | null): VopDisplay {
  if (!summary) {
    return {
      dailyLabel: "Indisponível",
      monthlyLabel: "Indisponível",
      termLabel: "Indisponível",
      monthlyRateLabel: "Indisponível",
      dateLabel: "Sem posição de VOP",
    };
  }

  return {
    dailyLabel: currencyFormatter.format(summary.dailyAmount),
    monthlyLabel: currencyFormatter.format(summary.monthlyAmount),
    termLabel:
      summary.weightedAverageTermDays === null
        ? "Indisponível"
        : `${termFormatter.format(summary.weightedAverageTermDays)} dias`,
    monthlyRateLabel:
      summary.weightedAverageMonthlyRate === null
        ? "Indisponível"
        : `${monthlyRateFormatter.format(summary.weightedAverageMonthlyRate)} a.m.`,
    dateLabel: `Posição em ${dateFormatter.format(summary.referenceDate)}`,
  };
}
