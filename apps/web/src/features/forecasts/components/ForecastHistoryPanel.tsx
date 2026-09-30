"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock3, Copy, Loader2, RotateCcw } from "lucide-react";
import type {
  ForecastHistoryEntry,
  ForecastHistoryTitle,
} from "@/features/forecasts/forecast-history-types";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T00:00:00.000Z`));
}

const statusPresentation = {
  PENDING: { label: "Pendente de execução", className: "bg-slate-100 text-slate-700" },
  AWAITING_MOVEMENT: { label: "Aguardando movimentos em aberto", className: "bg-amber-100 text-amber-800" },
  IN_OPEN_MOVEMENT: { label: "Em movimentos abertos", className: "bg-blue-100 text-blue-800" },
  AWAITING_STOCK: { label: "Aguardando estoque", className: "bg-amber-100 text-amber-800" },
  STOCK_CONFIRMED: { label: "Liquidada no estoque", className: "bg-emerald-100 text-emerald-800" },
  DIVERGENT: { label: "Divergência: ainda no estoque", className: "bg-red-100 text-red-800" },
} as const;

function totals(titles: ForecastHistoryTitle[]) {
  return titles.reduce(
    (result, title) => {
      const reversal = Number(title.reversalAmount);
      result.planned += reversal;
      if (title.executedAt) result.executed += reversal;
      if (title.status === "STOCK_CONFIRMED") result.confirmed += reversal;
      return result;
    },
    { planned: 0, executed: 0, confirmed: 0 }
  );
}

export function ForecastHistoryPanel({
  history,
  onUseAsBase,
}: {
  history: ForecastHistoryEntry[];
  onUseAsBase: (forecast: ForecastHistoryEntry) => void;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(history[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const selected = history.find((forecast) => forecast.id === selectedId) ?? history[0];

  useEffect(() => {
    const active = history.find((forecast) => forecast.isActive);
    const current = history.find((forecast) => forecast.id === selectedId);
    if (active && (!current || (!current.isActive && active.createdAt > current.createdAt))) {
      setSelectedId(active.id);
    }
  }, [history, selectedId]);

  const groupedTitles = useMemo(() => {
    const groups = new Map<string, ForecastHistoryTitle[]>();
    selected?.titles.forEach((title) => {
      const current = groups.get(title.plannedExecutionDate) ?? [];
      current.push(title);
      groups.set(title.plannedExecutionDate, current);
    });
    return Array.from(groups.entries());
  }, [selected]);

  async function updateExecution(
    forecastId: string,
    itemIds: string[],
    action: "EXECUTE" | "UNDO"
  ) {
    setPending(true);
    setFeedback("");
    try {
      const response = await fetch(`/api/previsoes/${forecastId}/execution`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, itemIds }),
      });
      const payload = await response.json();
      setFeedback(payload.message ?? "Operação concluída.");
      if (payload.ok) router.refresh();
    } catch {
      setFeedback("Não foi possível atualizar o checklist.");
    } finally {
      setPending(false);
    }
  }

  if (!history.length) {
    return (
      <section className="rounded border border-dashed border-slate-300 bg-white p-6">
        <h2 className="font-semibold text-slate-950">Histórico de previsões</h2>
        <p className="mt-2 text-sm text-slate-500">
          Nenhuma previsão foi gravada para este fundo.
        </p>
      </section>
    );
  }

  const summary = totals(selected?.titles ?? []);

  return (
    <section className="rounded border border-slate-200 bg-white shadow-executive">
      <div className="flex flex-col gap-4 border-b border-slate-200 p-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Histórico de previsões</h2>
          <p className="mt-1 text-sm text-slate-500">
            Acompanhe execução, passagem por movimentos em aberto e liquidação no estoque.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm font-medium text-slate-700">
            <span className="block text-xs uppercase text-slate-500">Previsão</span>
            <select
              className="h-10 min-w-[260px] rounded border border-slate-200 bg-white px-3"
              onChange={(event) => setSelectedId(event.target.value)}
              value={selected?.id}
            >
              {history.map((forecast) => (
                <option key={forecast.id} value={forecast.id}>
                  {forecast.name}{forecast.isActive ? " · ativa" : ""}
                </option>
              ))}
            </select>
          </label>
          {selected ? (
            <button
              className="inline-flex h-10 items-center gap-2 rounded border border-slate-300 px-4 text-sm font-semibold disabled:opacity-50"
              disabled={pending}
              onClick={() => onUseAsBase(selected)}
              type="button"
            >
              <Copy className="h-4 w-4" />
              Usar como base da nova versão
            </button>
          ) : null}
        </div>
      </div>

      {selected ? (
        <div className="space-y-5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-slate-600">
              Criada por <strong>{selected.createdByName}</strong> em{" "}
              {new Date(selected.createdAt).toLocaleString("pt-BR")}
            </p>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${selected.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
              {selected.isActive ? "Previsão ativa" : "Versão histórica"}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Reversão prevista", summary.planned, "text-slate-950"],
              ["Baixas executadas", summary.executed, "text-blue-700"],
              ["Confirmada no estoque", summary.confirmed, "text-emerald-700"],
            ].map(([label, value, color]) => (
              <div className="rounded border border-slate-200 p-4" key={String(label)}>
                <p className="text-xs uppercase text-slate-500">{label}</p>
                <p className={`mt-1 text-lg font-semibold ${color}`}>{money.format(Number(value))}</p>
              </div>
            ))}
          </div>

          {feedback ? <p className="rounded bg-slate-50 px-3 py-2 text-sm text-slate-700">{feedback}</p> : null}

          {groupedTitles.length ? groupedTitles.map(([executionDate, titles]) => {
            const pendingIds = titles.filter((title) => title.status === "PENDING").map((title) => title.id);
            const dayTotals = totals(titles);
            return (
              <div className="overflow-hidden rounded border border-slate-200" key={executionDate}>
                <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-4 py-3">
                  <div>
                    <p className="font-semibold text-slate-950">Execução prevista em {formatDate(executionDate)}</p>
                    <p className="text-xs text-slate-500">
                      {titles.length} título(s) · prevista {money.format(dayTotals.planned)} · executada {money.format(dayTotals.executed)} · estoque {money.format(dayTotals.confirmed)}
                    </p>
                  </div>
                  {selected.isActive && pendingIds.length ? (
                    <button
                      className="inline-flex h-9 items-center gap-2 rounded bg-primary px-3 text-sm font-semibold text-white disabled:opacity-50"
                      disabled={pending}
                      onClick={() => void updateExecution(selected.id, pendingIds, "EXECUTE")}
                      type="button"
                    >
                      <CheckCircle2 className="h-4 w-4" />Confirmar todas do dia
                    </button>
                  ) : null}
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-[1100px] border-collapse text-sm">
                    <thead><tr className="border-y border-slate-200 text-xs uppercase text-slate-500">
                      <th className="px-4 py-3 text-left">Título</th><th className="px-4 py-3 text-left">Cedente / sacado</th><th className="px-4 py-3 text-left">Fluxo</th><th className="px-4 py-3 text-left">Impacto</th><th className="px-4 py-3 text-right">Reversão</th><th className="px-4 py-3 text-left">Situação</th><th className="px-4 py-3 text-right">Ação</th>
                    </tr></thead>
                    <tbody>{titles.map((title) => {
                      const presentation = statusPresentation[title.status];
                      return <tr className="border-b border-slate-100 last:border-0" key={title.id}>
                        <td className="px-4 py-3"><p className="font-semibold">{title.documentNumber}</p><p className="text-xs text-slate-500">Venc. {formatDate(title.originalDueDate)}</p></td>
                        <td className="px-4 py-3"><p>{title.cedentName}</p><p className="text-xs text-slate-500">{title.debtorName}</p></td>
                        <td className="px-4 py-3">{title.settlementMode === "D0" ? "D0" : "Normal (D+1 útil)"}</td>
                        <td className="px-4 py-3">{formatDate(title.actualImpactDate ?? title.plannedImpactDate)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-emerald-700">{money.format(Number(title.reversalAmount))}</td>
                        <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${presentation.className}`}>{presentation.label}</span>{title.openMovementReferenceDate ? <p className="mt-1 text-xs text-slate-500">Movimento {formatDate(title.openMovementReferenceDate)} · {title.openMovementPeriod}</p> : null}{title.executedByName ? <p className="mt-1 text-xs text-slate-500">Por {title.executedByName}</p> : null}</td>
                        <td className="px-4 py-3 text-right">{selected.isActive && title.status === "PENDING" ? <button className="inline-flex h-8 items-center gap-1 rounded border border-emerald-200 px-2 font-semibold text-emerald-700" disabled={pending} onClick={() => void updateExecution(selected.id, [title.id], "EXECUTE")} type="button"><CheckCircle2 className="h-3.5 w-3.5" />Confirmar</button> : selected.isActive && title.status !== "STOCK_CONFIRMED" ? <button className="inline-flex h-8 items-center gap-1 rounded border border-slate-300 px-2 font-semibold text-slate-600" disabled={pending} onClick={() => void updateExecution(selected.id, [title.id], "UNDO")} type="button"><RotateCcw className="h-3.5 w-3.5" />Desfazer</button> : <Clock3 className="ml-auto h-4 w-4 text-slate-300" />}</td>
                      </tr>;
                    })}</tbody>
                  </table>
                </div>
              </div>
            );
          }) : <p className="rounded border border-dashed border-slate-200 p-5 text-sm text-slate-500">Esta previsão não possui baixas planejadas.</p>}
        </div>
      ) : null}
    </section>
  );
}
