"use client";

import { useRef, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Download, FileCheck2, Loader2, Search, UploadCloud } from "lucide-react";

type Candidate = { id: string; yourNumber: string | null; documentNumber: string | null; debtorName: string; debtorDocument: string; nominalValue: string; originalDueDate: string | null; adjustedDueDate: string | null; cedentName: string };
type SettlementItem = { id: string; sourceRow: number; occurrence: string | null; contractNumber: string | null; yourNumber: string | null; debtorName: string | null; debtorDocument: string | null; titleAmount: string; paidAmount: string; status: string; statusReason: string | null; approved: boolean; exclusionReason: string | null; matchedStockPosition: Candidate | null; corrections: Array<{ id: string; justification: string; replacementYourNumber: string | null; createdAt: string }> };
type Remittance = { id: string; fileName: string; status: string; stockStatus: string; totalItems: number; totalAmount: string; allocatedAmount: string; generatedAt: string };
type Batch = { id: string; source: "BMP" | "UY3"; fileName: string; referenceDate: string; status: string; totalItems: number; fullItems: number; partialItems: number; issueItems: number; receivedAmount: string; matchedAmount: string; excludedAmount: string; createdAt: string; originator: { code: string; name: string } | null; stockBatch: { referenceDate: string | null; version: number }; items: SettlementItem[]; remittances: Remittance[] };
type Workspace = { originators: Array<{ id: string; code: string; name: string; source: "BMP" | "UY3" }>; batches: Batch[] };
type IssueFilter = "UNDERPAID" | "NOT_FOUND" | "OTHER";

