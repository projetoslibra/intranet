"use client";

import { useState, useTransition } from "react";
import { upsertBatchCashDailyBalances } from "@/app/dashboard/caixa/actions";
import type { CashDailyBalance, CashFund } from "@/features/cash/types/cash";
import { decimalStringToEditable, parseBRNumber } from "@/features/cash/lib/cash-utils";
import { CashFundCard, type FundFormValues } from "./CashFundCard";

type CashFormProps = {
  funds: CashFund[];
  balances: CashDailyBalance[];
  referenceDate: string;
  onSaved: () => void;
  onCancel: () => void;
};

const EMPTY: FundFormValues = {
  receivingBalance: "0,00",
  reconciliationBalance: "0,00",
  reserveBalance: "0,00",
  paymentBalance: "0,00",
  usedAmount: "0,00",
  note: "",
};

function buildInitialValues(
  funds: CashFund[],
  balances: CashDailyBalance[]
): Record<string, FundFormValues> {
  const byFund = new Map(balances.map((balance) => [balance.fundId, balance]));

  return Object.fromEntries(
    funds.map((fund) => {
      const existing = byFund.get(fund.id);
      if (!existing) {
        return [fund.id, { ...EMPTY }];
      }

      return [
        fund.id,
        {
          receivingBalance: decimalStringToEditable(existing.receivingBalance),
          reconciliationBalance: decimalStringToEditable(existing.reconciliationBalance),
          reserveBalance: decimalStringToEditable(existing.reserveBalance),
          paymentBalance: decimalStringToEditable(existing.paymentBalance),
          usedAmount: decimalStringToEditable(existing.usedAmount),
          note: existing.note ?? "",
        },
      ];
    })
  );
}

export function CashForm({ funds, balances, referenceDate, onSaved, onCancel }: CashFormProps) {
  const [values, setValues] = useState<Record<string, FundFormValues>>(() =>
    buildInitialValues(funds, balances)
  );
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleChange(fundId: string, field: keyof FundFormValues, value: string) {
    setValues((previous) => ({
      ...previous,
      [fundId]: { ...previous[fundId], [field]: value },
    }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setHasError(false);

    const input = {
      referenceDate,
      balances: funds.map((fund) => {
        const current = values[fund.id] ?? EMPTY;
        return {
          fundId: fund.id,
          receivingBalance: parseBRNumber(current.receivingBalance),
          reconciliationBalance: parseBRNumber(current.reconciliationBalance),
          reserveBalance: parseBRNumber(current.reserveBalance),
          paymentBalance: parseBRNumber(current.paymentBalance),
          usedAmount: parseBRNumber(current.usedAmount),
          note: current.note.trim() ? current.note.trim() : undefined,
        };
      }),
    };

    startTransition(async () => {
      const result = await upsertBatchCashDailyBalances(input);
      setMessage(result.message);
      setHasError(!result.ok);
      if (result.ok) {
        onSaved();
      }
    });
  }

  if (funds.length === 0) {
    return (
      <p className="px-5 py-8 text-sm text-slate-500">
        Nenhum fundo ativo cadastrado. Cadastre os fundos antes de lançar posições de caixa.
      </p>
    );
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      {message ? (
        <p
          className={
            hasError
              ? "rounded border border-destructive/20 bg-red-50 px-3 py-2 text-sm text-destructive"
              : "rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
          }
        >
          {message}
        </p>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2">
        {funds.map((fund) => (
          <CashFundCard
            disabled={pending}
            fund={fund}
            key={fund.id}
            onChange={(field, value) => handleChange(fund.id, field, value)}
            values={values[fund.id] ?? EMPTY}
          />
        ))}
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-5">
        <button
          className="h-10 rounded border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-70"
          disabled={pending}
          onClick={onCancel}
          type="button"
        >
          Cancelar
        </button>
        <button
          className="h-10 rounded bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
          disabled={pending}
          type="submit"
        >
          {pending ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </form>
  );
}
