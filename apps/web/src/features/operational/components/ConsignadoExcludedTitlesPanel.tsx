"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Download, Loader2, Search } from "lucide-react";
import type {
  ExclusionCategory,
  ExclusionReport,
  ExclusionReportFilters,
  ExclusionSituation,
} from "@/server/operational/consignado-exclusion-report";
import type { InitialExclusionReportState } from "@/server/operational/consignado-exclusion-report-page";

const categoryLabels: Record<ExclusionCategory, string> = {
  NOT_FOUND_IN_STOCK: "Não encontrado no estoque",
  OPERATOR_EXCLUDED: "Excluído pelo operador",
  NOT_APPROVED: "Não aprovado",
  PDD_RECOVERY: "Recuperação de PDD",
  OTHER_DIVERGENCE: "Outra divergência",
};

const situationLabels: Record<ExclusionSituation, string> = {
  AVAILABLE: "Disponível",
  ACTIVE_RECONCILIATION: "Usado em conciliação ativa",
  UNDONE_HISTORY: "Histórico desfeito",
};

function money(value: string | number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(value)) : "—";
}

function dateTime(value: string | null) {
  return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value)) : "—";
}

function paramsFrom(filters: ExclusionReportFilters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, String(value)); });
  return params;
}

export function ConsignadoExcludedTitlesPanel({ initialState }: { initialState: InitialExclusionReportState }) {
  const [report, setReport] = useState<ExclusionReport | null>(initialState.report);
  const [filters, setFilters] = useState<ExclusionReportFilters>(initialState.filters);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState(initialState.message ?? "");
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const exportHref = useMemo(() => report ? `/api/operacional/consignado/titulos-fora-remessa/export?${paramsFrom({ ...report.filters, cursor: undefined })}` : null, [report]);
  const hasScopedLink = Boolean(filters.batchId || filters.remittanceId);

  function change<Key extends keyof ExclusionReportFilters>(key: Key, value: ExclusionReportFilters[Key]) {
    setFilters((current) => ({ ...current, [key]: value || undefined, cursor: undefined }));
    setCursorHistory([]);
  }

  async function load(nextFilters: ExclusionReportFilters) {
    setPending(true); setFeedback("");
    try {
      const response = await fetch(`/api/operacional/consignado/titulos-fora-remessa?${paramsFrom(nextFilters)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.message);
      setReport(payload.report);
      setFilters(payload.report.filters);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Erro ao consultar títulos fora da remessa.");
    } finally { setPending(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setCursorHistory([]);
    await load({ ...filters, cursor: undefined });
  }

  async function clear() {
    const next = { limit: 50 };
    setFilters(next);
    setCursorHistory([]);
    await load(next);
  }

  async function clearScope() {
    const next = { ...filters, batchId: undefined, remittanceId: undefined, cursor: undefined };
    setFilters(next);
    setCursorHistory([]);
    await load(next);
  }

  async function nextPage() {
    if (!report?.page.nextCursor) return;
    setCursorHistory((current) => [...current, filters.cursor ?? ""]);
    await load({ ...filters, cursor: report.page.nextCursor });
  }

  async function previousPage() {
    const previous = cursorHistory.at(-1);
    if (previous === undefined) return;
    setCursorHistory((current) => current.slice(0, -1));
    await load({ ...filters, cursor: previous || undefined });
  }

  return <div className="space-y-5">
    <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
      <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={submit}>
        <label className="text-sm">Remessa gerada desde<input className="mt-1 h-10 w-full rounded border border-slate-200 px-3" type="date" value={filters.generatedFrom ?? ""} onChange={(event) => change("generatedFrom", event.target.value)} /></label>
        <label className="text-sm">Remessa gerada até<input className="mt-1 h-10 w-full rounded border border-slate-200 px-3" type="date" value={filters.generatedTo ?? ""} onChange={(event) => change("generatedTo", event.target.value)} /></label>
        <label className="text-sm">Fluxo<select className="mt-1 h-10 w-full rounded border border-slate-200 px-3" value={filters.source ?? ""} onChange={(event) => change("source", event.target.value as ExclusionReportFilters["source"])}><option value="">Todos</option><option value="BMP">BMP</option><option value="UY3">UY3</option></select></label>
        <label className="text-sm">Originador<input className="mt-1 h-10 w-full rounded border border-slate-200 px-3" placeholder="Código ou nome" value={filters.originator ?? ""} onChange={(event) => change("originator", event.target.value)} /></label>
        <label className="text-sm">Arquivo do lote<input className="mt-1 h-10 w-full rounded border border-slate-200 px-3" value={filters.batchFile ?? ""} onChange={(event) => change("batchFile", event.target.value)} /></label>
        <label className="text-sm">Arquivo da remessa<input className="mt-1 h-10 w-full rounded border border-slate-200 px-3" value={filters.remittanceFile ?? ""} onChange={(event) => change("remittanceFile", event.target.value)} /></label>
        <label className="text-sm">Categoria<select className="mt-1 h-10 w-full rounded border border-slate-200 px-3" value={filters.category ?? ""} onChange={(event) => change("category", event.target.value as ExclusionReportFilters["category"])}><option value="">Todas</option>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-sm">Situação<select className="mt-1 h-10 w-full rounded border border-slate-200 px-3" value={filters.situation ?? ""} onChange={(event) => change("situation", event.target.value as ExclusionReportFilters["situation"])}><option value="">Todas</option>{Object.entries(situationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-sm md:col-span-2">Contrato, sacado ou CPF<input className="mt-1 h-10 w-full rounded border border-slate-200 px-3" value={filters.search ?? ""} onChange={(event) => change("search", event.target.value)} /></label>
        <label className="text-sm">Itens por página<select className="mt-1 h-10 w-full rounded border border-slate-200 px-3" value={filters.limit} onChange={(event) => change("limit", Number(event.target.value))}><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label>
        <div className="flex flex-wrap items-end gap-2">
          <button className="inline-flex h-10 items-center gap-2 rounded bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={pending} type="submit">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Filtrar</button>
          <button className="h-10 rounded border border-slate-300 px-3 text-sm font-semibold disabled:opacity-60" disabled={pending} onClick={() => void clear()} type="button">Limpar</button>
        </div>
      </form>
      {hasScopedLink ? <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800"><span>Exibindo o recorte aberto a partir de um lote ou remessa.</span><button className="font-semibold underline" disabled={pending} onClick={() => void clearScope()} type="button">Remover recorte</button></div> : null}
      {feedback ? <p aria-live="polite" className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{feedback}</p> : null}
    </section>

    {report ? <>
    <section className="grid gap-3 sm:grid-cols-3">
      {[['Títulos', report.summary.total.count.toLocaleString('pt-BR')], ['Valor de face', money(report.summary.total.titleAmount)], ['Valor pago', money(report.summary.total.paidAmount)]].map(([label, value]) => <div className="rounded border border-slate-200 bg-white p-4 shadow-executive" key={label}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold text-slate-950">{value}</p></div>)}
    </section>

    {report.items.length ? <section className="grid gap-3 lg:grid-cols-2">
      <div className="rounded border border-slate-200 bg-white p-4 shadow-executive"><h2 className="text-sm font-semibold">Por categoria</h2><div className="mt-3 flex flex-wrap gap-2">{report.summary.byCategory.map((item) => <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-700" key={item.key}>{categoryLabels[item.key]}: <strong>{item.count}</strong> · {money(item.paidAmount)}</span>)}</div></div>
      <div className="rounded border border-slate-200 bg-white p-4 shadow-executive"><h2 className="text-sm font-semibold">Por situação</h2><div className="mt-3 flex flex-wrap gap-2">{report.summary.bySituation.map((item) => <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-700" key={item.key}>{situationLabels[item.key]}: <strong>{item.count}</strong> · {money(item.paidAmount)}</span>)}</div></div>
    </section> : null}

    <section className="rounded border border-slate-200 bg-white shadow-executive">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 p-5">
        <div><h2 className="font-semibold">Resultado</h2><p className="mt-1 text-sm text-slate-500">Valores de face e pago preservam os snapshots da geração da remessa.</p></div>
        <a className="inline-flex h-10 items-center gap-2 rounded border border-slate-300 px-3 text-sm font-semibold" href={exportHref ?? undefined}><Download className="h-4 w-4" />Exportar Excel</a>
      </div>
      {report.items.length ? <><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-3 py-3 text-left">Remessa / lote</th><th className="px-3 py-3 text-left">Título</th><th className="px-3 py-3 text-left">Sacado</th><th className="px-3 py-3 text-left">Categoria / motivo</th><th className="px-3 py-3 text-right">Face</th><th className="px-3 py-3 text-right">Pago</th><th className="px-3 py-3 text-left">Situação</th></tr></thead><tbody>{report.items.map((item) => <tr className="border-t border-slate-200 align-top" key={item.id}><td className="px-3 py-3"><p className="font-medium">{item.remittanceFile}</p><p className="mt-1 text-xs text-slate-500">{dateTime(item.generatedAt)} · {item.source} · {item.originator}</p><p className="mt-1 max-w-64 break-all text-xs text-slate-500">{item.batchFile}</p></td><td className="px-3 py-3"><p className="font-medium">{item.contractNumber ?? item.yourNumber ?? "—"}</p><p className="mt-1 text-xs text-slate-500">Documento {item.documentNumber ?? "—"} · linha {item.sourceRow} · vence {date(item.dueDate)}</p></td><td className="px-3 py-3"><p>{item.debtorName ?? "—"}</p><p className="mt-1 text-xs text-slate-500">{item.debtorDocument ?? "—"}</p></td><td className="max-w-72 px-3 py-3"><p className="font-medium">{categoryLabels[item.category]}</p><p className="mt-1 text-xs text-slate-500">{item.reason}</p></td><td className="px-3 py-3 text-right font-medium">{money(item.titleAmount)}</td><td className="px-3 py-3 text-right font-medium">{money(item.paidAmount)}</td><td className="px-3 py-3"><p className="font-medium">{situationLabels[item.situation]}</p>{item.reconciliationDate ? <p className="mt-1 text-xs text-slate-500">Conciliado em {dateTime(item.reconciliationDate)}{item.bankEntry ? ` · ${item.bankEntry}` : ""}</p> : null}</td></tr>)}</tbody></table></div><div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3"><p className="text-xs text-slate-500">Página com até {report.page.limit} itens · {report.summary.total.count.toLocaleString("pt-BR")} no conjunto filtrado</p><div className="flex gap-2"><button className="h-9 rounded border border-slate-300 px-3 text-sm font-semibold disabled:opacity-50" disabled={pending || !cursorHistory.length} onClick={() => void previousPage()} type="button">Anterior</button><button className="h-9 rounded border border-slate-300 px-3 text-sm font-semibold disabled:opacity-50" disabled={pending || !report.page.hasMore} onClick={() => void nextPage()} type="button">Próxima</button></div></div></> : <div className="p-8 text-center text-sm text-slate-500">Nenhum título fora da remessa encontrado para os filtros aplicados.</div>}
    </section>
    </> : <section className="rounded border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 shadow-executive"><h2 className="font-semibold">Refine a consulta para carregar o relatório</h2><p className="mt-1">Ajuste o período ou os demais filtros acima e selecione Filtrar.</p></section>}
  </div>;
}
