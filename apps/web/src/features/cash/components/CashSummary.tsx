import type { CashDailyBalance } from "@/features/cash/types/cash";
import { centsToBRL, decimalStringToCents } from "@/features/cash/lib/cash-utils";

/**
 * Caixa por fundo no dia. Nao introduz calculo novo: e o mesmo valor em
 * centavos inteiros que a matriz mostra na linha "Caixa". A participacao (%)
 * e derivada desses mesmos valores, apenas para leitura.
 */
export function CashSummary({ balances }: { balances: CashDailyBalance[] }) {
  if (balances.length === 0) {
    return null;
  }

  const perFund = balances.map((balance) => ({
    id: balance.fundId,
    name: balance.fundShortName || balance.fundName,
    cents: decimalStringToCents(balance.cash)
  }));

  // Usado somente como base da participacao — nao e exibido.
  const total = perFund.reduce((sum, fund) => sum + fund.cents, 0);

  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {perFund.map((fund) => {
        // Participacao so faz sentido com total positivo; com caixa zerado
        // ou negativo a barra fica vazia em vez de mostrar numero enganoso.
        const share =
          total > 0 && fund.cents > 0 ? (fund.cents / total) * 100 : 0;

        return (
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

            <div
              aria-hidden="true"
              className="mt-3 h-1 overflow-hidden rounded-full bg-slate-100"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${share.toFixed(2)}%` }}
              />
            </div>
            <p className="osher-num mt-1.5 text-xs text-slate-500">
              {share.toLocaleString("pt-BR", {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1
              })}
              % do caixa
            </p>
          </div>
        );
      })}
    </section>
  );
}
