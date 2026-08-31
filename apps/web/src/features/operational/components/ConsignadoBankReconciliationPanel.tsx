"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { Landmark, Link2, RotateCcw, UploadCloud, X } from "lucide-react";
import { ConsignadoDifferenceComposer } from "./ConsignadoDifferenceComposer";
import {
  calculateDifferenceSelection,
  composeDifferenceState,
  decimalAmountToCents,
  formatCentsAsBRL,
  normalizeOtherDifferencesForPayload,
  recoverDifferenceCompositionAfterRejection,
  type DifferenceDirection,
  type EligibleExclusion,
  type OtherDifferenceDraft,
  type RemittanceExclusionCategory,
} from "../consignado-difference-composer";

type Entry = { id: string; transactionDate: string; description: string; document: string | null; amount: string; allocatedAmount: string; adjustedAmount: string; status: string };
type RemittanceExclusion = {
  id: string;
  remittanceId: string;
  category: RemittanceExclusionCategory;
  reason: string;
  paidAmount: string;
  titleAmount: string;
  settlementItem: { contractNumber: string | null; debtorName: string | null; debtorDocument: string | null; dueDate: string | null };
};
type Remittance = { id: string; fileName: string; totalAmount: string; allocatedAmount: string; adjustedAmount: string; generatedAt: string; status: string; batch: { fileName: string; source: string; originator: { name: string } | null }; exclusions: RemittanceExclusion[] };
type DifferenceTitleHistory = {
  id: string;
  amount: string;
  remittanceExclusion: RemittanceExclusion & { remittance: { id: string; fileName: string; batch: { id: string; fileName: string } } };
};
type OtherDifferenceHistory = {
  id: string;
  category: string;
  direction: DifferenceDirection;
  amount: string;
  reason: string;
  status: "OPEN" | "RESOLVED" | "CANCELLED";
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  cancelledAt: string | null;
  createdBy: { name: string };
  resolvedBy: { name: string } | null;
};
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
  differenceTitles: DifferenceTitleHistory[];
  otherDifferences: OtherDifferenceHistory[];
};
type StatementImport = { id: string; fileName: string; importedRows: number; duplicateRows: number; ignoredRows: number; createdAt: string; importedBy: { name: string } };
type Workspace = {
  entries: Entry[];
  remittances: Remittance[];
  reconciliations: Reconciliation[];
  imports: StatementImport[];
  summary: { openEntryCount: number; openEntryAmount: string };
};

function cents(value: string) {
  const parsed = decimalAmountToCents(value);
  if (parsed === null) throw new Error(`Valor monetário inválido no workspace: ${value}`);
  return parsed;
}
function money(value: string | bigint) { return formatCentsAsBRL(typeof value === "bigint" ? value : cents(value)); }
function date(value: string | null) { return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" }).format(new Date(value)) : "—"; }
function dateTime(value: string) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value)); }
function entryBalance(entry: Entry) { return cents(entry.amount) - cents(entry.allocatedAmount) - cents(entry.adjustedAmount); }
function remittanceBalance(remittance: Remittance) { return cents(remittance.totalAmount) - cents(remittance.allocatedAmount) - cents(remittance.adjustedAmount); }
const exclusionCategoryLabel: Record<RemittanceExclusionCategory, string> = { NOT_FOUND_IN_STOCK: "Não encontrado no estoque", OPERATOR_EXCLUDED: "Excluído pelo operador", NOT_APPROVED: "Não aprovado", PDD_RECOVERY: "Recuperação de PDD", OTHER_DIVERGENCE: "Outra divergência" };
const otherCategoryLabel: Record<string, string> = { BANK_FEE: "Tarifa bancária", UNIDENTIFIED_CREDIT: "Crédito não identificado", VALUE_DIFFERENCE: "Diferença de valor", ROUNDING: "Arredondamento", TIMING_DIFFERENCE: "Diferença de competência", OTHER: "Outro" };
const differenceStatusLabel: Record<OtherDifferenceHistory["status"], string> = { OPEN: "Em aberto", RESOLVED: "Resolvido", CANCELLED: "Cancelado" };

