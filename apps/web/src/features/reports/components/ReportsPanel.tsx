"use client";

import React, { useMemo, useState } from "react";
import { ArrowLeftRight, Boxes, Download, ReceiptText, type LucideIcon } from "lucide-react";
import type { ReportAvailability, ReportFundAvailability } from "@/server/reports/report-data";
import type { ReportPeriod, ReportType } from "@/server/reports/report-export";
import { availableDates, availablePeriods, reportExportHref } from "../report-selection";

type ReportCardProps = {
  type: ReportType;
  title: string;
  description: string;
  source: string;
  icon: LucideIcon;
  availability: ReportFundAvailability[];
  canExport: boolean;
  requiresPeriod?: boolean;
};

const periodLabels: Record<ReportPeriod, string> = {
  MANHA: "Manhã",
  TARDE: "Tarde",
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${date}T00:00:00.000Z`));
}

function ReportCard({
  type,
  title,
  description,
  source,
  icon: Icon,
  availability,
  canExport,
  requiresPeriod = false,
}: ReportCardProps) {
  const [fund, setFund] = useState("");
  const [date, setDate] = useState("");
  const [period, setPeriod] = useState<ReportPeriod | "">("");
  const dates = useMemo(() => availableDates(availability, fund), [availability, fund]);
  const periods = useMemo(() => availablePeriods(availability, fund, date), [availability, fund, date]);
  const href = reportExportHref(type, fund, date, period);

  return (
    <article className="flex min-h-[360px] flex-col rounded border border-slate-200 bg-white p-5 shadow-executive">
      <div className="flex items-start justify-between gap-4">
        <div className="rounded bg-slate-100 p-2.5 text-slate-700">
          <Icon aria-hidden="true" className="h-5 w-5" />
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
          {source}
        </span>
      </div>

      <div className="mt-4">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <p className="mt-1 min-h-10 text-sm leading-5 text-slate-500">{description}</p>
      </div>

      {availability.length ? (
        <div className="mt-5 space-y-3">
          <label className="block text-sm font-medium text-slate-700">
            Fundo
            <select
              className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              value={fund}
              onChange={(event) => {
                setFund(event.target.value);
                setDate("");
                setPeriod("");
              }}
            >
              <option value="">Selecione o fundo</option>
              {availability.map((item) => <option key={item.fund} value={item.fund}>{item.fund}</option>)}
            </select>
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Data
            <select
              className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:bg-slate-50 disabled:text-slate-400"
              disabled={!fund}
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                setPeriod("");
              }}
            >
              <option value="">Selecione a data</option>
              {dates.map((value) => <option key={value} value={value}>{formatDate(value)}</option>)}
            </select>
          </label>

          {requiresPeriod ? (
            <label className="block text-sm font-medium text-slate-700">
              Período
              <select
                className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:bg-slate-50 disabled:text-slate-400"
                disabled={!date}
                value={period}
                onChange={(event) => setPeriod(event.target.value as ReportPeriod | "")}
              >
                <option value="">Selecione o período</option>
                {periods.map((value) => <option key={value} value={value}>{periodLabels[value]}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      ) : (
        <p className="mt-5 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Nenhum dado disponível para este relatório.
        </p>
      )}

      <div className="mt-auto pt-5">
        {href && canExport ? (
          <a
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded bg-primary px-4 text-sm font-semibold text-white hover:opacity-90"
            href={href}
          >
            <Download className="h-4 w-4" />
            Exportar Excel
          </a>
        ) : (
          <span
            aria-disabled="true"
            className="inline-flex h-10 w-full cursor-not-allowed items-center justify-center gap-2 rounded bg-slate-100 px-4 text-sm font-semibold text-slate-400"
          >
            <Download className="h-4 w-4" />
            Exportar Excel
          </span>
        )}
      </div>
    </article>
  );
}

export function ReportsPanel({ availability, canExport }: { availability: ReportAvailability; canExport: boolean }) {
  return (
    <div className="space-y-4">
      {!canExport ? (
        <p className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Seu acesso permite visualizar os relatórios, mas não exportá-los.
        </p>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-3">
        <ReportCard
          availability={availability.stock}
          canExport={canExport}
          description="Posição completa dos recebíveis existentes no estoque do fundo e da data selecionados."
          icon={Boxes}
          source="FIDC_ESTOQUES"
          title="Estoque"
          type="stock"
        />
        <ReportCard
          availability={availability.settled}
          canExport={canExport}
          description="Recebíveis liquidados ou baixados na posição do fundo e da data selecionados."
          icon={ReceiptText}
          source="FIDC_LIQUIDADOS_BAIXADOS"
          title="Liquidados"
          type="settled"
        />
        <ReportCard
          availability={availability["open-movements"]}
          canExport={canExport}
          description="Movimentos ainda em aberto, separados por fundo, data de referência e período de processamento."
          icon={ArrowLeftRight}
          requiresPeriod
          source="FIDC_MOVIMENTOS_ABERTOS"
          title="Movimentos em aberto"
          type="open-movements"
        />
      </section>
    </div>
  );
}
