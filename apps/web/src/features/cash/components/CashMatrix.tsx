import type { CashDailyBalance } from "@/features/cash/types/cash";
import { centsToBRL, decimalStringToCents } from "@/features/cash/lib/cash-utils";

type CashRowKey =
  | "receivingBalance"
  | "reconciliationBalance"
  | "reserveBalance"
  | "paymentBalance"
  | "usedAmount"
  | "cash";

const ROWS: { key: CashRowKey; label: string; strong?: boolean }[] = [
  { key: "receivingBalance", label: "Conta recebimento" },
  { key: "reconciliationBalance", label: "Conta de conciliação" },
  { key: "reserveBalance", label: "Reserva" },
  { key: "paymentBalance", label: "Conta pgto" },
  { key: "usedAmount", label: "Usado" },
  { key: "cash", label: "Caixa", strong: true },
];

export function CashMatrix({ balances }: { balances: CashDailyBalance[] }) {
  if (balances.length === 0) {
    return (
      <p className="px-5 py-8 text-sm text-slate-500">
        Nenhuma posição cadastrada para esta data.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <th className="sticky left-0 z-10 min-w-[200px] border-r border-slate-200 bg-slate-50 px-5 py-3 text-left font-semibold">
              Conta
            </th>
            {balances.map((balance) => (
              <th className="min-w-[150px] px-5 py-3 text-right font-semibold" key={balance.fundId}>
                {balance.fundShortName || balance.fundName}
              </th>
            ))}
            <th className="min-w-[150px] px-5 py-3 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            const cents = balances.map((balance) => decimalStringToCents(balance[row.key]));
            const total = cents.reduce((sum, value) => sum + value, 0);
            const rowClass = row.strong
              ? "border-t-2 border-slate-300 bg-emerald-50 font-bold text-emerald-900"
              : "bg-white text-slate-700";

            return (
              <tr className={rowClass} key={row.key}>
                <td
                  className={`sticky left-0 z-10 min-w-[200px] border-r border-slate-200 px-5 py-3 text-left ${rowClass}`}
                >
                  {row.label}
                </td>
                {balances.map((balance, index) => (
                  <td className="min-w-[150px] px-5 py-3 text-right" key={balance.fundId}>
                    {centsToBRL(cents[index])}
                  </td>
                ))}
                <td className="min-w-[150px] px-5 py-3 text-right font-semibold">
                  {centsToBRL(total)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
