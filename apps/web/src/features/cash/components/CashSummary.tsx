import type { CashDailyBalance } from "@/features/cash/types/cash";
import { centsToBRL, decimalStringToCents } from "@/features/cash/lib/cash-utils";

/** Caixa por fundo no dia, usando o mesmo valor exibido na matriz. */
export function CashSummary({ balances }: { balances: CashDailyBalance[] }) {
  if (balances.length === 0) {
    return null;
  }

  const perFund = balances.map((balance) => ({
    id: balance.fundId,
    name: balance.fundShortName || balance.fundName,
    cents: decimalStringToCents(balance.cash)
  }));

  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {perFund.map((fund) => (
        <div
          className="rounded border border-slate-200 bg-white p-4 shadow-executive"
          key={fund.id}
        >
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500">
            {fund.name}
          </p>
          <p
            className={`osher-num mt-1.5 text-lg font-bold ${
              fund.cents === 0 ? "text-slate-400" : "text-slate-950"
            }`}
          >
            {centsToBRL(fund.cents)}
          </p>
        </div>
      ))}
    </section>
  );
}
