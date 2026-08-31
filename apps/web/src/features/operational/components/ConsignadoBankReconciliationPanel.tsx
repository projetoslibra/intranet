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
  openDifferences,
  unsettled,
}: {
  initialWorkspace: Workspace;
  canManage: boolean;
  openDifferences: { count: number; amount: string } | null;
  unsettled: { count: number; amount: string } | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [openDifferenceOverview, setOpenDifferenceOverview] = useState(openDifferences);
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
    setOpenDifferenceOverview(payload.openDifferences ?? null);
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

  return <div className="space-y-6">
    <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="font-semibold">Pendências da conciliação</h2><p className="mt-1 text-sm text-slate-500">Dinheiro que já entrou no banco e ainda não virou baixa.</p></div>
        <a className="inline-flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700" href="/dashboard/operacional/financeiro/conciliacao/consignado/conciliacao-bancaria/diferencas">Diferenças e ajustes{openDifferenceOverview ? <span className={openDifferenceOverview.count ? "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800" : "rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"}>{openDifferenceOverview.count.toLocaleString("pt-BR")} · {money(openDifferenceOverview.amount)}</span> : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-500">indisponível</span>}</a>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <a className="rounded border border-amber-200 bg-amber-50 p-4 transition hover:border-amber-400" href="/dashboard/operacional/financeiro/conciliacao/consignado/baixas/titulos-fora-remessa?situation=ACTIVE_RECONCILIATION">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Conciliado sem baixa</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-amber-950">{unsettledOverview ? money(unsettledOverview.amount) : "—"}</p>
          <p className="mt-1 text-xs text-amber-800">{unsettledOverview ? `${unsettledOverview.count.toLocaleString("pt-BR")} conciliações com sobra · ver os títulos` : "Indicador indisponível no momento."}</p>
        </a>
        <div className="rounded border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Entradas em aberto</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-950">{money(workspace.summary.openEntryAmount)}</p>
          <p className="mt-1 text-xs text-slate-500">{workspace.summary.openEntryCount.toLocaleString("pt-BR")} entradas aguardando conciliação</p>
        </div>
      </div>
    </section>

    {canManage ? <details className="rounded border border-slate-200 bg-white p-5 shadow-executive">
      <summary className="cursor-pointer font-semibold">Importar extrato Bradesco</summary>
      <p className="mt-1 text-sm text-slate-500">Somente créditos positivos novos serão exibidos. Uploads sobrepostos são deduplicados.</p>
      <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={upload}>
        <label className="min-w-72 flex-1 text-sm">Arquivo CSV<input accept=".csv,text/csv" className="mt-1 block h-10 w-full rounded border border-slate-200 px-3 py-2" ref={fileRef} required type="file" /></label>
        <button className="inline-flex h-10 items-center gap-2 rounded bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={pending}><UploadCloud className="h-4 w-4" />Importar entradas</button>
      </form>
    </details> : null}

    <div aria-atomic="true" aria-live="polite" className={feedback ? "rounded border border-slate-200 bg-white px-4 py-3 text-sm shadow-executive" : "sr-only"} id="bank-reconciliation-feedback" role="status">{feedback}</div>

    <div className="space-y-6">
    <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-72 flex-1"><h2 className="font-semibold">Selecionar e conciliar</h2><p className="mt-1 text-sm text-slate-500">Marque entradas e remessas em qualquer combinação; os totais da seleção acompanham você no rodapé.</p></div>
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

    {canManage ? <section className={showDifferenceBox ? "rounded border border-slate-300 bg-white p-5 shadow-executive" : "sticky bottom-4 z-20 rounded border border-slate-300 bg-white p-5 shadow-lg"}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid min-w-72 flex-1 grid-cols-2 gap-4 lg:grid-cols-4">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Entradas</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{money(selectedEntryTotal)}</p><p className="mt-0.5 text-xs text-slate-500">{entryIds.length} selecionada(s)</p></div>
          <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Remessas</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{money(selectedRemittanceTotal)}</p><p className="mt-0.5 text-xs text-slate-500">{remittanceIds.length} selecionada(s)</p></div>
          <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Será alocado</p><p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">{money(selectedEntryTotal < selectedRemittanceTotal ? selectedEntryTotal : selectedRemittanceTotal)}</p><p className="mt-0.5 text-xs text-slate-500">menor dos dois lados</p></div>
          <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Diferença</p><p className={selectedDifferenceCents === BigInt(0) ? "mt-1 text-2xl font-semibold tabular-nums text-slate-400" : "mt-1 text-2xl font-semibold tabular-nums text-amber-700"}>{money(selectedDifference)}</p><p className="mt-0.5 text-xs text-slate-500">{selectedDifferenceCents === BigInt(0) ? "sem diferença" : differenceDirection === "ENTRY_EXCESS" ? "entrada maior" : "remessa maior"}</p></div>
        </div>
        <button className="inline-flex h-11 items-center gap-2 rounded bg-primary px-5 text-sm font-semibold text-white disabled:opacity-50" disabled={pending || showDifferenceBox || !entryIds.length || !remittanceIds.length} onClick={beginReconciliation} type="button"><Link2 className="h-4 w-4" />Conciliar selecionados</button>
      </div>
      {showDifferenceBox ? <div className="mt-5 rounded border border-amber-300 bg-amber-50 p-4">
        <div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold text-amber-950">Compor diferença de {money(selectedDifference)}</h3><p className="mt-1 text-sm text-amber-800">Escolha títulos elegíveis e/ou registre Outros até explicar exatamente o valor. O servidor recalculará tudo antes de concluir.</p></div><button aria-label="Fechar" className="text-amber-800" onClick={resetDifferenceComposition} type="button"><X className="h-5 w-5" /></button></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <div className="rounded border border-amber-200 bg-white p-3"><p className="text-xs text-slate-500">Entradas</p><p className="mt-1 font-semibold">{money(selectedEntryTotal)}</p></div>
          <div className="rounded border border-amber-200 bg-white p-3"><p className="text-xs text-slate-500">Remessas</p><p className="mt-1 font-semibold">{money(selectedRemittanceTotal)}</p></div>
          <div className="rounded border border-amber-200 bg-white p-3"><p className="text-xs text-slate-500">Diferença</p><p className="mt-1 font-semibold">{money(selectedDifference)}</p></div>
          <div className="rounded border border-amber-200 bg-white p-3"><p className="text-xs text-slate-500">Títulos selecionados</p><p className="mt-1 font-semibold">{money(differenceState.titleTotal)}</p></div>
          <div className="rounded border border-amber-200 bg-white p-3"><p className="text-xs text-slate-500">Outros</p><p className="mt-1 font-semibold">{money(differenceState.otherTotal)}</p></div>
          <div className={`rounded border bg-white p-3 ${differenceState.unexplainedCents === BigInt(0) ? "border-emerald-300" : "border-red-300"}`}><p className="text-xs text-slate-500">Falta explicar</p><p className={`mt-1 font-semibold ${differenceState.unexplainedCents === BigInt(0) ? "text-emerald-700" : "text-red-700"}`}>{money(differenceState.unexplainedCents)}</p></div>
        </div>
        <div className="mt-4"><ConsignadoDifferenceComposer difference={selectedDifference} direction={differenceDirection} disabled={pending} exclusions={eligibleExclusions} onOtherDifferencesChange={setOtherDifferences} onSelectedIdsChange={setSelectedExclusionIds} otherDifferences={otherDifferences} selectedIds={selectedExclusionIds} /></div>
        <div className="mt-4 flex justify-end gap-2"><button className="h-9 rounded border border-slate-300 bg-white px-3 text-sm font-semibold" disabled={pending} onClick={resetDifferenceComposition} type="button">Cancelar</button><button aria-describedby="difference-composer-status difference-composer-errors" className="h-9 rounded bg-primary px-3 text-sm font-semibold text-white disabled:opacity-50" disabled={pending || !differenceState.canSubmit} onClick={() => void submitReconciliation()} type="button">Concluir conciliação</button></div>
      </div> : null}
    </section> : null}
    </div>

    <section className="overflow-hidden rounded border border-slate-200 bg-white shadow-executive">
      <div className="border-b border-slate-200 p-5"><h2 className="font-semibold">Histórico de conciliações</h2></div>
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

    <details className="rounded border border-slate-200 bg-white p-5 shadow-executive"><summary className="cursor-pointer font-semibold">Histórico de importações bancárias</summary><div className="mt-4 divide-y">{workspace.imports.map((item) => <div className="flex justify-between gap-3 py-3 text-sm" key={item.id}><span>{item.fileName} · {item.importedBy.name}</span><span className="text-slate-500">{item.importedRows} novas · {item.duplicateRows} repetidas · {item.ignoredRows} ignoradas</span></div>)}</div></details>
  </div>;
}
