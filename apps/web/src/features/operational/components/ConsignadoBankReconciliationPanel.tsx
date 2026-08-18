"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { Landmark, Link2, RotateCcw, UploadCloud, X } from "lucide-react";

type Entry = { id: string; transactionDate: string; description: string; document: string | null; amount: string; allocatedAmount: string; adjustedAmount: string; status: string };
type Remittance = { id: string; fileName: string; totalAmount: string; allocatedAmount: string; adjustedAmount: string; generatedAt: string; status: string; batch: { source: string; originator: { name: string } | null } };
type Reconciliation = {
  id: string;
  status: "ACTIVE" | "UNDONE";
  totalAmount: string;
  entryTotalAmount: string;
  remittanceTotalAmount: string;
  differenceAmount: string;
  differenceReason: string | null;
  note: string | null;
  createdAt: string;
  undoneAt: string | null;
  createdBy: { name: string };
  undoneBy: { name: string } | null;
  allocations: Array<{ id: string; amount: string }>;
  adjustments: Array<{ id: string; amount: string }>;
};
type StatementImport = { id: string; fileName: string; importedRows: number; duplicateRows: number; ignoredRows: number; createdAt: string; importedBy: { name: string } };
type Workspace = {
  entries: Entry[];
  remittances: Remittance[];
  reconciliations: Reconciliation[];
  imports: StatementImport[];
  summary: { openEntryCount: number; openEntryAmount: string };
};

function money(value: string | number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value)); }
function date(value: string) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" }).format(new Date(value)); }
function dateTime(value: string) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value)); }
function entryBalance(entry: Entry) { return Number(entry.amount) - Number(entry.allocatedAmount) - Number(entry.adjustedAmount); }
function remittanceBalance(remittance: Remittance) { return Number(remittance.totalAmount) - Number(remittance.allocatedAmount) - Number(remittance.adjustedAmount); }

