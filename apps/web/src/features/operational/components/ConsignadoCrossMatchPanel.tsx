"use client";

import { useState, type ReactNode } from "react";
import { Loader2, Sparkles } from "lucide-react";

type Group = "FULL_KEY" | "OLDEST_NEXT_MONTH" | "OLDEST_WIDE_GAP";
type Suggestion = {
  itemId: string; group: Group; matchedOn: string[]; fileDueDate: string | null; stockDueDate: string | null;
  item: { sourceRow: number; contractNumber: string | null; debtorName: string | null; debtorDocument: string | null; titleAmount: string; paidAmount: string };
  position: { id: string; yourNumber: string | null; documentNumber: string | null; debtorName: string; debtorDocument: string; nominalValue: string; dueDate: string | null };
};
type Unmatched = { itemId: string; sourceRow: number; debtorName: string | null; debtorDocument: string | null; titleAmount: string; paidAmount: string };
type Result = { analyzed: number; suggestions: Suggestion[]; unmatched: Unmatched[] };

const groupLabel: Record<Group, string> = {
  FULL_KEY: "Chave completa",
  OLDEST_NEXT_MONTH: "Parcela mais antiga (um mês)",
  OLDEST_WIDE_GAP: "Parcela mais antiga (intervalo maior)",
};
const groupHint: Record<Group, string> = {
  FULL_KEY: "Sacado, valor e vencimento idênticos ao título do estoque.",
  OLDEST_NEXT_MONTH: "Sem vencimento igual no estoque. Indicada a parcela em aberto mais antiga, que vence um mês depois.",
  OLDEST_WIDE_GAP: "Sem vencimento igual no estoque e o intervalo não é de um mês. Revise um a um antes de aceitar.",
};
const groupOrder: Group[] = ["FULL_KEY", "OLDEST_NEXT_MONTH", "OLDEST_WIDE_GAP"];
const bulkGroups = new Set<Group>(["FULL_KEY", "OLDEST_NEXT_MONTH"]);

function money(value: string | number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value)); }
function day(value: string | null) { return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`)) : "—"; }
function suggestionTotal(entries: Suggestion[]) { return entries.reduce((sum, entry) => sum + Number(entry.item.paidAmount), 0); }
function unmatchedTotal(entries: Unmatched[]) { return entries.reduce((sum, entry) => sum + Number(entry.paidAmount), 0); }

export function ConsignadoCrossMatchPanel({ batchId, itemIds, canManage, renderItem, onApplied }: {
  batchId: string;
  itemIds: string[];
  canManage: boolean;
  renderItem: (itemId: string) => ReactNode;
  onApplied: () => Promise<void>;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function run() {
    setPending(true); setFeedback("");
    try {
      const response = await fetch(`/api/operacional/consignado/baixas/${batchId}/cruzamento`, { cache: "no-store" });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.message);
      setResult({ analyzed: payload.analyzed, suggestions: payload.suggestions, unmatched: payload.unmatched });
      setFeedback(`${payload.analyzed} títulos analisados · ${payload.suggestions.length} com sugestão.`);
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Erro ao cruzar títulos."); }
    finally { setPending(false); }
  }

  async function apply(itemIds: string[], label: string) {
    if (!window.confirm(`Aceitar ${itemIds.length} sugestão(ões) de ${label}? Os títulos serão baixados contra os títulos indicados.`)) return;
    setPending(true); setFeedback("");
    try {
      const response = await fetch(`/api/operacional/consignado/baixas/${batchId}/cruzamento`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemIds }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.message);
      setFeedback(payload.message);
      setResult(null);
      await onApplied();
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Erro ao aplicar o cruzamento."); }
    finally { setPending(false); }
  }

  return <div className="mt-4 space-y-4">
    {canManage ? <div className="flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-white p-3">
      <button className="inline-flex h-9 items-center gap-2 rounded bg-primary px-3 text-sm font-semibold text-white disabled:opacity-60" disabled={pending} onClick={() => void run()} type="button">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Cruzar títulos com IA
      </button>
      <p className="text-xs text-slate-500">Procura o título no estoque por sacado, valor nominal e vencimento quando o &quot;seu número&quot; do arquivo não bate.</p>
      {feedback ? <p className="w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{feedback}</p> : null}
    </div> : null}

    {result ? groupOrder.flatMap((group) => {
      const entries = result.suggestions.filter((suggestion) => suggestion.group === group);
      if (!entries.length) return [];
      return [<section className="rounded border border-emerald-200 bg-emerald-50/40 p-4" key={group}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="font-semibold text-emerald-900">{groupLabel[group]} ({entries.length} · {money(suggestionTotal(entries))})</h4>
            <p className="mt-1 text-sm text-emerald-800">{groupHint[group]}</p>
          </div>
          {canManage && bulkGroups.has(group) ? <button className="rounded bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={pending} onClick={() => void apply(entries.map((entry) => entry.itemId), groupLabel[group].toLowerCase())} type="button">Aceitar as {entries.length} sugestões</button> : null}
        </div>
        <div className="mt-3 space-y-3">{entries.map((entry) => <div className="rounded border border-emerald-200 bg-white p-3" key={entry.itemId}>
          <div className="flex flex-wrap items-start justify-between gap-3 text-sm">
            <div>
              <p className="font-semibold text-slate-900">{entry.item.debtorName ?? "Sacado não informado"}</p>
              <p className="text-xs text-slate-500">linha {entry.item.sourceRow} · contrato {entry.item.contractNumber ?? "—"} · arquivo vence {day(entry.fileDueDate)} · {money(entry.item.paidAmount)}</p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-emerald-900">Título {entry.position.yourNumber ?? entry.position.id}{entry.position.documentNumber ? ` · parcela ${entry.position.documentNumber}` : ""}</p>
              <p className="text-xs text-emerald-800">estoque vence {day(entry.position.dueDate)} · {money(entry.position.nominalValue)} · {entry.position.debtorDocument}</p>
            </div>
          </div>
          {canManage ? <div className="mt-2 flex justify-end">
            <button className="h-8 rounded border border-primary px-3 text-xs font-semibold text-primary disabled:opacity-60" disabled={pending} onClick={() => void apply([entry.itemId], "título individual")} type="button">Aceitar este</button>
          </div> : null}
          <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold text-slate-600">Ver o título original e pesquisar manualmente</summary><div className="mt-2">{renderItem(entry.itemId)}</div></details>
        </div>)}</div>
      </section>];
    }) : null}

    {result?.unmatched.length ? <section className="rounded border border-slate-200 bg-white p-4">
      <h4 className="font-semibold text-slate-900">Sem sugestão ({result.unmatched.length} · {money(unmatchedTotal(result.unmatched))})</h4>
      <p className="mt-1 text-sm text-slate-500">Nenhum título do estoque bate sacado e valor. Seguem como não encontrados.</p>
      <div className="mt-3 space-y-3">{result.unmatched.map((entry) => <div key={entry.itemId}>{renderItem(entry.itemId)}</div>)}</div>
    </section> : null}

    {result ? null : <div className="space-y-3">{itemIds.map((itemId) => <div key={itemId}>{renderItem(itemId)}</div>)}</div>}
  </div>;
}
