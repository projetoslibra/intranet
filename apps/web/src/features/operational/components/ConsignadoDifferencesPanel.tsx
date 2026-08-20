"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, Download, Loader2, Search } from "lucide-react";
import type {
  DifferenceReport,
  DifferenceReportFilters,
  DifferenceReportItem,
  InitialDifferenceReportState,
} from "@/server/operational/consignado-difference-report";
import {
  differenceCategoryLabels,
  differenceDirectionLabels,
  differenceStatusLabels,
} from "@/server/operational/consignado-difference-report";
import { decimalAmountToCents, formatCentsAsBRL } from "../consignado-difference-composer";
import {
  applyDifferenceResolutionToReport,
  retryFiltersWithoutInvalidCursor,
} from "../consignado-difference-resolution";

function money(value: string) {
  const cents = decimalAmountToCents(value);
  return cents === null ? value : formatCentsAsBRL(cents);
}

function dateTime(value: string | null) {
  return value ? new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value)) : "—";
}

function civilDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(value));
}

function paramsFrom(filters: DifferenceReportFilters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, String(value)); });
  return params;
}

function originEntries(item: DifferenceReportItem) {
  return item.entries.map((entry) => [civilDate(entry.transactionDate), entry.description, entry.document].filter(Boolean).join(" · ")).join(" | ");
}

function originRemittances(item: DifferenceReportItem) {
  return item.remittances.map((remittance) => `${remittance.fileName} · ${remittance.batchFile}`).join(" | ");
}