export function ConsignadoBankReconciliationPanel({ initialWorkspace, canManage }: { initialWorkspace: Workspace; canManage: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [remittanceIds, setRemittanceIds] = useState<string[]>([]);
  const [transactionDate, setTransactionDate] = useState("");
  const [differenceReason, setDifferenceReason] = useState("");
  const [showDifferenceBox, setShowDifferenceBox] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState(false);
  const selectedEntryTotal = useMemo(() => workspace.entries.filter((item) => entryIds.includes(item.id)).reduce((sum, item) => sum + entryBalance(item), 0), [workspace.entries, entryIds]);
  const selectedRemittanceTotal = useMemo(() => workspace.remittances.filter((item) => remittanceIds.includes(item.id)).reduce((sum, item) => sum + remittanceBalance(item), 0), [workspace.remittances, remittanceIds]);
  const selectedDifference = Math.round(Math.abs(selectedEntryTotal - selectedRemittanceTotal) * 100) / 100;

  async function refresh(dateFilter = transactionDate) {
    const query = dateFilter ? `?transactionDate=${encodeURIComponent(dateFilter)}` : "";
    const response = await fetch(`/api/operacional/consignado/conciliacao-bancaria${query}`, { cache: "no-store" });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.message);
    setWorkspace(payload.workspace);
  }

  function toggle(id: string, setter: React.Dispatch<React.SetStateAction<string[]>>) {
    setter((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setPending(true); setFeedback("");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/operacional/consignado/conciliacao-bancaria", { method: "POST", body: form });
      const payload = await response.json();
      setFeedback(payload.message);
      if (payload.ok) { fileRef.current.value = ""; await refresh(); }
    } finally { setPending(false); }
  }

  async function filterEntries(event: FormEvent) {
    event.preventDefault();
    setPending(true); setFeedback(""); setEntryIds([]);
    try { await refresh(transactionDate); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Erro ao filtrar entradas."); }
    finally { setPending(false); }
  }

  async function showAllOpenEntries() {
    setTransactionDate(""); setEntryIds([]); setPending(true); setFeedback("");
    try { await refresh(""); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Erro ao consultar entradas."); }
    finally { setPending(false); }
  }

  async function reconcile(reason?: string) {
    if (selectedDifference > 0 && !reason) {
      setDifferenceReason("");
      setShowDifferenceBox(true);
      return;
    }
    setPending(true); setFeedback("");
    try {
      const response = await fetch("/api/operacional/consignado/conciliacoes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entryIds, remittanceIds, differenceReason: reason || undefined }),
      });
      const payload = await response.json();
      setFeedback(payload.message);
      if (payload.ok) {
        setEntryIds([]); setRemittanceIds([]); setDifferenceReason(""); setShowDifferenceBox(false);
        await refresh();
      }
    } finally { setPending(false); }
  }

  async function undo(id: string) {
    if (!window.confirm("Desfazer esta conciliação e restaurar todos os saldos?")) return;
    const response = await fetch(`/api/operacional/consignado/conciliacoes/${id}`, { method: "DELETE" });
    const payload = await response.json();
    setFeedback(payload.message);
    if (payload.ok) await refresh();
  }

  return <div className="space-y-6">
    {canManage ? <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
      <h2 className="font-semibold">Importar extrato Bradesco</h2>
      <p className="mt-1 text-sm text-slate-500">Somente créditos positivos novos serão exibidos. Uploads sobrepostos são deduplicados.</p>
      <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={upload}>
        <label className="min-w-72 flex-1 text-sm">Arquivo CSV<input accept=".csv,text/csv" className="mt-1 block h-10 w-full rounded border border-slate-200 px-3 py-2" ref={fileRef} required type="file" /></label>
        <button className="inline-flex h-10 items-center gap-2 rounded bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={pending}><UploadCloud className="h-4 w-4" />Importar entradas</button>
      </form>
    </section> : null}

    {feedback ? <p className="rounded border border-slate-200 bg-white px-4 py-3 text-sm shadow-executive">{feedback}</p> : null}

    <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="grid min-w-72 flex-1 gap-3 sm:grid-cols-2">
          <div className="rounded border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">Entradas não conciliadas</p><p className="mt-1 text-lg font-semibold">{workspace.summary.openEntryCount.toLocaleString("pt-BR")}</p></div>
          <div className="rounded border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">Saldo em aberto</p><p className="mt-1 text-lg font-semibold">{money(workspace.summary.openEntryAmount)}</p></div>
        </div>
        <form className="flex flex-wrap items-end gap-2" onSubmit={filterEntries}>
          <label className="text-sm">Data da entrada<input className="mt-1 block h-10 rounded border border-slate-200 px-3" onChange={(event) => setTransactionDate(event.target.value)} type="date" value={transactionDate} /></label>
          <button className="h-10 rounded bg-primary px-3 text-sm font-semibold text-white disabled:opacity-60" disabled={pending || !transactionDate}>Filtrar</button>
          <button className="h-10 rounded border border-slate-300 px-3 text-sm font-semibold disabled:opacity-60" disabled={pending || !transactionDate} onClick={() => void showAllOpenEntries()} type="button">Todas em aberto</button>
        </form>
      </div>
    </section>

    <div className="grid gap-6 xl:grid-cols-2">
      <section className="overflow-hidden rounded border border-slate-200 bg-white shadow-executive">
        <div className="border-b border-slate-200 p-4"><h2 className="font-semibold">Entradas pendentes</h2><p className="text-sm text-slate-500">{transactionDate ? `Exibindo movimentações de ${date(`${transactionDate}T00:00:00.000Z`)}` : "Todas as entradas ainda em aberto."}</p></div>
        <div className="max-h-[480px] divide-y overflow-auto">{workspace.entries.map((entry) => <label className="flex cursor-pointer items-start gap-3 p-4 hover:bg-slate-50" key={entry.id}>
          <input checked={entryIds.includes(entry.id)} className="mt-1" disabled={!canManage} onChange={() => toggle(entry.id, setEntryIds)} type="checkbox" />
          <div className="min-w-0 flex-1"><div className="flex justify-between gap-3"><p className="truncate text-sm font-medium">{entry.description}</p><strong className="whitespace-nowrap text-sm">{money(entryBalance(entry))}</strong></div><p className="mt-1 text-xs text-slate-500">{date(entry.transactionDate)} · Dcto. {entry.document ?? "não informado"} · {entry.status === "PARTIAL" ? "parcial" : "pendente"}</p></div>
        </label>)}{!workspace.entries.length ? <p className="p-8 text-center text-sm text-slate-500">{transactionDate ? "Nenhuma entrada pendente nesta data." : "Nenhuma entrada pendente."}</p> : null}</div>
      </section>

      <section className="overflow-hidden rounded border border-slate-200 bg-white shadow-executive">
        <div className="border-b border-slate-200 p-4"><h2 className="font-semibold">Remessas pendentes</h2><p className="text-sm text-slate-500">Selecione uma ou várias remessas.</p></div>
        <div className="max-h-[480px] divide-y overflow-auto">{workspace.remittances.map((remittance) => <label className="flex cursor-pointer items-start gap-3 p-4 hover:bg-slate-50" key={remittance.id}>
          <input checked={remittanceIds.includes(remittance.id)} className="mt-1" disabled={!canManage} onChange={() => toggle(remittance.id, setRemittanceIds)} type="checkbox" />
          <div className="min-w-0 flex-1"><div className="flex justify-between gap-3"><p className="truncate text-sm font-medium">{remittance.fileName}</p><strong className="whitespace-nowrap text-sm">{money(remittanceBalance(remittance))}</strong></div><p className="mt-1 text-xs text-slate-500">{remittance.batch.source} · {remittance.batch.originator?.name} · {remittance.status === "RECONCILING" ? "parcial" : "pendente"}</p></div>
        </label>)}{!workspace.remittances.length ? <p className="p-8 text-center text-sm text-slate-500">Nenhuma remessa pendente.</p> : null}</div>
      </section>
    </div>

    {canManage ? <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="font-semibold">Relacionar seleções</p><p className="mt-1 text-sm text-slate-500">Entradas: {money(selectedEntryTotal)} · Remessas: {money(selectedRemittanceTotal)} · Será alocado: {money(Math.min(selectedEntryTotal, selectedRemittanceTotal))} · Diferença: {money(selectedDifference)}</p></div><button className="inline-flex h-10 items-center gap-2 rounded bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50" disabled={pending || !entryIds.length || !remittanceIds.length} onClick={() => void reconcile()} type="button"><Link2 className="h-4 w-4" />Conciliar selecionados</button></div>
      {showDifferenceBox ? <div className="mt-5 rounded border border-amber-300 bg-amber-50 p-4">
        <div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold text-amber-950">Justificar diferença de {money(selectedDifference)}</h3><p className="mt-1 text-sm text-amber-800">A conciliação encerrará as entradas e remessas selecionadas e registrará esta diferença como ajuste auditável.</p></div><button aria-label="Fechar" className="text-amber-800" onClick={() => setShowDifferenceBox(false)} type="button"><X className="h-5 w-5" /></button></div>
        <label className="mt-4 block text-sm font-medium text-amber-950">Motivo da diferença<textarea className="mt-1 min-h-24 w-full rounded border border-amber-300 bg-white p-3 text-sm" maxLength={500} onChange={(event) => setDifferenceReason(event.target.value)} placeholder="Explique por que os valores não se zeram" value={differenceReason} /></label>
        <div className="mt-3 flex justify-end gap-2"><button className="h-9 rounded border border-slate-300 bg-white px-3 text-sm font-semibold" onClick={() => setShowDifferenceBox(false)} type="button">Cancelar</button><button className="h-9 rounded bg-primary px-3 text-sm font-semibold text-white disabled:opacity-50" disabled={pending || differenceReason.trim().length < 5} onClick={() => void reconcile(differenceReason.trim())} type="button">Conciliar com justificativa</button></div>
      </div> : null}
    </section> : null}

    <section className="overflow-hidden rounded border border-slate-200 bg-white shadow-executive">
      <div className="border-b border-slate-200 p-5"><h2 className="font-semibold">Histórico de conciliações</h2></div>
      {workspace.reconciliations.length ? <div className="divide-y">{workspace.reconciliations.map((item) => <div className="flex flex-wrap items-center justify-between gap-4 p-4" key={item.id}>
        <div><p className="text-sm font-semibold">{money(item.totalAmount)} · {item.allocations.length} alocações{item.adjustments.length ? ` · ${item.adjustments.length} ajustes` : ""}</p><p className="mt-1 text-xs text-slate-500">{dateTime(item.createdAt)} por {item.createdBy.name} · {item.status === "UNDONE" ? `Desfeita por ${item.undoneBy?.name ?? "usuário"}` : "Ativa"}</p>{Number(item.differenceAmount) > 0 ? <p className="mt-2 text-sm text-amber-800">Entradas {money(item.entryTotalAmount)} · Remessas {money(item.remittanceTotalAmount)} · Diferença justificada {money(item.differenceAmount)}: {item.differenceReason}</p> : null}</div>
        {canManage && item.status === "ACTIVE" ? <button className="inline-flex h-9 items-center gap-2 rounded border border-slate-300 px-3 text-sm" onClick={() => void undo(item.id)} type="button"><RotateCcw className="h-4 w-4" />Desfazer</button> : null}
      </div>)}</div> : <div className="p-8 text-center text-sm text-slate-500"><Landmark className="mx-auto mb-2 h-5 w-5" />Nenhuma conciliação registrada.</div>}
    </section>

    <details className="rounded border border-slate-200 bg-white p-5 shadow-executive"><summary className="cursor-pointer font-semibold">Histórico de importações bancárias</summary><div className="mt-4 divide-y">{workspace.imports.map((item) => <div className="flex justify-between gap-3 py-3 text-sm" key={item.id}><span>{item.fileName} · {item.importedBy.name}</span><span className="text-slate-500">{item.importedRows} novas · {item.duplicateRows} repetidas · {item.ignoredRows} ignoradas</span></div>)}</div></details>
  </div>;
}
