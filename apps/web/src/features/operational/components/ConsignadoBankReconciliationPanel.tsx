"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { Landmark, Link2, RotateCcw, UploadCloud } from "lucide-react";

type Entry = { id: string; transactionDate: string; description: string; document: string | null; amount: string; allocatedAmount: string; status: string };
type Remittance = { id: string; fileName: string; totalAmount: string; allocatedAmount: string; generatedAt: string; status: string; batch: { source: string; originator: { name: string } | null } };
type Reconciliation = { id: string; status: "ACTIVE" | "UNDONE"; totalAmount: string; note: string | null; createdAt: string; undoneAt: string | null; createdBy: { name: string }; undoneBy: { name: string } | null; allocations: Array<{ id: string; amount: string }> };
type StatementImport = { id: string; fileName: string; importedRows: number; duplicateRows: number; ignoredRows: number; createdAt: string; importedBy: { name: string } };
type Workspace = { entries: Entry[]; remittances: Remittance[]; reconciliations: Reconciliation[]; imports: StatementImport[] };
function money(value: string | number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value)); }
function date(value: string) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" }).format(new Date(value)); }

export function ConsignadoBankReconciliationPanel({ initialWorkspace, canManage }: { initialWorkspace: Workspace; canManage: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [remittanceIds, setRemittanceIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState(false);
  const selectedEntryTotal = useMemo(() => workspace.entries.filter((item) => entryIds.includes(item.id)).reduce((sum, item) => sum + Number(item.amount) - Number(item.allocatedAmount), 0), [workspace.entries, entryIds]);
  const selectedRemittanceTotal = useMemo(() => workspace.remittances.filter((item) => remittanceIds.includes(item.id)).reduce((sum, item) => sum + Number(item.totalAmount) - Number(item.allocatedAmount), 0), [workspace.remittances, remittanceIds]);

  async function refresh() {
    const response = await fetch("/api/operacional/consignado/conciliacao-bancaria", { cache: "no-store" });
    const payload = await response.json(); if (!payload.ok) throw new Error(payload.message); setWorkspace(payload.workspace);
  }
  function toggle(id: string, setter: React.Dispatch<React.SetStateAction<string[]>>) { setter((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  async function upload(event: FormEvent) {
    event.preventDefault(); const file = fileRef.current?.files?.[0]; if (!file) return; setPending(true);
    try { const form = new FormData(); form.set("file", file); const response = await fetch("/api/operacional/consignado/conciliacao-bancaria", { method: "POST", body: form }); const payload = await response.json(); setFeedback(payload.message); if (payload.ok) { fileRef.current.value = ""; await refresh(); } }
    finally { setPending(false); }
  }
  async function reconcile() {
    setPending(true);
    try { const response = await fetch("/api/operacional/consignado/conciliacoes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entryIds, remittanceIds }) }); const payload = await response.json(); setFeedback(payload.message); if (payload.ok) { setEntryIds([]); setRemittanceIds([]); await refresh(); } }
    finally { setPending(false); }
  }
  async function undo(id: string) {
    if (!window.confirm("Desfazer esta conciliação e restaurar todos os saldos?")) return;
    const response = await fetch(`/api/operacional/consignado/conciliacoes/${id}`, { method: "DELETE" }); const payload = await response.json(); setFeedback(payload.message); if (payload.ok) await refresh();
  }

  return <div className="space-y-6">
    {canManage ? <section className="rounded border border-slate-200 bg-white p-5 shadow-executive"><h2 className="font-semibold">Importar extrato Bradesco</h2><p className="mt-1 text-sm text-slate-500">Somente créditos positivos novos serão exibidos. Uploads sobrepostos são deduplicados.</p><form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={upload}><label className="min-w-72 flex-1 text-sm">Arquivo CSV<input accept=".csv,text/csv" className="mt-1 block h-10 w-full rounded border border-slate-200 px-3 py-2" ref={fileRef} required type="file" /></label><button className="inline-flex h-10 items-center gap-2 rounded bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={pending}><UploadCloud className="h-4 w-4" />Importar entradas</button></form>{feedback ? <p className="mt-4 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{feedback}</p> : null}</section> : null}

    <div className="grid gap-6 xl:grid-cols-2">
      <section className="overflow-hidden rounded border border-slate-200 bg-white shadow-executive"><div className="border-b border-slate-200 p-4"><h2 className="font-semibold">Entradas pendentes</h2><p className="text-sm text-slate-500">Selecione uma ou várias entradas.</p></div><div className="max-h-[480px] overflow-auto divide-y">{workspace.entries.map((entry) => <label className="flex cursor-pointer items-start gap-3 p-4 hover:bg-slate-50" key={entry.id}><input checked={entryIds.includes(entry.id)} className="mt-1" onChange={() => toggle(entry.id, setEntryIds)} type="checkbox" /><div className="min-w-0 flex-1"><div className="flex justify-between gap-3"><p className="truncate text-sm font-medium">{entry.description}</p><strong className="whitespace-nowrap text-sm">{money(Number(entry.amount) - Number(entry.allocatedAmount))}</strong></div><p className="mt-1 text-xs text-slate-500">{date(entry.transactionDate)} · Dcto. {entry.document ?? "não informado"} · {entry.status === "PARTIAL" ? "parcial" : "pendente"}</p></div></label>)}{!workspace.entries.length ? <p className="p-8 text-center text-sm text-slate-500">Nenhuma entrada pendente.</p> : null}</div></section>
      <section className="overflow-hidden rounded border border-slate-200 bg-white shadow-executive"><div className="border-b border-slate-200 p-4"><h2 className="font-semibold">Remessas pendentes</h2><p className="text-sm text-slate-500">Selecione uma ou várias remessas.</p></div><div className="max-h-[480px] overflow-auto divide-y">{workspace.remittances.map((remittance) => <label className="flex cursor-pointer items-start gap-3 p-4 hover:bg-slate-50" key={remittance.id}><input checked={remittanceIds.includes(remittance.id)} className="mt-1" onChange={() => toggle(remittance.id, setRemittanceIds)} type="checkbox" /><div className="min-w-0 flex-1"><div className="flex justify-between gap-3"><p className="truncate text-sm font-medium">{remittance.fileName}</p><strong className="whitespace-nowrap text-sm">{money(Number(remittance.totalAmount) - Number(remittance.allocatedAmount))}</strong></div><p className="mt-1 text-xs text-slate-500">{remittance.batch.source} · {remittance.batch.originator?.name} · {remittance.status === "RECONCILING" ? "parcial" : "pendente"}</p></div></label>)}{!workspace.remittances.length ? <p className="p-8 text-center text-sm text-slate-500">Nenhuma remessa pendente.</p> : null}</div></section>
    </div>

    {canManage ? <section className="flex flex-wrap items-center justify-between gap-4 rounded border border-slate-200 bg-white p-5 shadow-executive"><div><p className="font-semibold">Relacionar seleções</p><p className="mt-1 text-sm text-slate-500">Entradas: {money(selectedEntryTotal)} · Remessas: {money(selectedRemittanceTotal)} · Será alocado: {money(Math.min(selectedEntryTotal, selectedRemittanceTotal))}</p></div><button className="inline-flex h-10 items-center gap-2 rounded bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50" disabled={pending || !entryIds.length || !remittanceIds.length} onClick={() => void reconcile()} type="button"><Link2 className="h-4 w-4" />Conciliar selecionados</button></section> : null}

    <section className="overflow-hidden rounded border border-slate-200 bg-white shadow-executive"><div className="border-b border-slate-200 p-5"><h2 className="font-semibold">Histórico de conciliações</h2></div>{workspace.reconciliations.length ? <div className="divide-y">{workspace.reconciliations.map((item) => <div className="flex flex-wrap items-center justify-between gap-4 p-4" key={item.id}><div><p className="text-sm font-semibold">{money(item.totalAmount)} · {item.allocations.length} alocações</p><p className="mt-1 text-xs text-slate-500">{date(item.createdAt)} por {item.createdBy.name} · {item.status === "UNDONE" ? `Desfeita por ${item.undoneBy?.name ?? "usuário"}` : "Ativa"}</p></div>{canManage && item.status === "ACTIVE" ? <button className="inline-flex h-9 items-center gap-2 rounded border border-slate-300 px-3 text-sm" onClick={() => void undo(item.id)} type="button"><RotateCcw className="h-4 w-4" />Desfazer</button> : null}</div>)}</div> : <div className="p-8 text-center text-sm text-slate-500"><Landmark className="mx-auto mb-2 h-5 w-5" />Nenhuma conciliação registrada.</div>}</section>

    <details className="rounded border border-slate-200 bg-white p-5 shadow-executive"><summary className="cursor-pointer font-semibold">Histórico de importações bancárias</summary><div className="mt-4 divide-y">{workspace.imports.map((item) => <div className="flex justify-between gap-3 py-3 text-sm" key={item.id}><span>{item.fileName} · {item.importedBy.name}</span><span className="text-slate-500">{item.importedRows} novas · {item.duplicateRows} repetidas · {item.ignoredRows} ignoradas</span></div>)}</div></details>
  </div>;
}