export function ConsignadoDifferencesPanel({ initialState, canManage }: { initialState: InitialDifferenceReportState; canManage: boolean }) {
  const [report, setReport] = useState<DifferenceReport | null>(initialState.report);
  const [filters, setFilters] = useState<DifferenceReportFilters>(initialState.filters);
  const [pending, setPending] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState(initialState.message ?? "");
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const exportHref = useMemo(() => report
    ? `/api/operacional/consignado/diferencas/export?${paramsFrom({ ...report.filters, cursor: undefined })}`
    : null, [report]);

  function change<Key extends keyof DifferenceReportFilters>(key: Key, value: DifferenceReportFilters[Key]) {
    setFilters((current) => ({ ...current, [key]: value || undefined, cursor: undefined }));
    setCursorHistory([]);
  }

  async function load(nextFilters: DifferenceReportFilters, clearFeedback = true) {
    setPending(true);
    if (clearFeedback) setFeedback("");
    try {
      const requestReport = async (requestedFilters: DifferenceReportFilters) => {
        const response = await fetch(`/api/operacional/consignado/diferencas?${paramsFrom(requestedFilters)}`, { cache: "no-store" });
        return { response, payload: await response.json() };
      };
      let requestedFilters = nextFilters;
      let { response, payload } = await requestReport(requestedFilters);
      const retryFilters = !payload.ok ? retryFiltersWithoutInvalidCursor(requestedFilters, response.status, payload.message) : null;
      if (retryFilters) {
        requestedFilters = retryFilters;
        setFilters(retryFilters);
        setCursorHistory([]);
        ({ response, payload } = await requestReport(requestedFilters));
      }
      if (!payload.ok) throw new Error(payload.message);
      setReport(payload.report);
      setFilters(payload.report.filters);
      return { ok: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao consultar diferenças bancárias.";
      setFeedback(message);
      return { ok: false as const, message };
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

  async function resolve(item: DifferenceReportItem) {
    const resolutionNote = notes[item.id]?.trim() ?? "";
    if (resolutionNote.length < 5) {
      setFeedback("Informe uma nota de resolução com ao menos 5 caracteres.");
      return;
    }
    setResolvingId(item.id);
    setFeedback("");
    try {
      const response = await fetch(`/api/operacional/consignado/diferencas/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolutionNote }),
      });
      const payload = await response.json();
      if (!payload.ok) {
        if (response.status === 409) await load(filters, false);
        throw new Error(payload.message);
      }
      setReport((current) => current ? applyDifferenceResolutionToReport(current, payload.result) : current);
      setNotes((current) => { const next = { ...current }; delete next[item.id]; return next; });
      const refreshed = await load(filters, false);
      setFeedback(refreshed.ok ? payload.message : `${payload.message} Não foi possível atualizar a lista: ${refreshed.message}`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Erro ao resolver diferença bancária.");
    } finally { setResolvingId(null); }
  }

  return <div className="space-y-5">
    <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
      <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={submit}>
        <label className="text-sm">Criada desde<input className="mt-1 h-10 w-full rounded border border-slate-200 px-3" type="date" value={filters.createdFrom ?? ""} onChange={(event) => change("createdFrom", event.target.value)} /></label>
        <label className="text-sm">Criada até<input className="mt-1 h-10 w-full rounded border border-slate-200 px-3" type="date" value={filters.createdTo ?? ""} onChange={(event) => change("createdTo", event.target.value)} /></label>
        <label className="text-sm">Status<select className="mt-1 h-10 w-full rounded border border-slate-200 px-3" value={filters.status ?? ""} onChange={(event) => change("status", event.target.value as DifferenceReportFilters["status"])}><option value="">Todos</option>{Object.entries(differenceStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-sm">Direção<select className="mt-1 h-10 w-full rounded border border-slate-200 px-3" value={filters.direction ?? ""} onChange={(event) => change("direction", event.target.value as DifferenceReportFilters["direction"])}><option value="">Todas</option>{Object.entries(differenceDirectionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-sm">Categoria<select className="mt-1 h-10 w-full rounded border border-slate-200 px-3" value={filters.category ?? ""} onChange={(event) => change("category", event.target.value as DifferenceReportFilters["category"])}><option value="">Todas</option>{Object.entries(differenceCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-sm">Entrada<input className="mt-1 h-10 w-full rounded border border-slate-200 px-3" placeholder="Descrição ou documento" value={filters.entry ?? ""} onChange={(event) => change("entry", event.target.value)} /></label>
        <label className="text-sm">Remessa<input className="mt-1 h-10 w-full rounded border border-slate-200 px-3" placeholder="Arquivo da remessa ou lote" value={filters.remittance ?? ""} onChange={(event) => change("remittance", event.target.value)} /></label>
        <label className="text-sm">Busca geral<input className="mt-1 h-10 w-full rounded border border-slate-200 px-3" placeholder="Motivo, nota ou responsável" value={filters.search ?? ""} onChange={(event) => change("search", event.target.value)} /></label>
        <label className="text-sm">Itens por página<select className="mt-1 h-10 w-full rounded border border-slate-200 px-3" value={filters.limit} onChange={(event) => change("limit", Number(event.target.value))}><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label>
        <div className="flex flex-wrap items-end gap-2">
          <button className="inline-flex h-10 items-center gap-2 rounded bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={pending} type="submit">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Filtrar</button>
          <button className="h-10 rounded border border-slate-300 px-3 text-sm font-semibold disabled:opacity-60" disabled={pending} onClick={() => void clear()} type="button">Limpar</button>
        </div>
      </form>
      {feedback ? <p aria-live="polite" className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{feedback}</p> : null}
    </section>

    {report ? <>
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded border border-amber-200 bg-amber-50 p-4 shadow-executive"><p className="text-xs text-amber-800">Pendências em aberto</p><p className="mt-1 text-lg font-semibold text-amber-950">{report.summary.open.count.toLocaleString("pt-BR")}</p></div>
        <div className="rounded border border-amber-200 bg-amber-50 p-4 shadow-executive"><p className="text-xs text-amber-800">Valor total em aberto</p><p className="mt-1 text-lg font-semibold text-amber-950">{money(report.summary.open.amount)}</p></div>
      </section>

      {(report.summary.byCategory.length || report.summary.byDirection.length) ? <section className="grid gap-3 lg:grid-cols-2">
        <div className="rounded border border-slate-200 bg-white p-4 shadow-executive"><h2 className="text-sm font-semibold">Em aberto por categoria</h2><div className="mt-3 flex flex-wrap gap-2">{report.summary.byCategory.map((item) => <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-700" key={item.key}>{differenceCategoryLabels[item.key]}: <strong>{item.count}</strong> · {money(item.amount)}</span>)}</div></div>
        <div className="rounded border border-slate-200 bg-white p-4 shadow-executive"><h2 className="text-sm font-semibold">Em aberto por direção</h2><div className="mt-3 flex flex-wrap gap-2">{report.summary.byDirection.map((item) => <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-700" key={item.key}>{differenceDirectionLabels[item.key]}: <strong>{item.count}</strong> · {money(item.amount)}</span>)}</div></div>
      </section> : null}

      <section className="rounded border border-slate-200 bg-white shadow-executive">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 p-5"><div><h2 className="font-semibold">Diferenças e ajustes</h2><p className="mt-1 text-sm text-slate-500">Resolvidos e cancelados permanecem no histórico; apenas abertos de conciliações ativas formam os indicadores.</p></div><a className="inline-flex h-10 items-center gap-2 rounded border border-slate-300 px-3 text-sm font-semibold" href={exportHref ?? undefined}><Download className="h-4 w-4" />Exportar Excel</a></div>
        {report.items.length ? <><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-3 py-3 text-left">Diferença</th><th className="px-3 py-3 text-left">Origem</th><th className="px-3 py-3 text-left">Responsável / idade</th><th className="px-3 py-3 text-left">Situação</th><th className="px-3 py-3 text-left">Resolução</th></tr></thead><tbody>{report.items.map((item) => {
          const canResolve = canManage && item.status === "OPEN" && item.reconciliationStatus === "ACTIVE";
          return <tr className="border-t border-slate-200 align-top" key={item.id}><td className="max-w-80 px-3 py-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium">{differenceCategoryLabels[item.category]}</p><p className="mt-1 text-xs text-slate-500">{differenceDirectionLabels[item.direction]}</p></div><strong>{money(item.amount)}</strong></div><p className="mt-2 text-xs text-slate-600">{item.reason}</p></td><td className="max-w-96 px-3 py-3"><p className="text-xs"><span className="font-semibold">Entrada:</span> {originEntries(item) || "—"}</p><p className="mt-1 text-xs"><span className="font-semibold">Remessa:</span> {originRemittances(item) || "—"}</p><p className="mt-1 text-xs text-slate-500">Conciliação {item.reconciliationId}</p></td><td className="px-3 py-3"><p>{item.createdBy.name}</p><p className="mt-1 text-xs text-slate-500">{dateTime(item.createdAt)} · {item.ageDays} dia(s)</p></td><td className="px-3 py-3"><p className={item.status === "OPEN" ? "font-semibold text-amber-700" : item.status === "RESOLVED" ? "font-semibold text-emerald-700" : "font-semibold text-slate-500"}>{differenceStatusLabels[item.status]}</p>{item.resolvedAt ? <p className="mt-1 text-xs text-slate-500">{item.resolvedBy?.name ?? "Usuário"} · {dateTime(item.resolvedAt)}</p> : null}{item.cancelledAt ? <p className="mt-1 text-xs text-slate-500">Cancelado em {dateTime(item.cancelledAt)}</p> : null}{item.resolutionNote ? <p className="mt-1 max-w-64 text-xs text-emerald-700">{item.resolutionNote}</p> : null}</td><td className="min-w-72 px-3 py-3">{canResolve ? <div className="space-y-2"><textarea className="min-h-20 w-full rounded border border-slate-200 px-3 py-2 text-sm" maxLength={500} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Justificativa da resolução (mín. 5 caracteres)" value={notes[item.id] ?? ""} /><button className="inline-flex h-9 items-center gap-2 rounded bg-emerald-700 px-3 text-xs font-semibold text-white disabled:opacity-50" disabled={resolvingId === item.id || (notes[item.id]?.trim().length ?? 0) < 5} onClick={() => void resolve(item)} type="button">{resolvingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Marcar como resolvida</button></div> : <span className="text-xs text-slate-500">{item.status === "CANCELLED" ? "Histórico cancelado; resolução indisponível." : item.status === "RESOLVED" ? "Resolução concluída." : "Sem permissão para resolver."}</span>}</td></tr>;
        })}</tbody></table></div><div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3"><p className="text-xs text-slate-500">Página com até {report.page.limit} itens</p><div className="flex gap-2"><button className="h-9 rounded border border-slate-300 px-3 text-sm font-semibold disabled:opacity-50" disabled={pending || !cursorHistory.length} onClick={() => void previousPage()} type="button">Anterior</button><button className="h-9 rounded border border-slate-300 px-3 text-sm font-semibold disabled:opacity-50" disabled={pending || !report.page.hasMore} onClick={() => void nextPage()} type="button">Próxima</button></div></div></> : <div className="p-8 text-center text-sm text-slate-500">Nenhuma diferença encontrada para os filtros aplicados.</div>}
      </section>
    </> : <section className="rounded border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 shadow-executive"><h2 className="font-semibold">Refine a consulta para carregar o relatório</h2><p className="mt-1">Ajuste o período ou os demais filtros acima e selecione Filtrar.</p></section>}
  </div>;
}
