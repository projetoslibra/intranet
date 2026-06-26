"use client";

import type { CashFund } from "@/features/cash/types/cash";
import { computeCash, formatBRL, parseBRNumber } from "@/features/cash/lib/cash-utils";

export type FundFormValues = {
  receivingBalance: string;
  reconciliationBalance: string;
  reserveBalance: string;
  paymentBalance: string;
  usedAmount: string;
  note: string;
};

export const CASH_FIELDS = [
  { key: "receivingBalance", label: "Conta recebimento" },
  { key: "reconciliationBalance", label: "Conta de conciliação" },
  { key: "reserveBalance", label: "Reserva" },
  { key: "paymentBalance", label: "Conta pgto" },
  { key: "usedAmount", label: "Usado" },
] as const;

type CashFundCardProps = {
  fund: CashFund;
  values: FundFormValues;
  disabled?: boolean;
  onChange: (field: keyof FundFormValues, value: string) => void;
};

export function CashFundCard({ fund, values, disabled, onChange }: CashFundCardProps) {
  const cash = computeCash(
    parseBRNumber(values.paymentBalance),
    parseBRNumber(values.reserveBalance),
    parseBRNumber(values.usedAmount)
  );

  return (
    <div className="rounded border border-slate-200 bg-white p-5 shadow-executive">
      <h3 className="text-base font-semibold text-slate-950">
        {fund.shortName || fund.name}
      </h3>

      <div className="mt-4 grid gap-3">
        {CASH_FIELDS.map((field) => (
          <div className="space-y-1.5" key={field.key}>
            <label
              className="text-sm font-medium text-slate-700"
              htmlFor={`${fund.id}-${field.key}`}
            >
              {field.label}
            </label>
            <input
              className="h-10 w-full rounded border border-slate-200 px-3 text-right text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              disabled={disabled}
              id={`${fund.id}-${field.key}`}
              inputMode="decimal"
              onChange={(event) => onChange(field.key, event.target.value)}
              placeholder="0,00"
              value={values[field.key]}
            />
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3">
        <span className="text-sm font-semibold uppercase text-slate-500">Caixa</span>
        <span className="text-lg font-bold text-emerald-900">{formatBRL(cash)}</span>
      </div>
    </div>
  );
}
