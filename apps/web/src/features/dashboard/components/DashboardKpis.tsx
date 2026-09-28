import { Activity, Building2, CalendarRange, Landmark } from "lucide-react";
import type { DashboardOverview } from "@/server/dashboard/dashboard-overview";

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

export function DashboardKpis({ overview }: { overview: DashboardOverview }) {
  const fundsWithPosition = overview.funds.filter(
    (fund) => fund.financialStatus === "ready"
  ).length;
  const partialPlCoverage = fundsWithPosition < overview.activeFundCount;
  const coverage = `${overview.vop.integratedFunds} de ${overview.vop.totalFunds} fundos integrados`;
  const cutoff = overview.vop.cutoffDate
    ? `Posição em ${dateFormatter.format(overview.vop.cutoffDate)}`
    : "Sem data comum disponível";
  const partialCoverage = overview.vop.integratedFunds < overview.vop.totalFunds;
  const formatVop = (value: number | null) =>
    value === null ? "Sem dados" : currencyFormatter.format(value);
  const cards = [
    {
      label: "PL consolidado",
      value: currencyFormatter.format(overview.consolidatedPl),
      detail: `${fundsWithPosition} de ${overview.activeFundCount} fundos com posição`,
      icon: Landmark,
      iconClass: partialPlCoverage
        ? "bg-amber-50 text-amber-700"
        : "bg-blue-50 text-blue-700",
      accentClass: partialPlCoverage ? "border-t-amber-500" : "border-t-blue-600",
    },
    {
      label: "Fundos ativos",
      value: String(overview.activeFundCount),
      detail: "Habilitados no Dashboard",
      icon: Building2,
      iconClass: "bg-slate-100 text-slate-700",
      accentClass: "border-t-slate-500",
    },
    {
      label: "VOP consolidado do dia",
      value: formatVop(overview.vop.dailyAmount),
      detail: `${cutoff} · ${coverage}`,
      icon: Activity,
      iconClass: partialCoverage
        ? "bg-amber-50 text-amber-700"
        : "bg-emerald-50 text-emerald-700",
      accentClass: partialCoverage ? "border-t-amber-500" : "border-t-emerald-600",
    },
    {
      label: "VOP consolidado no mês",
      value: formatVop(overview.vop.monthlyAmount),
      detail: `${cutoff} · ${coverage}`,
      icon: CalendarRange,
      iconClass: partialCoverage
        ? "bg-amber-50 text-amber-700"
        : "bg-teal-50 text-teal-700",
      accentClass: partialCoverage ? "border-t-amber-500" : "border-t-teal-600",
    },
  ];

  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <article
            className={`rounded-lg border border-slate-200 border-t-4 bg-white p-5 shadow-sm ${card.accentClass}`}
            key={card.label}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {card.label}
                </p>
                <p className="mt-3 truncate text-2xl font-semibold tracking-tight text-slate-950">
                  {card.value}
                </p>
              </div>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${card.iconClass}`}>
                <Icon aria-hidden="true" className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">{card.detail}</p>
          </article>
        );
      })}
    </section>
  );
}
