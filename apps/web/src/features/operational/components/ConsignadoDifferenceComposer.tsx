"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  composeDifferenceState,
  type DifferenceDirection,
  type EligibleExclusion,
  type OtherDifferenceCategory,
  type OtherDifferenceDraft,
  type RemittanceExclusionCategory,
} from "../consignado-difference-composer";

export type DifferenceComposerProps = {
  difference: number;
  direction: DifferenceDirection;
  exclusions: EligibleExclusion[];
  selectedIds: string[];
  otherDifferences: OtherDifferenceDraft[];
  disabled: boolean;
  onSelectedIdsChange(ids: string[]): void;
  onOtherDifferencesChange(items: OtherDifferenceDraft[]): void;
};

const exclusionCategoryLabel: Record<RemittanceExclusionCategory, string> = {
  NOT_FOUND_IN_STOCK: "Não encontrado no estoque",
  OPERATOR_EXCLUDED: "Excluído pelo operador",
  NOT_APPROVED: "Não aprovado",
  PDD_RECOVERY: "Recuperação de PDD",
  OTHER_DIVERGENCE: "Outra divergência",
};

const otherCategoryLabel: Record<OtherDifferenceCategory, string> = {
  BANK_FEE: "Tarifa bancária",
  UNIDENTIFIED_CREDIT: "Crédito não identificado",
  VALUE_DIFFERENCE: "Diferença de valor",
  ROUNDING: "Arredondamento",
  TIMING_DIFFERENCE: "Diferença de competência",
  OTHER: "Outro",
};

function money(value: string | number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(value)) : "—";
}

