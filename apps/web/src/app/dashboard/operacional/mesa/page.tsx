import Link from "next/link";
import { AlertTriangle, CheckCircle2, UploadCloud } from "lucide-react";
import { hasPermission } from "@/lib/permissions";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { CashMatrix } from "@/features/cash/components/CashMatrix";
import { OperationalImportPanel } from "@/features/operational/components/OperationalImportPanel";
import { getOperationDeskData, type ConcentrationRow } from "../data";

type MesaPageProps = {
  searchParams?: {
    date?: string;
    tab?: string;
  };
};

function formatDateKey(value: string | null) {
  if (!value) {
    return "Sem data";
  }
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function statusBadge(current: number, limit: number) {
  const ok = current <= limit;
  const Icon = ok ? CheckCircle2 : AlertTriangle;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold ${
        ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {ok ? "Enquadrado" : "Fora do limite"}
    </span>
  );
}

function ConcentrationTable({ rows }: { rows: ConcentrationRow[] }) {
  if (!rows.length) {
    return <p className="px-4 py-6 text-sm text-slate-500">Sem dados de estoque.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <th className="px-4 py-3 text-left font-semibold">Nome</th>
            <th className="px-4 py-3 text-left font-semibold">Documento</th>
            <th className="px-4 py-3 text-right font-semibold">Valor</th>
            <th className="px-4 py-3 text-right font-semibold">% PL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-b border-slate-100" key={`${row.document}-${row.name}`}>
              <td className="px-4 py-3 font-medium text-slate-800">{row.name}</td>
              <td className="px-4 py-3 text-slate-500">{row.document}</td>
              <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(row.value)}</td>
              <td className="px-4 py-3 text-right font-semibold text-slate-900">
                {row.share.toFixed(2)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function MesaPage({ searchParams }: MesaPageProps) {
  const canView = await hasPermission("operational.view");

  if (!canView) {
    return (
      <section className="rounded border border-slate-200 bg-white p-6 shadow-executive">
        <h2 className="text-lg font-semibold text-slate-950">Mesa de Operações</h2>
        <p className="mt-2 text-sm text-slate-500">
          Você não tem permissão para visualizar a Mesa de Operações.
        </p>
      </section>
    );
  }

  const [data, canImportRisk] = await Promise.all([
    getOperationDeskData(searchParams?.date),
    hasPermission("operational.risk.import"),
  ]);
  const selectedTab = searchParams?.tab ?? "caixa";
  const tabs = [
    ["caixa", "Caixa"],
    ["enquadramento", "Enquadramento"],
    ["risco", "Risco"],
  ];

  return (
    <div className="space-y-6">
      <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Mesa de Operações</h2>
            <p className="mt-1 text-sm text-slate-500">
              Caixa, enquadramento e risco consolidados pelas bases operacionais.
            </p>
          </div>

          <form className="flex items-end gap-3">
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Data</span>
              <select
                className="h-10 rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                defaultValue={data.selectedDate}
                name="date"
              >
                {data.availableDates.length ? (
                  data.availableDates.map((date) => (
                    <option key={date} value={date}>
                      {formatDateKey(date)}
                    </option>
                  ))
                ) : (
                  <option value={data.selectedDate}>{formatDateKey(data.selectedDate)}</option>
                )}
              </select>
            </label>
            <input name="tab" type="hidden" value={selectedTab} />
            <button
              className="h-10 rounded border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              type="submit"
            >
              Atualizar
            </button>
          </form>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {tabs.map(([key, label]) => (
            <Link
              className={`rounded px-3 py-2 text-sm font-semibold transition ${
                selectedTab === key
                  ? "bg-primary text-primary-foreground"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
              href={`/dashboard/operacional/mesa?date=${data.selectedDate}&tab=${key}`}
              key={key}
            >
              {label}
            </Link>
          ))}
        </div>
      </section>

      {selectedTab === "caixa" ? (
        <section className="rounded border border-slate-200 bg-white shadow-executive">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-950">Caixa dos fundos</h3>
            <p className="mt-1 text-sm text-slate-500">
              Posição de {formatDateKey(data.selectedDate)} preenchida pelo Financeiro.
            </p>
          </div>
          <CashMatrix balances={data.cashBalances} />
        </section>
      ) : null}

      {selectedTab === "enquadramento" ? (
        <div className="space-y-5">
          {data.stockSummaries.length ? (
            data.stockSummaries.map((fund) => (
              <section
                className="rounded border border-slate-200 bg-white shadow-executive"
                key={fund.fundId}
              >
                <div className="border-b border-slate-200 px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h3 className="text-base font-semibold text-slate-950">{fund.fundName}</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Estoque {formatDateKey(fund.referenceDate)} · PL{" "}
                        {fund.plDate ? formatDateKey(fund.plDate) : "não encontrado"} ·{" "}
                        {formatCurrency(fund.pl)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 p-5 lg:grid-cols-4">
                  <div className="rounded border border-slate-200 p-4">
                    <p className="text-xs font-semibold uppercase text-slate-500">
                      Maior cedente
                    </p>
                    <p className="mt-2 text-lg font-semibold text-slate-950">
                      {(fund.largestCedent?.share ?? 0).toFixed(2)}%
                    </p>
                    <div className="mt-2">{statusBadge(fund.largestCedent?.share ?? 0, fund.limits.largestCedent)}</div>
                  </div>
                  <div className="rounded border border-slate-200 p-4">
                    <p className="text-xs font-semibold uppercase text-slate-500">
                      Top 5 cedentes
                    </p>
                    <p className="mt-2 text-lg font-semibold text-slate-950">
                      {fund.topCedentsShare.toFixed(2)}%
                    </p>
                    <div className="mt-2">{statusBadge(fund.topCedentsShare, fund.limits.topCedents)}</div>
                  </div>
                  <div className="rounded border border-slate-200 p-4">
                    <p className="text-xs font-semibold uppercase text-slate-500">
                      Maior sacado
                    </p>
                    <p className="mt-2 text-lg font-semibold text-slate-950">
                      {(fund.largestDebtor?.share ?? 0).toFixed(2)}%
                    </p>
                    <div className="mt-2">{statusBadge(fund.largestDebtor?.share ?? 0, fund.limits.largestDebtor)}</div>
                  </div>
                  <div className="rounded border border-slate-200 p-4">
                    <p className="text-xs font-semibold uppercase text-slate-500">
                      Top {fund.limits.topDebtorsCount} sacados
                    </p>
                    <p className="mt-2 text-lg font-semibold text-slate-950">
                      {fund.topDebtorsShare.toFixed(2)}%
                    </p>
                    <div className="mt-2">{statusBadge(fund.topDebtorsShare, fund.limits.topDebtors)}</div>
                  </div>
                </div>

                <div className="grid gap-5 border-t border-slate-200 p-5 xl:grid-cols-2">
                  <div className="rounded border border-slate-200">
                    <h4 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
                      Cedentes
                    </h4>
                    <ConcentrationTable rows={fund.cedents} />
                  </div>
                  <div className="rounded border border-slate-200">
                    <h4 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
                      Sacados
                    </h4>
                    <ConcentrationTable rows={fund.debtors} />
                  </div>
                </div>
              </section>
            ))
          ) : (
            <section className="rounded border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-executive">
              Nenhum estoque importado para esta data.
            </section>
          )}
        </div>
      ) : null}

      {selectedTab === "risco" ? (
        <div className="space-y-5">
          {canImportRisk ? (
            <OperationalImportPanel
              dateField={{
                name: "referenceDate",
                label: "Data de referência do risco",
                defaultValue: data.selectedDate,
                required: true,
              }}
              description="A Mesa sobe a planilha de risco; cedentes sem DIM entram como não identificados."
              endpoint="/api/operacional/risco/import"
              submitLabel="Importar risco"
              title="Upload de risco"
            />
          ) : null}

          <section className="rounded border border-slate-200 bg-white shadow-executive">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-slate-950">Risco</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Base {formatDateKey(data.risk.referenceDate)} · {data.risk.unidentifiedRows} sem DIM
                </p>
              </div>
              <UploadCloud className="h-5 w-5 text-slate-400" />
            </div>

            {data.risk.rows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                      <th className="px-4 py-3 text-left font-semibold">Comercial</th>
                      <th className="px-4 py-3 text-left font-semibold">Código</th>
                      <th className="px-4 py-3 text-left font-semibold">Cedente</th>
                      <th className="px-4 py-3 text-right font-semibold">Lim. utilizado</th>
                      <th className="px-4 py-3 text-right font-semibold">Lim. disponível</th>
                      <th className="px-4 py-3 text-right font-semibold">Vencidos</th>
                      <th className="px-4 py-3 text-right font-semibold">Performance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.risk.rows.map((row) => (
                      <tr className="border-b border-slate-100" key={`${row.code}-${row.cedentName}`}>
                        <td className="px-4 py-3 text-slate-700">
                          {row.commercial ?? "Não identificado"}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{row.code ?? "-"}</td>
                        <td className="px-4 py-3 font-medium text-slate-800">{row.cedentName}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(row.limitUsed)}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(row.limitAvailable)}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(row.overdueAmount)}</td>
                        <td className="px-4 py-3 text-right font-semibold">
                          {formatPercent(row.performance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-5 py-8 text-sm text-slate-500">
                Nenhuma planilha de risco importada para esta data.
              </p>
            )}
          </section>
        </div>
      ) : null}

      <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
        <h3 className="text-sm font-semibold text-slate-950">Últimas importações operacionais</h3>
        <div className="mt-4 grid gap-2">
          {data.imports.length ? (
            data.imports.map((item) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-200 px-3 py-2 text-sm"
                key={item.id}
              >
                <span className="font-medium text-slate-800">
                  {item.module} · {item.fundName ?? "Geral"}
                </span>
                <span className="text-slate-500">
                  {formatDateKey(item.referenceDate)} · {item.importedRows} linhas · {item.status}
                </span>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500">Nenhuma importação operacional registrada.</p>
          )}
        </div>
      </section>
    </div>
  );
}