const statusLabel: Record<string, string> = { FULL_MATCH: "Baixa completa", PARTIAL_MATCH: "Baixa parcial", NOT_FOUND: "Não encontrado", AMBIGUOUS: "Ambíguo", DIVERGENT: "Divergente", DUPLICATE: "Duplicado", MANUALLY_MATCHED: "Corrigido manualmente", EXCLUDED: "Excluído" };
const stockStatusLabel: Record<string, string> = { AWAITING_NEXT_STOCK: "Aguardando próximo estoque", CONFIRMED: "Baixa confirmada", STILL_IN_STOCK: "Ainda no estoque", REVIEW_REQUIRED: "Revisão necessária" };
function money(value: string | number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value)); }
function date(value: string | null) { return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(value)) : "—"; }
function debtorKey(item: SettlementItem) {
  const document = String(item.debtorDocument ?? "").replace(/\D/g, "");
  if (document) return `DOCUMENT:${document}`;
  const name = String(item.debtorName ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase().replace(/\s+/g, " ");
  return name ? `NAME:${name}` : null;
}
function underpaid77(item: SettlementItem) {
  const nominal = Number(item.matchedStockPosition?.nominalValue ?? 0);
  const paid = Number(item.paidAmount);
  if (item.status !== "DIVERGENT" || item.occurrence !== "77" || nominal <= 0 || paid <= 0 || paid >= nominal) return null;
  const difference = nominal - paid;
  return { nominal, paid, difference, percentage: (difference / nominal) * 100 };
}
function underpaidTotals(items: SettlementItem[]) {
  return items.reduce((totals, item) => {
    const values = underpaid77(item);
    if (!values) return totals;
    totals.nominal += values.nominal;
    totals.paid += values.paid;
    totals.difference += values.difference;
    return totals;
  }, { nominal: 0, paid: 0, difference: 0 });
}

export function ConsignadoSettlementPanel({ initialWorkspace, canManage }: { initialWorkspace: Workspace; canManage: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [source, setSource] = useState<"BMP" | "UY3">("BMP");
  const [originator, setOriginator] = useState("GIBB");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [searches, setSearches] = useState<Record<string, string>>({});
  const [candidates, setCandidates] = useState<Record<string, Candidate[]>>({});
  const [issueFilters, setIssueFilters] = useState<Record<string, IssueFilter>>({});

  async function refresh() {
    const response = await fetch("/api/operacional/consignado/baixas", { cache: "no-store" });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.message);
    setWorkspace(payload.workspace);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setPending(true); setFeedback("");
    try {
      const processFile = async (allowDuplicate: boolean): Promise<void> => {
        const form = new FormData();
        form.set("file", file);
        form.set("source", source);
        form.set("allowDuplicate", String(allowDuplicate));
        if (source === "BMP") form.set("originator", originator);
        const response = await fetch("/api/operacional/consignado/baixas", { method: "POST", body: form });
        const payload = await response.json();
        if (!payload.ok) throw new Error(payload.message);
        if (payload.result?.requiresConfirmation) {
          if (window.confirm(payload.message)) await processFile(true);
          else setFeedback("Reprocessamento cancelado. O lote anterior foi mantido sem alterações.");
          return;
        }
        setFeedback(payload.message);
        fileRef.current!.value = "";
        await refresh();
      };
      await processFile(false);
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Erro ao processar arquivo."); }
    finally { setPending(false); }
  }

  async function search(batchId: string, itemId: string, fallbackQuery?: string) {
    const query = searches[itemId]?.trim() || fallbackQuery?.trim() || "";
    if (fallbackQuery && !searches[itemId]?.trim()) setSearches((current) => ({ ...current, [itemId]: fallbackQuery }));
    try {
      const response = await fetch(`/api/operacional/consignado/baixas/candidatos?batchId=${encodeURIComponent(batchId)}&q=${encodeURIComponent(query)}`);
      const payload = await response.json(); if (!payload.ok) throw new Error(payload.message);
      setCandidates((current) => ({ ...current, [itemId]: payload.candidates }));
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Erro na pesquisa."); }
  }

  async function correct(itemId: string, replacementPositionId: string) {
    const justification = window.prompt("Informe a justificativa da substituição (mínimo 5 caracteres):");
    if (!justification) return;
    const response = await fetch(`/api/operacional/consignado/baixas/items/${itemId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "CORRECT", replacementPositionId, justification }) });
    const payload = await response.json(); setFeedback(payload.message); if (payload.ok) await refresh();
  }

  async function exclude(itemId: string) {
    const reason = window.prompt("Motivo da exclusão:") ?? undefined;
    const response = await fetch(`/api/operacional/consignado/baixas/items/${itemId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "EXCLUDE", reason }) });
    const payload = await response.json(); setFeedback(payload.message); if (payload.ok) await refresh();
  }

  async function approve(itemId: string) {
    if (!window.confirm("Liberar este título pelo valor pago informado no arquivo?")) return;
    const response = await fetch(`/api/operacional/consignado/baixas/items/${itemId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "APPROVE" }) });
    const payload = await response.json(); setFeedback(payload.message); if (payload.ok) await refresh();
  }

  async function approveUnderpaidBulk(batchId: string, count: number, mode: "UP_TO_10" | "GROUPED_DEBTOR") {
    const reason = mode === "UP_TO_10" ? "diferença de até 10%" : "diferença acima de 10% e sacado com múltiplos títulos";
    if (!window.confirm(`Liberar ${count} títulos com ${reason} pelo valor pago informado no arquivo?`)) return;
    setPending(true);
    try {
      const response = await fetch(`/api/operacional/consignado/baixas/${batchId}/aprovar-antecipacoes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }) });
      const payload = await response.json(); setFeedback(payload.message); if (payload.ok) await refresh();
    } finally { setPending(false); }
  }

  async function generate(batchId: string) {
    if (!window.confirm("Gerar a remessa somente com os títulos aptos e aprovados? Os demais ficarão auditados como excluídos.")) return;
    setPending(true);
    try { const response = await fetch(`/api/operacional/consignado/baixas/${batchId}/remessa`, { method: "POST" }); const payload = await response.json(); setFeedback(payload.message); if (payload.ok) await refresh(); }
    finally { setPending(false); }
  }

  function renderIssueItem(batch: Batch, item: SettlementItem, allowUnderpaidApproval = false) {
    const underpaid = underpaid77(item);
    return <div className="rounded border border-slate-200 bg-white p-4" key={item.id}>
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <p className="font-semibold">{item.debtorName ?? "Sacado não informado"}</p>
          <p className="text-xs text-slate-500">Contrato {item.contractNumber ?? item.yourNumber ?? "—"} · CPF {item.debtorDocument ?? "—"} · linha {item.sourceRow}</p>
        </div>
        {underpaid ? <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-right text-xs sm:grid-cols-4">
          <div><p className="text-slate-500">Face</p><p className="font-semibold text-slate-900">{money(underpaid.nominal)}</p></div>
          <div><p className="text-slate-500">Pago</p><p className="font-semibold text-slate-900">{money(underpaid.paid)}</p></div>
          <div><p className="text-slate-500">Diferença</p><p className="font-semibold text-amber-700">{money(underpaid.difference)}</p></div>
          <div><p className="text-slate-500">Percentual</p><p className="font-semibold text-amber-700">{underpaid.percentage.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</p></div>
        </div> : <div className="text-right"><p className="font-semibold">{money(item.paidAmount)}</p><p className="text-xs text-red-600">{statusLabel[item.status] ?? item.status}: {item.statusReason}</p></div>}
      </div>
      {canManage && underpaid ? <div className="mt-3 flex flex-wrap justify-end gap-2">
        {allowUnderpaidApproval ? <button className="h-9 rounded bg-primary px-3 text-sm font-semibold text-white" onClick={() => void approve(item.id)} type="button">Liberar este título</button> : null}
        <button className="h-9 rounded border border-red-200 px-3 text-sm text-red-700" onClick={() => void exclude(item.id)} type="button">Seguir sem este título</button>
      </div> : null}
      {canManage && !underpaid ? <div className="mt-3 flex flex-wrap gap-2">
        <input className="h-9 min-w-64 flex-1 rounded border border-slate-200 px-3 text-sm" placeholder="Contrato, CPF, nome ou título correto" value={searches[item.id] ?? ""} onChange={(event) => setSearches((current) => ({ ...current, [item.id]: event.target.value }))} />
        <button className="inline-flex h-9 items-center gap-2 rounded border border-slate-300 px-3 text-sm" onClick={() => void search(batch.id, item.id, item.debtorDocument ?? item.debtorName ?? undefined)} type="button"><Search className="h-4 w-4" />{item.status === "NOT_FOUND" ? "Abrir títulos do sacado" : "Pesquisar"}</button>
        <button className="h-9 rounded border border-red-200 px-3 text-sm text-red-700" onClick={() => void exclude(item.id)} type="button">Seguir sem este título</button>
      </div> : null}
      {candidates[item.id]?.length ? <div className="mt-3 overflow-x-auto rounded border border-slate-200"><table className="min-w-full text-xs"><thead className="bg-slate-50"><tr><th className="px-3 py-2 text-left">Candidato</th><th className="px-3 py-2 text-left">CPF</th><th className="px-3 py-2 text-left">Vencimento</th><th className="px-3 py-2 text-right">Valor</th><th /></tr></thead><tbody>{candidates[item.id].map((candidate) => <tr className="border-t" key={candidate.id}><td className="px-3 py-2">{candidate.yourNumber ?? candidate.documentNumber} · {candidate.debtorName}</td><td className="px-3 py-2">{candidate.debtorDocument}</td><td className="px-3 py-2">{date(candidate.adjustedDueDate ?? candidate.originalDueDate)}</td><td className="px-3 py-2 text-right">{money(candidate.nominalValue)}</td><td className="px-3 py-2 text-right"><button className="rounded bg-primary px-2 py-1 font-semibold text-white" onClick={() => void correct(item.id, candidate.id)} type="button">Usar este</button></td></tr>)}</tbody></table></div> : null}
    </div>;
  }

  return <div className="space-y-6">
    {canManage ? <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
      <h2 className="font-semibold text-slate-950">Processar arquivo diário</h2>
      <p className="mt-1 text-sm text-slate-500">O arquivo será validado e confrontado com o estoque ativo. Problemas não impedem a geração parcial.</p>
      <form className="mt-5 grid gap-4 md:grid-cols-[180px_220px_1fr_auto] md:items-end" onSubmit={submit}>
        <label className="text-sm">Fluxo<select className="mt-1 h-10 w-full rounded border border-slate-200 px-3" value={source} onChange={(event) => setSource(event.target.value as "BMP" | "UY3")}><option value="BMP">BMP</option><option value="UY3">UY3</option></select></label>
        <label className="text-sm">Originador<select className="mt-1 h-10 w-full rounded border border-slate-200 px-3 disabled:bg-slate-100" disabled={source === "UY3"} value={source === "UY3" ? "UY3" : originator} onChange={(event) => setOriginator(event.target.value)}>{workspace.originators.filter((item) => item.source === source).map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select></label>
        <label className="text-sm">Arquivo<input className="mt-1 block h-10 w-full rounded border border-slate-200 px-3 py-2 text-sm" accept={source === "BMP" ? ".rem,.txt" : ".xlsx"} ref={fileRef} required type="file" /></label>
        <button className="inline-flex h-10 items-center justify-center gap-2 rounded bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={pending}><UploadCloud className="h-4 w-4" />{pending ? "Processando..." : "Processar"}</button>
      </form>
      {feedback ? <p className="mt-4 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{feedback}</p> : null}
    </section> : null}

    <section className="overflow-hidden rounded border border-slate-200 bg-white shadow-executive">
      <div className="border-b border-slate-200 p-5"><h2 className="font-semibold">Lotes de baixa</h2><p className="mt-1 text-sm text-slate-500">Resultado, divergências, correções e remessas geradas.</p></div>
      {workspace.batches.length ? <div className="divide-y divide-slate-200">{workspace.batches.map((batch) => {
        const issues = batch.items.filter((item) => !item.approved && item.status !== "EXCLUDED");
        const underpaidItems = issues.filter((item) => Boolean(underpaid77(item)));
        const underpaidWithinLimit = underpaidItems.filter((item) => (underpaid77(item)?.percentage ?? Infinity) <= 10);
        const debtorCounts = new Map<string, number>();
        batch.items.forEach((item) => { const key = debtorKey(item); if (key) debtorCounts.set(key, (debtorCounts.get(key) ?? 0) + 1); });
        const groupedAboveLimit = underpaidItems.filter((item) => { const key = debtorKey(item); return (underpaid77(item)?.percentage ?? 0) > 10 && Boolean(key && (debtorCounts.get(key) ?? 0) > 1); });
        const individualAboveLimit = underpaidItems.filter((item) => { const key = debtorKey(item); return (underpaid77(item)?.percentage ?? 0) > 10 && (!key || (debtorCounts.get(key) ?? 0) <= 1); });
        const notFoundItems = issues.filter((item) => item.status === "NOT_FOUND");
        const otherItems = issues.filter((item) => !underpaid77(item) && item.status !== "NOT_FOUND");
        const activeFilter = issueFilters[batch.id] ?? (underpaidItems.length ? "UNDERPAID" : notFoundItems.length ? "NOT_FOUND" : "OTHER");
        const totals = underpaidTotals(underpaidItems);
        return <details className="p-5" key={batch.id}>
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4"><div><p className="font-semibold">{batch.source} · {batch.originator?.name} · {batch.fileName}</p><p className="mt-1 text-xs text-slate-500">Estoque {date(batch.stockBatch.referenceDate)} v{batch.stockBatch.version} · {batch.totalItems.toLocaleString("pt-BR")} títulos</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${issues.length ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{issues.length ? `${issues.length} para revisar` : "Pronto"}</span></summary>
          <div className="mt-5 space-y-5">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">{[["Recebidos", batch.totalItems], ["Valor total do arquivo", money(batch.receivedAmount)], ["Completos", batch.fullItems], ["Parciais", batch.partialItems], ["Fora/revisão", batch.issueItems], ["Encontrado", money(batch.matchedAmount)], ["Não incluído", money(batch.excludedAmount)]].map(([label, value]) => <div className="rounded border border-slate-200 bg-slate-50 p-3" key={label}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-semibold">{value}</p></div>)}</div>
            {issues.length ? <section className="rounded border border-amber-200 bg-amber-50/30 p-4">
              <h3 className="font-semibold text-amber-900">Títulos que precisam de decisão</h3>
              <div className="mt-4 flex flex-wrap gap-2">
                {[["UNDERPAID", "Pagos abaixo do valor de face", underpaidItems.length], ["NOT_FOUND", "Não encontrados no estoque", notFoundItems.length], ["OTHER", "Outras divergências", otherItems.length]].map(([filter, label, count]) => <button className={`rounded border px-3 py-2 text-sm font-semibold ${activeFilter === filter ? "border-primary bg-primary text-white" : "border-slate-300 bg-white text-slate-700"}`} key={filter} onClick={() => setIssueFilters((current) => ({ ...current, [batch.id]: filter as IssueFilter }))} type="button">{label} ({count})</button>)}
              </div>
              {activeFilter === "UNDERPAID" ? <div className="mt-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[["Títulos", underpaidItems.length], ["Valor de face", money(totals.nominal)], ["Valor pago", money(totals.paid)], ["Diferença", money(totals.difference)]].map(([label, value]) => <div className="rounded border border-slate-200 bg-white p-3" key={label}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-semibold">{value}</p></div>)}
                </div>
                {underpaidWithinLimit.length ? <div className="rounded border border-emerald-200 bg-emerald-50/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-semibold text-emerald-900">Diferença de até 10%</h4><p className="mt-1 text-sm text-emerald-800">{underpaidWithinLimit.length} títulos · face {money(underpaidTotals(underpaidWithinLimit).nominal)} · pago {money(underpaidTotals(underpaidWithinLimit).paid)} · diferença {money(underpaidTotals(underpaidWithinLimit).difference)}</p></div>{canManage ? <button className="rounded bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={pending} onClick={() => void approveUnderpaidBulk(batch.id, underpaidWithinLimit.length, "UP_TO_10")} type="button">Liberar todos desta faixa</button> : null}</div>
                  <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-emerald-800">Ver individualmente</summary><div className="mt-3 space-y-3">{underpaidWithinLimit.map((item) => renderIssueItem(batch, item, true))}</div></details>
                </div> : null}
                {groupedAboveLimit.length ? <div className="rounded border border-blue-200 bg-blue-50/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-semibold text-blue-900">Acima de 10% com múltiplos títulos por sacado</h4><p className="mt-1 text-sm text-blue-800">{groupedAboveLimit.length} títulos · {new Set(groupedAboveLimit.map(debtorKey).filter(Boolean)).size} sacados · face {money(underpaidTotals(groupedAboveLimit).nominal)} · pago {money(underpaidTotals(groupedAboveLimit).paid)} · diferença {money(underpaidTotals(groupedAboveLimit).difference)}</p></div>{canManage ? <button className="rounded bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={pending} onClick={() => void approveUnderpaidBulk(batch.id, groupedAboveLimit.length, "GROUPED_DEBTOR")} type="button">Liberar antecipações agrupadas</button> : null}</div>
                  <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-blue-800">Ver individualmente</summary><div className="mt-3 space-y-3">{groupedAboveLimit.map((item) => renderIssueItem(batch, item, true))}</div></details>
                </div> : null}
                {individualAboveLimit.length ? <div className="rounded border border-red-200 bg-red-50/40 p-4">
                  <h4 className="font-semibold text-red-900">Acima de 10% com título avulso — análise individual</h4><p className="mt-1 text-sm text-red-800">{individualAboveLimit.length} títulos · face {money(underpaidTotals(individualAboveLimit).nominal)} · pago {money(underpaidTotals(individualAboveLimit).paid)} · diferença {money(underpaidTotals(individualAboveLimit).difference)}</p>
                  <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-red-800">Ver individualmente</summary><div className="mt-3 space-y-3">{individualAboveLimit.map((item) => renderIssueItem(batch, item, true))}</div></details>
                </div> : null}
                {!underpaidItems.length ? <p className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-500">Nenhum título pago abaixo do valor de face.</p> : null}
              </div> : null}
              {activeFilter === "NOT_FOUND" ? <div className="mt-4 space-y-3">{notFoundItems.length ? notFoundItems.map((item) => renderIssueItem(batch, item)) : <p className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-500">Nenhum título não encontrado.</p>}</div> : null}
              {activeFilter === "OTHER" ? <div className="mt-4 space-y-3">{otherItems.length ? otherItems.map((item) => renderIssueItem(batch, item)) : <p className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-500">Nenhuma outra divergência.</p>}</div> : null}
            </section> : <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" />Todos os títulos estão aptos.</div>}
            {batch.remittances.length ? <div className="space-y-2">{batch.remittances.map((remittance) => <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-200 p-3" key={remittance.id}><div><p className="text-sm font-semibold">{remittance.fileName}</p><p className="text-xs text-slate-500">{remittance.totalItems} títulos · {money(remittance.totalAmount)} · {stockStatusLabel[remittance.stockStatus] ?? remittance.stockStatus}</p></div><a className="inline-flex h-9 items-center gap-2 rounded border border-slate-300 px-3 text-sm font-semibold" href={`/api/operacional/consignado/remessas/${remittance.id}/download`}><Download className="h-4 w-4" />Baixar REM</a></div>)}</div> : canManage ? <button className="inline-flex h-10 items-center gap-2 rounded bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={pending || batch.items.every((item) => !item.approved)} onClick={() => void generate(batch.id)} type="button">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}Gerar remessa com aptos</button> : null}
          </div>
        </details>;
      })}</div> : <div className="p-8 text-center text-sm text-slate-500"><AlertTriangle className="mx-auto mb-2 h-5 w-5" />Nenhum lote processado.</div>}
    </section>
  </div>;
}
