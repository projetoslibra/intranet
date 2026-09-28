"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { SyncedHorizontalScroll } from "@/components/synced-horizontal-scroll";
import {
  filterAndSortFunds,
  toggleExpandedFund,
  type FundSortMode,
} from "@/features/dashboard/fund-overview-state";
import type {
  DashboardFundRow,
  FundOperationalStatus,
} from "@/server/dashboard/dashboard-overview";

const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percentFormatter = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const termFormatter = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthlyRateFormatter = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 4, maximumFractionDigits: 4 });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

function operationalFallback(status: FundOperationalStatus) {
  if (status === "no_operations") return "Sem operações";
  if (status === "not_integrated") return "Não integrado";
  return "Sem dados";
}

function formatVopAmount(value: number | null, status: FundOperationalStatus) {
  if (status === "not_integrated") return "Não integrado";
  return value === null ? "Sem dados" : currencyFormatter.format(value);
}

function formatReturn(value: number) {
  return `${percentFormatter.format(value)}%`;
}

function returnClassName(value: number) {
  if (value > 0) return "text-emerald-700";
  if (value < 0) return "text-red-700";
  return "text-slate-500";
}

function DetailCard({ label, value, detail, valueClassName = "text-slate-950" }: {
  label: string;
  value: string;
  detail?: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-base font-semibold ${valueClassName}`}>{value}</p>
      {detail ? <p className="mt-1 text-xs text-slate-500">{detail}</p> : null}
    </div>
  );
}

function FundDetails({ fund }: { fund: DashboardFundRow }) {
  const total = fund.totalPl ?? 0;
  const shares = [
    { label: "Sênior", value: fund.seniorValue, color: "bg-blue-600" },
    { label: "Mezanino", value: fund.mezzanineValue, color: "bg-violet-500" },
    { label: "Júnior", value: fund.juniorValue, color: "bg-emerald-500" },
  ];

  return (
    <div className="grid gap-5 bg-slate-50/80 p-5 xl:grid-cols-3">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-950">Composição do PL</h3>
        <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-slate-100">
          {shares.map((share) => (
            <span
              className={share.color}
              key={share.label}
              style={{ width: total > 0 ? `${(share.value / total) * 100}%` : "0%" }}
            />
          ))}
        </div>
        <div className="mt-4 space-y-3">
          {shares.map((share) => (
            <div className="flex items-center justify-between gap-4 text-sm" key={share.label}>
              <span className="flex items-center gap-2 text-slate-600">
                <span className={`h-2.5 w-2.5 rounded-full ${share.color}`} />
                {share.label}
              </span>
              <span className="text-right font-semibold text-slate-950">
                {currencyFormatter.format(share.value)}
                <span className="ml-2 text-xs font-normal text-slate-500">
                  {total > 0 ? `${percentFormatter.format((share.value / total) * 100)}%` : "0,0000%"}
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-slate-950">Rentabilidade</h3>
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
          {[
            ["Diária", fund.dailyReturn],
            ["Mensal", fund.monthReturn],
            ["Anual", fund.yearReturn],
          ].map(([label, value]) => (
            <DetailCard
              key={String(label)}
              label={`Rent. ${label}`}
              value={fund.financialStatus === "ready" ? formatReturn(Number(value)) : "Sem dados"}
              valueClassName={fund.financialStatus === "ready" ? returnClassName(Number(value)) : "text-slate-500"}
            />
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-slate-950">Economia do mês</h3>
        <div className="grid gap-3">
          <DetailCard
            label="Receita média"
            value={fund.economicsStatus === "ready" ? currencyFormatter.format(fund.averageMonthlyRevenue) : "Sem dados"}
            detail={fund.economicsStatus === "ready" ? `Total ${currencyFormatter.format(fund.monthlyRevenueTotal)} · ${fund.monthlyRevenuePeriods} períodos` : "Fonte mensal indisponível"}
          />
          <DetailCard
            label="Custo médio"
            value={fund.economicsStatus === "ready" ? currencyFormatter.format(fund.averageMonthlyCost) : "Sem dados"}
            detail={fund.economicsStatus === "ready" ? `Total ${currencyFormatter.format(fund.monthlyCostTotal)} · ${fund.monthlyCostPeriods} períodos` : "Fonte mensal indisponível"}
          />
        </div>
      </section>
    </div>
  );
}

export function FundOverviewTable({ funds }: { funds: DashboardFundRow[] }) {
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<FundSortMode>("name");
  const [expandedFundId, setExpandedFundId] = useState<string | null>(null);
  const visibleFunds = useMemo(
    () => filterAndSortFunds(funds, query, sortMode),
    [funds, query, sortMode]
  );
  const latestPositionTime = Math.max(...funds.map((fund) => fund.positionDate?.getTime() ?? 0));

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Visão comparativa dos fundos</h2>
          <p className="mt-1 text-sm text-slate-500">Compare os principais indicadores e expanda uma linha para ver os detalhes.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative min-w-[240px]">
            <span className="sr-only">Buscar fundo</span>
            <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/15"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar fundo ou CNPJ"
              type="search"
              value={query}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <span>Ordenar</span>
            <select
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
              onChange={(event) => setSortMode(event.target.value as FundSortMode)}
              value={sortMode}
            >
              <option value="name">Nome</option>
              <option value="pl_desc">Maior PL</option>
              <option value="daily_vop_desc">Maior VOP diário</option>
              <option value="monthly_vop_desc">Maior VOP mensal</option>
              <option value="monthly_return_desc">Maior rentabilidade mensal</option>
            </select>
          </label>
        </div>
      </div>

      {visibleFunds.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-500">Nenhum fundo encontrado para essa busca.</p>
      ) : (
        <SyncedHorizontalScroll label="Comparativo dos fundos">
          <table className="min-w-[1320px] border-separate border-spacing-0 text-sm">
            <thead className="sticky top-16 z-20">
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="sticky left-0 z-20 min-w-[230px] border-b border-r border-slate-200 bg-slate-50 px-4 py-3 text-left font-semibold">Fundo</th>
                <th className="min-w-[125px] border-b border-slate-200 px-4 py-3 text-left font-semibold">Atualização</th>
                <th className="min-w-[155px] border-b border-slate-200 px-4 py-3 text-right font-semibold">PL</th>
                <th className="min-w-[150px] border-b border-slate-200 px-4 py-3 text-right font-semibold">VOP dia</th>
                <th className="min-w-[150px] border-b border-slate-200 px-4 py-3 text-right font-semibold">VOP mês</th>
                <th className="min-w-[125px] border-b border-slate-200 px-4 py-3 text-right font-semibold">Prazo médio</th>
                <th className="min-w-[135px] border-b border-slate-200 px-4 py-3 text-right font-semibold">Taxa média a.m.</th>
                <th className="min-w-[145px] border-b border-slate-200 px-4 py-3 text-right font-semibold">Rent. mensal</th>
                <th className="w-14 border-b border-slate-200 px-3 py-3"><span className="sr-only">Detalhes</span></th>
              </tr>
            </thead>
            <tbody>
              {visibleFunds.map((fund) => {
                const expanded = expandedFundId === fund.id;
                const stale = fund.positionDate !== null && fund.positionDate.getTime() < latestPositionTime;
                return (
                  <Fragment key={fund.id}>
                    <tr className="group bg-white transition hover:bg-slate-50">
                      <td className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-4 py-4 group-hover:bg-slate-50">
                        <div className="flex items-center gap-3">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-slate-950">{fund.name}</span>
                            <span className="mt-0.5 block truncate text-xs text-slate-500">{fund.cnpj}</span>
                          </span>
                        </div>
                      </td>
                      <td className="border-b border-slate-100 px-4 py-4">
                        {fund.positionDate ? (
                          <span className={stale ? "font-medium text-amber-700" : "text-slate-600"}>
                            {stale ? "Defasado · " : ""}{dateFormatter.format(fund.positionDate)}
                          </span>
                        ) : <span className="text-slate-400">Sem dados</span>}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-4 text-right font-semibold text-slate-950">{fund.totalPl === null ? "Sem dados" : currencyFormatter.format(fund.totalPl)}</td>
                      <td className="border-b border-slate-100 px-4 py-4 text-right font-medium text-slate-800">{formatVopAmount(fund.vop.dailyAmount, fund.vop.status)}</td>
                      <td className="border-b border-slate-100 px-4 py-4 text-right font-medium text-slate-800">{formatVopAmount(fund.vop.monthlyAmount, fund.vop.status)}</td>
                      <td className="border-b border-slate-100 px-4 py-4 text-right text-slate-700">{fund.vop.status === "ready" && fund.vop.termDays !== null ? `${termFormatter.format(fund.vop.termDays)} dias` : operationalFallback(fund.vop.status)}</td>
                      <td className="border-b border-slate-100 px-4 py-4 text-right text-slate-700">{fund.vop.status === "ready" && fund.vop.monthlyRate !== null ? `${monthlyRateFormatter.format(fund.vop.monthlyRate)} a.m.` : operationalFallback(fund.vop.status)}</td>
                      <td className={`border-b border-slate-100 px-4 py-4 text-right font-semibold ${fund.financialStatus === "ready" ? returnClassName(fund.monthReturn) : "text-slate-400"}`}>{fund.financialStatus === "ready" ? formatReturn(fund.monthReturn) : "Sem dados"}</td>
                      <td className="border-b border-slate-100 px-3 py-4 text-center">
                        <button
                          aria-expanded={expanded}
                          aria-label={`${expanded ? "Recolher" : "Expandir"} detalhes de ${fund.name}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                          onClick={() => setExpandedFundId((current) => toggleExpandedFund(current, fund.id))}
                          type="button"
                        >
                          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </td>
                    </tr>
                    {expanded ? <tr><td className="border-b border-slate-200 p-0" colSpan={9}><FundDetails fund={fund} /></td></tr> : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </SyncedHorizontalScroll>
      )}
    </section>
  );
}