function normalized(value: string | null) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function ConsignadoDifferenceComposer({
  difference,
  direction,
  exclusions,
  selectedIds,
  otherDifferences,
  disabled,
  onSelectedIdsChange,
  onOtherDifferencesChange,
}: DifferenceComposerProps) {
  const [contractFilter, setContractFilter] = useState("");
  const [debtorFilter, setDebtorFilter] = useState("");
  const [documentFilter, setDocumentFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<RemittanceExclusionCategory | "">("");
  const state = composeDifferenceState({ difference, direction, exclusions, selectedIds, otherDifferences });
  const visibleExclusions = useMemo(() => exclusions.filter((item) => (
    (!contractFilter || normalized(item.contractNumber).includes(normalized(contractFilter)))
    && (!debtorFilter || normalized(item.debtorName).includes(normalized(debtorFilter)))
    && (!documentFilter || normalized(item.debtorDocument).includes(normalized(documentFilter)))
    && (!categoryFilter || item.category === categoryFilter)
  )), [categoryFilter, contractFilter, debtorFilter, documentFilter, exclusions]);

  function toggleExclusion(item: EligibleExclusion) {
    if (selectedIds.includes(item.id)) {
      onSelectedIdsChange(selectedIds.filter((id) => id !== item.id));
      return;
    }
    onSelectedIdsChange([...selectedIds, item.id]);
  }

  function updateOther(index: number, patch: Partial<OtherDifferenceDraft>) {
    onOtherDifferencesChange(otherDifferences.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function addOtherDifference() {
    onOtherDifferencesChange([...otherDifferences, {
      category: "",
      amount: state.unexplained > 0 ? state.unexplained.toFixed(2) : "",
      reason: "",
    }]);
  }

  return <div className="space-y-4">
    {direction === "ENTRY_EXCESS" ? <details className="rounded border border-amber-200 bg-white" open>
      <summary className="cursor-pointer px-4 py-3 font-semibold text-slate-900">Explicar com títulos fora da remessa</summary>
      <div className="border-t border-amber-100 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs font-medium text-slate-600">Contrato<input className="mt-1 block h-9 w-full rounded border border-slate-200 px-3 text-sm" onChange={(event) => setContractFilter(event.target.value)} placeholder="Buscar contrato" value={contractFilter} /></label>
          <label className="text-xs font-medium text-slate-600">Sacado<input className="mt-1 block h-9 w-full rounded border border-slate-200 px-3 text-sm" onChange={(event) => setDebtorFilter(event.target.value)} placeholder="Buscar sacado" value={debtorFilter} /></label>
          <label className="text-xs font-medium text-slate-600">CPF<input className="mt-1 block h-9 w-full rounded border border-slate-200 px-3 text-sm" onChange={(event) => setDocumentFilter(event.target.value)} placeholder="Buscar CPF" value={documentFilter} /></label>
          <label className="text-xs font-medium text-slate-600">Categoria<select className="mt-1 block h-9 w-full rounded border border-slate-200 bg-white px-3 text-sm" onChange={(event) => setCategoryFilter(event.target.value as RemittanceExclusionCategory | "")} value={categoryFilter}><option value="">Todas</option>{Object.entries(exclusionCategoryLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <div className="mt-4 max-h-80 space-y-2 overflow-auto">
          {visibleExclusions.map((item) => {
            const selected = selectedIds.includes(item.id);
            const exceedsRemaining = !selected && Math.round((state.titleTotal + Number(item.paidAmount)) * 100) > Math.round(difference * 100);
            return <label className={`block rounded border p-3 ${selected ? "border-primary bg-blue-50" : "border-slate-200"} ${exceedsRemaining ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`} key={item.id}>
              <div className="flex items-start gap-3">
                <input checked={selected} className="mt-1" disabled={disabled || exceedsRemaining} onChange={() => toggleExclusion(item)} type="checkbox" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold">{item.debtorName ?? "Sacado não informado"}</p><p className="text-xs text-slate-500">Contrato {item.contractNumber ?? "—"} · CPF {item.debtorDocument ?? "—"} · Vencimento {date(item.dueDate)}</p></div><div className="text-right"><p className="text-sm font-semibold">{money(item.paidAmount)}</p><p className="text-xs text-slate-500">Face {money(item.titleAmount)}</p></div></div>
                  <p className="mt-2 text-xs text-slate-500">Baixa {item.batchFileName} · Remessa {item.remittanceFileName}</p>
                  <p className="mt-1 text-xs text-amber-800">{exclusionCategoryLabel[item.category]}: {item.reason}</p>
                  {exceedsRemaining ? <p className="mt-1 text-xs font-medium text-red-700">O valor integral deste título supera o saldo disponível.</p> : null}
                </div>
              </div>
            </label>;
          })}
          {!visibleExclusions.length ? <p className="rounded border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">Nenhum título elegível corresponde aos filtros.</p> : null}
        </div>
      </div>
    </details> : <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">Como as remessas excedem as entradas, títulos fora da remessa não podem ser usados. Explique toda a diferença em &quot;Outros&quot;.</div>}

    <section className="rounded border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-semibold">Outros ajustes</h4><p className="text-sm text-slate-500">Cada ajuste permanece como pendência operacional até ser resolvido.</p></div>{state.unexplained > 0 ? <button className="inline-flex h-9 items-center gap-2 rounded border border-slate-300 px-3 text-sm font-semibold disabled:opacity-50" disabled={disabled} onClick={addOtherDifference} type="button"><Plus className="h-4 w-4" />Adicionar outro ajuste</button> : null}</div>
      {otherDifferences.length ? <div className="mt-4 space-y-3">{otherDifferences.map((item, index) => <div className="grid gap-3 rounded border border-slate-200 p-3 md:grid-cols-[minmax(0,1fr)_10rem_2fr_auto]" key={index}>
        <label className="text-xs font-medium text-slate-600">Categoria<select className="mt-1 block h-9 w-full rounded border border-slate-200 bg-white px-3 text-sm" disabled={disabled} onChange={(event) => updateOther(index, { category: event.target.value as OtherDifferenceCategory | "" })} value={item.category}><option value="">Selecione</option>{Object.entries(otherCategoryLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-xs font-medium text-slate-600">Valor<input className="mt-1 block h-9 w-full rounded border border-slate-200 px-3 text-sm" disabled={disabled} inputMode="decimal" onChange={(event) => updateOther(index, { amount: event.target.value.replace(",", ".") })} placeholder="0.00" value={item.amount} /></label>
        <label className="text-xs font-medium text-slate-600">Justificativa<input className="mt-1 block h-9 w-full rounded border border-slate-200 px-3 text-sm" disabled={disabled} maxLength={500} onChange={(event) => updateOther(index, { reason: event.target.value })} placeholder="Mínimo de cinco caracteres" value={item.reason} /></label>
        <button aria-label={`Remover ajuste ${index + 1}`} className="mt-5 inline-flex h-9 w-9 items-center justify-center rounded border border-red-200 text-red-700 disabled:opacity-50" disabled={disabled} onClick={() => onOtherDifferencesChange(otherDifferences.filter((_, itemIndex) => itemIndex !== index))} type="button"><Trash2 className="h-4 w-4" /></button>
      </div>)}</div> : <p className="mt-4 rounded border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">{state.unexplained > 0 ? "Adicione um ajuste para explicar o saldo que não foi coberto por títulos." : "Nenhum outro ajuste necessário."}</p>}
    </section>

    {state.hasIncompleteOtherDifference ? <p className="text-sm font-medium text-red-700">Preencha categoria, valor positivo e justificativa de pelo menos cinco caracteres em todos os ajustes.</p> : null}
    {state.hasTitleOverflow || state.hasOtherOverflow ? <p className="text-sm font-medium text-red-700">A explicação ultrapassa a diferença selecionada.</p> : null}
  </div>;
}
