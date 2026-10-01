import type { ReportFundAvailability } from "@/server/reports/report-data";
import type { ReportPeriod, ReportType } from "@/server/reports/report-export";

export function availableDates(availability: ReportFundAvailability[], fund: string) {
  return availability.find((item) => item.fund === fund)?.dates.map((item) => item.date) ?? [];
}

export function availablePeriods(
  availability: ReportFundAvailability[],
  fund: string,
  date: string,
) {
  return availability
    .find((item) => item.fund === fund)
    ?.dates.find((item) => item.date === date)
    ?.periods ?? [];
}

const reportPaths: Record<ReportType, string> = {
  stock: "estoque",
  settled: "liquidados",
  "open-movements": "movimentos-em-aberto",
};

export function reportExportHref(
  type: ReportType,
  fund: string,
  date: string,
  period?: ReportPeriod | "",
) {
  if (!fund || !date || (type === "open-movements" && !period)) return null;
  const params = new URLSearchParams({ fund, date });
  if (period) params.set("period", period);
  return `/api/relatorios/${reportPaths[type]}/export?${params}`;
}