export function ConsignadoBankReconciliationPanel({
  initialWorkspace,
  canManage,
  unsettled,
}: {
  initialWorkspace: Workspace;
  canManage: boolean;
  unsettled: { count: number; amount: string } | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [unsettledOverview, setUnsettledOverview] = useState(unsettled);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [remittanceIds, setRemittanceIds] = useState<string[]>([]);
  const [transactionDate, setTransactionDate] = useState("");
  const [selectedExclusionIds, setSelectedExclusionIds] = useState<string[]>([]);
  const [otherDifferences, setOtherDifferences] = useState<OtherDifferenceDraft[]>([]);
  const [showDifferenceBox, setShowDifferenceBox] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState(false);
  const selectedTotals = useMemo(() => calculateDifferenceSelection({
    entries: workspace.entries.filter((item) => entryIds.includes(item.id)),
    remittances: workspace.remittances.filter((item) => remittanceIds.includes(item.id)).map((item) => ({
      amount: item.totalAmount,
      allocatedAmount: item.allocatedAmount,
      adjustedAmount: item.adjustedAmount,
    })),
  }), [entryIds, remittanceIds, workspace.entries, workspace.remittances]);
  const selectedEntryTotal = selectedTotals.entryTotalCents;
  const selectedRemittanceTotal = selectedTotals.remittanceTotalCents;
  const selectedDifference = selectedTotals.difference;
  const selectedDifferenceCents = selectedTotals.differenceCents;
  const differenceDirection: DifferenceDirection = selectedTotals.direction;
  const eligibleExclusions = useMemo<EligibleExclusion[]>(() => workspace.remittances
    .filter((item) => remittanceIds.includes(item.id))
    .flatMap((remittance) => remittance.exclusions.map((item) => ({
      id: item.id,
      remittanceId: item.remittanceId,
      remittanceFileName: remittance.fileName,
      batchFileName: remittance.batch.fileName,
      contractNumber: item.settlementItem.contractNumber,
      debtorName: item.settlementItem.debtorName,
      debtorDocument: item.settlementItem.debtorDocument,
      dueDate: item.settlementItem.dueDate,
      titleAmount: item.titleAmount,
      paidAmount: item.paidAmount,
      category: item.category,
      reason: item.reason,
    }))), [remittanceIds, workspace.remittances]);
  const differenceState = composeDifferenceState({
    difference: selectedDifference,
    direction: differenceDirection,
    exclusions: eligibleExclusions,
    selectedIds: selectedExclusionIds,
    otherDifferences,
  });

  async function refresh(dateFilter = transactionDate) {
    const query = dateFilter ? `?transactionDate=${encodeURIComponent(dateFilter)}` : "";
    const response = await fetch(`/api/operacional/consignado/conciliacao-bancaria${query}`, { cache: "no-store" });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.message);
    setWorkspace(payload.workspace);
    setUnsettledOverview(payload.unsettled ?? null);
  }

  function resetDifferenceComposition() {
    const next = recoverDifferenceCompositionAfterRejection({
      selectedIds: selectedExclusionIds,
      otherDifferences,
      showComposer: showDifferenceBox,
    });
    setSelectedExclusionIds(next.selectedIds);
    setOtherDifferences(next.otherDifferences);
    setShowDifferenceBox(next.showComposer);
  }

  function toggle(id: string, setter: React.Dispatch<React.SetStateAction<string[]>>) {
    resetDifferenceComposition();
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
    setPending(true); setFeedback(""); setEntryIds([]); resetDifferenceComposition();
    try { await refresh(transactionDate); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Erro ao filtrar entradas."); }
    finally { setPending(false); }
  }

  async function showAllOpenEntries() {
    setTransactionDate(""); setEntryIds([]); resetDifferenceComposition(); setPending(true); setFeedback("");
    try { await refresh(""); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Erro ao consultar entradas."); }
    finally { setPending(false); }
  }

  function beginReconciliation() {
    if (selectedDifferenceCents === BigInt(0)) {
      void submitReconciliation();
      return;
    }
    setSelectedExclusionIds([]);
    setOtherDifferences(differenceDirection === "REMITTANCE_EXCESS" ? [{ category: "", amount: selectedDifference, reason: "" }] : []);
    setShowDifferenceBox(true);
  }

  async function submitReconciliation() {
    if (selectedDifferenceCents > BigInt(0) && !differenceState.canSubmit) return;
    setPending(true); setFeedback("");
    try {
      const normalizedOtherDifferences = normalizeOtherDifferencesForPayload(otherDifferences);
      const response = await fetch("/api/operacional/consignado/conciliacoes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entryIds, remittanceIds, exclusionIds: selectedExclusionIds, otherDifferences: normalizedOtherDifferences }),
      });
      const payload = await response.json();
      setFeedback(payload.message);
      if (!payload.ok) {
        try { await refresh(); }
        finally { resetDifferenceComposition(); }
        return;
      }
      setEntryIds([]); setRemittanceIds([]); resetDifferenceComposition();
      await refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Erro ao conciliar.");
    } finally { setPending(false); }
  }

  async function undo(id: string) {
    if (!window.confirm("Desfazer esta conciliação e restaurar todos os saldos?")) return;
    const response = await fetch(`/api/operacional/consignado/conciliacoes/${id}`, { method: "DELETE" });
    const payload = await response.json();
    setFeedback(payload.message);
    if (payload.ok) await refresh();
  }

  return <div className="space-y-8">
    <header className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6 border-b border-slate-200 pb-7">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Conciliação bancária</h1>
        <p className="mt-1 text-sm text-ink-600">Consignado · entradas Bradesco contra remessas geradas</p>
      </div>
      <div className="flex items-end gap-8 sm:gap-12">
        <a className="group" href="/dashboard/operacional/financeiro/conciliacao/consignado/baixas/titulos-fora-remessa?situation=ACTIVE_RECONCILIATION">
          <p className="text-sm text-ink-600">Conciliado sem baixa</p>
          <p className="mt-1 text-[2rem] font-semibold leading-none tracking-tight tabular-nums text-navy-900">{unsettledOverview ? money(unsettledOverview.amount) : "—"}</p>
          <p className="mt-2 text-xs text-ink-400 transition group-hover:text-emerald-brand">{unsettledOverview ? `${unsettledOverview.count.toLocaleString("pt-BR")} conciliações com sobra` : "indisponível"}</p>
        </a>
        <div aria-hidden="true" className="h-12 w-px bg-slate-200" />
        <div>
          <p className="text-sm text-ink-600">Entradas em aberto</p>
          <p className="mt-1 text-[2rem] font-semibold leading-none tracking-tight tabular-nums text-navy-900">{money(workspace.summary.openEntryAmount)}</p>
          <p className="mt-2 text-xs text-ink-400">{workspace.summary.openEntryCount.toLocaleString("pt-BR")} entradas</p>
        </div>
      </div>
    </header>

    <div aria-atomic="true" aria-live="polite" className={feedback ? "rounded-lg border-l-2 border-emerald-brand bg-white px-4 py-3 text-sm text-navy-900" : "sr-only"} id="bank-reconciliation-feedback" role="status">{feedback}</div>

    <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <form className="flex flex-wrap items-end gap-2" onSubmit={filterEntries}>
        <label className="text-xs text-ink-600">Data da entrada<input className="mt-1 block h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-navy-900" onChange={(event) => setTransactionDate(event.target.value)} type="date" value={transactionDate} /></label>
        <button className="h-9 rounded-md bg-navy-900 px-3.5 text-sm font-medium text-white transition hover:bg-navy-700 disabled:opacity-40" disabled={pending || !transactionDate}>Filtrar</button>
        <button className="h-9 rounded-md px-3 text-sm font-medium text-ink-600 transition hover:text-navy-900 disabled:opacity-40" disabled={pending || !transactionDate} onClick={() => void showAllOpenEntries()} type="button">Todas em aberto</button>
      </form>
      {canManage ? <details className="text-sm">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden text-ink-600 transition hover:text-navy-900"><UploadCloud className="h-4 w-4" />Importar extrato Bradesco</summary>
        <form className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4" onSubmit={upload}>
          <label className="min-w-64 flex-1 text-xs text-ink-600">Arquivo CSV<input accept=".csv,text/csv" className="mt-1 block h-9 w-full rounded-md border border-slate-300 px-3 text-sm text-navy-900" ref={fileRef} required type="file" /></label>
          <button className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-brand px-4 text-sm font-medium text-white transition hover:bg-emerald-bright disabled:opacity-40" disabled={pending}>Importar entradas</button>
          <p className="w-full text-xs text-ink-400">Somente créditos positivos novos. Uploads sobrepostos são deduplicados.</p>
        </form>
      </details> : null}
    </div>

    <div className="grid gap-5 xl:grid-cols-2">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-baseline justify-between gap-3 border-b border-slate-200 px-4 py-3"><h2 className="text-sm font-semibold text-navy-900">Entradas pendentes</h2><p className="text-xs text-ink-400">{transactionDate ? date(`${transactionDate}T00:00:00.000Z`) : `${workspace.entries.length} em aberto`}</p></div>
        <div className="max-h-[480px] divide-y divide-slate-100 overflow-auto">{workspace.entries.map((entry) => <label className="flex cursor-pointer items-start gap-3 px-4 py-3 transition hover:bg-ink-100" key={entry.id}>
          <input checked={entryIds.includes(entry.id)} className="mt-1" disabled={!canManage} onChange={() => toggle(entry.id, setEntryIds)} type="checkbox" />
          <div className="min-w-0 flex-1"><div className="flex justify-between gap-3"><p className="truncate text-sm text-navy-900">{entry.description}</p><strong className="whitespace-nowrap text-sm font-semibold tabular-nums text-navy-900">{money(entryBalance(entry))}</strong></div><p className="mt-0.5 text-xs text-ink-400">{date(entry.transactionDate)} · Dcto. {entry.document ?? "não informado"}{entry.status === "PARTIAL" ? " · parcial" : ""}</p></div>
        </label>)}{!workspace.entries.length ? <p className="px-4 py-12 text-center text-sm text-ink-400">{transactionDate ? "Nenhuma entrada pendente nesta data." : "Nenhuma entrada pendente."}</p> : null}</div>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-baseline justify-between gap-3 border-b border-slate-200 px-4 py-3"><h2 className="text-sm font-semibold text-navy-900">Remessas pendentes</h2><p className="text-xs text-ink-400">{workspace.remittances.length} em aberto</p></div>
        <div className="max-h-[480px] divide-y divide-slate-100 overflow-auto">{workspace.remittances.map((remittance) => <label className="flex cursor-pointer items-start gap-3 px-4 py-3 transition hover:bg-ink-100" key={remittance.id}>
          <input checked={remittanceIds.includes(remittance.id)} className="mt-1" disabled={!canManage} onChange={() => toggle(remittance.id, setRemittanceIds)} type="checkbox" />
          <div className="min-w-0 flex-1"><div className="flex justify-between gap-3"><p className="truncate text-sm text-navy-900">{remittance.fileName}</p><strong className="whitespace-nowrap text-sm font-semibold tabular-nums text-navy-900">{money(remittanceBalance(remittance))}</strong></div><p className="mt-0.5 text-xs text-ink-400">{remittance.batch.source} · {remittance.batch.originator?.name}{remittance.status === "RECONCILING" ? " · parcial" : ""}</p></div>
        </label>)}{!workspace.remittances.length ? <p className="px-4 py-12 text-center text-sm text-ink-400">Nenhuma remessa pendente.</p> : null}</div>
      </section>
    </div>

    {canManage ? <>
    <div className={showDifferenceBox ? "rounded-lg bg-navy-900 px-6 py-5" : "sticky bottom-4 z-20 rounded-lg bg-navy-900 px-6 py-5 shadow-executive"}>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="grid min-w-72 flex-1 grid-cols-2 gap-x-8 gap-y-5 lg:grid-cols-4">
          <div><p className="text-xs text-white/45">Entradas{entryIds.length ? ` · ${entryIds.length}` : ""}</p><p className="mt-1.5 text-xl font-semibold leading-none tabular-nums text-white">{money(selectedEntryTotal)}</p></div>
          <div><p className="text-xs text-white/45">Remessas{remittanceIds.length ? ` · ${remittanceIds.length}` : ""}</p><p className="mt-1.5 text-xl font-semibold leading-none tabular-nums text-white">{money(selectedRemittanceTotal)}</p></div>
          <div><p className="text-xs text-white/45">Será alocado</p><p className="mt-1.5 text-xl font-semibold leading-none tabular-nums text-emerald-bright">{money(selectedEntryTotal < selectedRemittanceTotal ? selectedEntryTotal : selectedRemittanceTotal)}</p></div>
          <div><p className="text-xs text-white/45">Diferença{selectedDifferenceCents === BigInt(0) ? "" : differenceDirection === "ENTRY_EXCESS" ? " · entrada maior" : " · remessa maior"}</p><p className={selectedDifferenceCents === BigInt(0) ? "mt-1.5 text-xl font-semibold leading-none tabular-nums text-white/30" : "mt-1.5 text-xl font-semibold leading-none tabular-nums text-amber-300"}>{money(selectedDifference)}</p></div>
        </div>
        <button className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-brand px-5 text-sm font-medium text-white transition hover:bg-emerald-bright disabled:opacity-30" disabled={pending || showDifferenceBox || !entryIds.length || !remittanceIds.length} onClick={beginReconciliation} type="button"><Link2 className="h-4 w-4" />Conciliar selecionados</button>
      </div>
    </div>
    {showDifferenceBox ? <div className="rounded-lg border border-amber-300 bg-amber-50 p-5">
        <div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold text-amber-950">Compor diferença de {money(selectedDifference)}</h3><p className="mt-1 text-sm text-amber-800">Escolha títulos elegíveis e/ou registre Outros até explicar exatamente o valor. O servidor recalculará tudo antes de concluir.</p></div><button aria-label="Fechar" className="text-amber-800" onClick={resetDifferenceComposition} type="button"><X className="h-5 w-5" /></button></div>
        <div className="mt-4 flex flex-wrap items-end gap-x-10 gap-y-4 border-y border-amber-200 py-4">
          <div><p className="text-xs text-amber-800">Títulos selecionados</p><p className="mt-1 text-lg font-semibold leading-none tabular-nums text-amber-950">{money(differenceState.titleTotal)}</p></div>
          <div><p className="text-xs text-amber-800">Outros</p><p className="mt-1 text-lg font-semibold leading-none tabular-nums text-amber-950">{money(differenceState.otherTotal)}</p></div>
          <div><p className="text-xs text-amber-800">Falta explicar</p><p className={differenceState.unexplainedCents === BigInt(0) ? "mt-1 text-lg font-semibold leading-none tabular-nums text-emerald-deep" : "mt-1 text-lg font-semibold leading-none tabular-nums text-red-700"}>{money(differenceState.unexplainedCents)}</p></div>
        </div>
        <div className="mt-4"><ConsignadoDifferenceComposer difference={selectedDifference} direction={differenceDirection} disabled={pending} exclusions={eligibleExclusions} onOtherDifferencesChange={setOtherDifferences} onSelectedIdsChange={setSelectedExclusionIds} otherDifferences={otherDifferences} selectedIds={selectedExclusionIds} /></div>
        <div className="mt-4 flex justify-end gap-2"><button className="h-9 rounded border border-slate-300 bg-white px-3 text-sm font-semibold" disabled={pending} onClick={resetDifferenceComposition} type="button">Cancelar</button><button aria-describedby="difference-composer-status difference-composer-errors" className="h-9 rounded bg-primary px-3 text-sm font-semibold text-white disabled:opacity-50" disabled={pending || !differenceState.canSubmit} onClick={() => void submitReconciliation()} type="button">Concluir conciliação</button></div>
    </div> : null}
    </> : null}
    </div>

    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-200 px-5 py-4"><h2 className="text-sm font-semibold text-navy-900">Histórico de conciliações</h2><a className="text-xs text-ink-600 transition hover:text-navy-900" href="/dashboard/operacional/financeiro/conciliacao/consignado/conciliacao-bancaria/diferencas">Diferenças e ajustes →</a></div>
      {workspace.reconciliations.length ? <div className="divide-y">{workspace.reconciliations.map((item) => {
        const titleTotal = item.differenceTitles.reduce((sum, title) => sum + cents(title.amount), BigInt(0));
        const otherTotal = item.otherDifferences.reduce((sum, other) => sum + cents(other.amount), BigInt(0));
        return <div className="p-4" key={item.id}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div><p className="text-sm font-semibold">{money(item.totalAmount)} · {item.allocations.length} alocações{item.adjustments.length ? ` · ${item.adjustments.length} ajustes contábeis` : ""}</p><p className="mt-1 text-xs text-slate-500">{dateTime(item.createdAt)} por {item.createdBy.name} · {item.status === "UNDONE" ? `Desfeita por ${item.undoneBy?.name ?? "usuário"}` : "Ativa"}</p>{cents(item.differenceAmount) > BigInt(0) ? <p className="mt-2 text-sm text-amber-800">Entradas {money(item.entryTotalAmount)} · Remessas {money(item.remittanceTotalAmount)} · Diferença {money(item.differenceAmount)}</p> : null}{item.differenceTitles.length || item.otherDifferences.length ? <p className="mt-1 text-xs text-slate-600">{item.differenceTitles.length} título(s): {money(titleTotal)} · {item.otherDifferences.length} Outro(s): {money(otherTotal)} ({item.otherDifferences.filter((other) => other.status === "OPEN").length} em aberto)</p> : item.differenceReason ? <p className="mt-1 text-xs text-slate-600">Histórico anterior: {item.differenceReason}</p> : null}</div>
            {canManage && item.status === "ACTIVE" ? <button className="inline-flex h-9 items-center gap-2 rounded border border-slate-300 px-3 text-sm" onClick={() => void undo(item.id)} type="button"><RotateCcw className="h-4 w-4" />Desfazer</button> : null}
          </div>
          {item.differenceTitles.length || item.otherDifferences.length ? <details className="mt-3 rounded border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-semibold">Ver explicação detalhada</summary>
            {item.differenceTitles.length ? <div className="mt-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Títulos fora da remessa</p><div className="mt-2 space-y-2">{item.differenceTitles.map((title) => <div className="rounded border border-slate-200 bg-white p-3 text-xs" key={title.id}><div className="flex flex-wrap justify-between gap-2"><p className="font-semibold text-slate-900">{title.remittanceExclusion.settlementItem.debtorName ?? "Sacado não informado"} · Contrato {title.remittanceExclusion.settlementItem.contractNumber ?? "—"}</p><strong>{money(title.amount)}</strong></div><p className="mt-1 text-slate-500">CPF {title.remittanceExclusion.settlementItem.debtorDocument ?? "—"} · Vencimento {date(title.remittanceExclusion.settlementItem.dueDate)} · Baixa {title.remittanceExclusion.remittance.batch.fileName} · Remessa {title.remittanceExclusion.remittance.fileName}</p><p className="mt-1 text-amber-800">{exclusionCategoryLabel[title.remittanceExclusion.category]}: {title.remittanceExclusion.reason}</p></div>)}</div></div> : null}
            {item.otherDifferences.length ? <div className="mt-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Outros ajustes</p><div className="mt-2 space-y-2">{item.otherDifferences.map((other) => <div className="rounded border border-slate-200 bg-white p-3 text-xs" key={other.id}><div className="flex flex-wrap justify-between gap-2"><p className="font-semibold text-slate-900">{otherCategoryLabel[other.category] ?? other.category} · {other.direction === "ENTRY_EXCESS" ? "Excesso de entrada" : "Excesso de remessa"}</p><div className="text-right"><strong>{money(other.amount)}</strong><p className={other.status === "OPEN" ? "text-amber-700" : other.status === "RESOLVED" ? "text-emerald-700" : "text-slate-500"}>{differenceStatusLabel[other.status]}</p></div></div><p className="mt-1 text-slate-600">{other.reason}</p><p className="mt-1 text-slate-500">Criado por {other.createdBy.name} em {dateTime(other.createdAt)}{other.resolvedAt ? ` · Resolvido por ${other.resolvedBy?.name ?? "usuário"} em ${dateTime(other.resolvedAt)}` : ""}{other.cancelledAt ? ` · Cancelado em ${dateTime(other.cancelledAt)}` : ""}</p>{other.resolutionNote ? <p className="mt-1 text-emerald-700">Resolução: {other.resolutionNote}</p> : null}</div>)}</div></div> : null}
          </details> : null}
        </div>;
      })}</div> : <div className="p-8 text-center text-sm text-slate-500"><Landmark className="mx-auto mb-2 h-5 w-5" />Nenhuma conciliação registrada.</div>}
    </section>

    <details className="rounded-lg border border-slate-200 bg-white p-5"><summary className="cursor-pointer text-sm font-semibold text-navy-900">Histórico de importações bancárias</summary><div className="mt-4 divide-y">{workspace.imports.map((item) => <div className="flex justify-between gap-3 py-3 text-sm" key={item.id}><span>{item.fileName} · {item.importedBy.name}</span><span className="text-slate-500">{item.importedRows} novas · {item.duplicateRows} repetidas · {item.ignoredRows} ignoradas</span></div>)}</div></details>
  </div>;
}
