"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import type { CashDailyBalance, CashFund } from "@/features/cash/types/cash";
import { CashDatePicker } from "./CashDatePicker";
import { CashMatrix } from "./CashMatrix";
import { CashSummary } from "./CashSummary";
import { CashForm } from "./CashForm";

type CashViewProps = {
  selectedDate: string;
  availableDates: string[];
  balances: CashDailyBalance[];
  funds: CashFund[];
  canManage: boolean;
};

function formatDateLabel(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function CashView({
  selectedDate,
  availableDates,
  balances,
  funds,
  canManage,
}: CashViewProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  // Ao trocar de data, sempre voltar para o modo de visualização.
  useEffect(() => {
    setEditing(false);
  }, [selectedDate]);

  return (
    <div className="space-y-6">
      <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <CashDatePicker availableDates={availableDates} selectedDate={selectedDate} />

          {canManage && !editing ? (
            <button
              className="inline-flex h-10 items-center gap-2 rounded bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
              onClick={() => setEditing(true)}
              type="button"
            >
              <Pencil className="h-4 w-4" />
              Editar posição
            </button>
          ) : null}
        </div>
      </section>

      {!editing ? <CashSummary balances={balances} /> : null}

      <section className="rounded border border-slate-200 bg-white shadow-executive">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">
            {editing ? "Lançar posição de caixa" : "Posição de caixa"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Saldos do dia {formatDateLabel(selectedDate)} · valores em reais.
          </p>
        </div>

        <div className={editing ? "p-5" : ""}>
          {editing ? (
            <CashForm
              balances={balances}
              funds={funds}
              onCancel={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                router.refresh();
              }}
              referenceDate={selectedDate}
            />
          ) : (
            <CashMatrix balances={balances} />
          )}
        </div>
      </section>
    </div>
  );
}
