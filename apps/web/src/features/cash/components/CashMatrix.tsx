import type { CashDailyBalance } from "@/features/cash/types/cash";
import { centsToBRL, decimalStringToCents } from "@/features/cash/lib/cash-utils";

type CashValueKey =
  | "receivingBalance"
  | "reconciliationBalance"
  | "reserveBalance"
  | "paymentBalance"
  | "usedAmount"
  | "cash";

type CashRow =
  | { kind: "section"; label: string; hint?: string }
  | { kind: "value"; key: CashValueKey; label: string; sign?: "+" | "−" }
  | { kind: "result"; key: CashValueKey; label: string };

/**
 * As contas sao agrupadas pela funcao que exercem: apenas Conta pgto, Reserva
 * e Usado entram em `Caixa = Conta pgto − Reserva − Usado`. Recebimento e
 * conciliacao sao informativos. Listar as cinco em sequencia, sem distincao,
 * sugeria que todas compunham o resultado.
 */
const ROWS: CashRow[] = [
  { kind: "section", label: "Saldos informativos", hint: "fora do cálculo" },
  { kind: "value", key: "receivingBalance", label: "Conta recebimento" },
  { kind: "value", key: "reconciliationBalance", label: "Conta de conciliação" },
  {
    kind: "section",
    label: "Composição do caixa",
    hint: "Caixa = Conta pgto − Reserva − Usado"
  },
  { kind: "value", key: "paymentBalance", label: "Conta pgto", sign: "+" },
  { kind: "value", key: "reserveBalance", label: "Reserva", sign: "−" },
  { kind: "value", key: "usedAmount", label: "Usado", sign: "−" },
  { kind: "result", key: "cash", label: "Caixa" }
];

function SignBadge({ sign }: { sign: "+" | "−" }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[11px] font-bold leading-none ${
        sign === "+"
          ? "bg-emerald-100 text-emerald-800"
          : "bg-slate-200 text-slate-600"
      }`}
    >
      {sign}
    </span>
  );
}

export function CashMatrix({ balances }: { balances: CashDailyBalance[] }) {
  if (balances.length === 0) {
    return (
      <div className="px-5 py-12 text-center">
        <p className="text-sm font-medium text-slate-700">
          Nenhuma posição cadastrada para esta data.
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Escolha outra data em &ldquo;Datas com lançamento&rdquo; ou lance a
          posição do dia.
        </p>
      </div>
    );
  }

  const columnCount = balances.length + 1;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <th className="sticky left-0 z-10 min-w-[220px] border-r border-slate-200 bg-slate-50 px-5 py-3 text-left font-semibold">
              Conta
            </th>
            {balances.map((balance) => (
              <th
                className="min-w-[150px] px-5 py-3 text-right font-semibold"
                key={balance.fundId}
              >
                {balance.fundShortName || balance.fundName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            if (row.kind === "section") {
              return (
                <tr key={row.label}>
                  <td
                    className="border-y border-slate-200 bg-slate-50 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                    colSpan={columnCount}
                  >
                    {row.label}
                    {row.hint ? (
                      <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                        {row.hint}
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            }

            const cents = balances.map((balance) =>
              decimalStringToCents(balance[row.key])
            );
            const isResult = row.kind === "result";

            // Solido, sem alpha: este fundo tambem vale para a primeira coluna
            // (sticky) e o conteudo passaria por baixo dela na rolagem.
            const rowBg = isResult ? "bg-emerald-50" : "bg-white";
            const labelColor = isResult
              ? "font-semibold text-emerald-900"
              : "text-slate-700";

            return (
              <tr
                className={`${rowBg} ${
                  isResult ? "border-t-2 border-emerald-200" : ""
                }`}
                key={row.key}
              >
                <td
                  className={`sticky left-0 z-10 min-w-[220px] border-r border-slate-200 px-5 py-3 text-left ${rowBg} ${labelColor}`}
                >
                  <span className="flex items-center gap-2">
                    {row.kind === "value" && row.sign ? (
                      <SignBadge sign={row.sign} />
                    ) : null}
                    {row.label}
                  </span>
                </td>

                {balances.map((balance, index) => {
                  const value = cents[index];
                  const isZero = value === 0;

                  return (
                    <td
                      className={`osher-num min-w-[150px] px-5 py-3 text-right ${
                        isResult
                          ? "font-semibold text-emerald-900"
                          : isZero
                            ? "text-slate-400"
                            : "text-slate-700"
                      }`}
                      key={balance.fundId}
                    >
                      {centsToBRL(value)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
