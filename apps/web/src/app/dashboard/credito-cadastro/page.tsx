import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock3,
  FileStack,
  Flag,
  RotateCcw,
  TimerReset,
  XCircle,
} from "lucide-react";
import { hasPermission } from "@/lib/permissions";
import {
  formatDuration,
  getCreditRegistrationDashboardData,
  type CreditStage,
  type CreditStatus,
  type PipelineDestination,
} from "./data";

type CreditRegistrationPageProps = {
  searchParams?: {
    comercialId?: string;
  };
};

const destinationLabels: Record<PipelineDestination, string> = {
  PRE_COMITE: "Pré-comitê",
  COMITE: "Comitê",
  FORMALIZACAO: "Formalização",
  APTOS: "Aptos",
  STAND_BY: "Stand-by",
  REJEITADOS: "Rejeitados",
};

const pipelineOrder: PipelineDestination[] = [
  "PRE_COMITE",
  "COMITE",
  "FORMALIZACAO",
  "APTOS",
  "STAND_BY",
  "REJEITADOS",
];

const stageLabels: Record<CreditStage, string> = {
  PRE_COMITE: "Pré-comitê",
  COMITE: "Comitê",
  FORMALIZACAO: "Formalização",
  APTOS: "Aptos",
};

const statusLabels: Record<CreditStatus, string> = {
  AGUARDANDO_PRE_COMITE: "Aguardando pré-comitê",
  VOLTAR_VISITA: "Voltar visita",
  REJEITADO: "Rejeitado",
  AGUARDANDO_COMITE: "Aguardando comitê",
  EM_FORMALIZACAO: "Em formalização",
  APROVADO: "Aprovado",
  NEGADO: "Negado",
  STAND_BY: "Stand-by",
};

const metricToneClasses = {
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  red: "border-red-200 bg-red-50 text-red-800",
  slate: "border-slate-200 bg-white text-slate-800",
  sky: "border-sky-200 bg-sky-50 text-sky-800",
} as const;

function percentage(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function formatDateOnly(value: Date | null) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(value);
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(value);
}

function getBrazilToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(`${byType.year}-${byType.month}-${byType.day}T00:00:00.000Z`);
}

function standByAlert(value: Date | null) {
  if (!value) {
    return {
      label: "Sem data",
      className: "border-slate-200 bg-slate-50 text-slate-700",
    };
  }
  const today = getBrazilToday();
  const nextSevenDays = new Date(today);
  nextSevenDays.setUTCDate(nextSevenDays.getUTCDate() + 7);

  if (value.getTime() < today.getTime()) {
    return { label: "Vencido", className: "border-red-200 bg-red-50 text-red-800" };
  }
  if (value.getTime() === today.getTime()) {
    return { label: "Hoje", className: "border-amber-200 bg-amber-50 text-amber-800" };
  }
  if (value.getTime() <= nextSevenDays.getTime()) {
    return {
      label: "Próximos 7 dias",
      className: "border-sky-200 bg-sky-50 text-sky-800",
    };
  }
  return { label: "Futuro", className: "border-slate-200 bg-white text-slate-700" };
}

function StatusBadge({ status }: { status: CreditStatus }) {
  const className =
    status === "APROVADO"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : status === "REJEITADO" || status === "NEGADO"
        ? "border-red-200 bg-red-50 text-red-800"
        : status === "STAND_BY"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : status === "VOLTAR_VISITA"
            ? "border-orange-200 bg-orange-50 text-orange-800"
            : "border-sky-200 bg-sky-50 text-sky-800";

  return (
    <span className={`inline-flex rounded border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {statusLabels[status]}
    </span>
  );
}

function StageBadge({ stage }: { stage: CreditStage }) {
  const className =
    stage === "APTOS"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : stage === "FORMALIZACAO"
        ? "border-indigo-200 bg-indigo-50 text-indigo-800"
        : stage === "COMITE"
          ? "border-sky-200 bg-sky-50 text-sky-800"
          : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <span className={`inline-flex rounded border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {stageLabels[stage]}
    </span>
  );
}

export default async function CreditRegistrationPage({
  searchParams,
}: CreditRegistrationPageProps) {
  if (!(await hasPermission("credit-registration.view"))) {
    return (
      <section className="rounded border border-slate-200 bg-white p-6 shadow-executive">
        <h2 className="text-lg font-semibold text-slate-950">Crédito&Cadastro</h2>
        <p className="mt-2 text-sm text-slate-500">
          Você não tem permissão para visualizar este dashboard.
        </p>
      </section>
    );
  }

  const data = await getCreditRegistrationDashboardData(searchParams?.comercialId);
  const counts = data.destinationCounts;
  const pipelineTotal = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const metrics = [
    { icon: FileStack, label: "Propostas", tone: "slate", value: data.overview.total },
    { icon: CircleDot, label: "Pré-comitê", tone: "sky", value: counts.PRE_COMITE },
    { icon: Clock3, label: "Comitê", tone: "sky", value: counts.COMITE },
    { icon: TimerReset, label: "Formalização", tone: "sky", value: counts.FORMALIZACAO },
    { icon: CheckCircle2, label: "Aptos", tone: "emerald", value: counts.APTOS },
    { icon: CheckCircle2, label: "Aprovadas", tone: "emerald", value: data.overview.aprovadas },
    { icon: XCircle, label: "Rejeitadas", tone: "red", value: counts.REJEITADOS },
    { icon: AlertTriangle, label: "Stand-by", tone: "amber", value: counts.STAND_BY },
    { icon: RotateCcw, label: "Voltar visita", tone: "amber", value: data.overview.voltar_visita },
  ] as const;
  const largestRegistrationTotal = Math.max(
    ...data.registrationsByCommercial.map((item) => item.total),
    0
  );
  const standByCards = [
    { label: "Vencidos", tone: "red", value: data.standBy.vencidos },
    { label: "Retorno hoje", tone: "amber", value: data.standBy.hoje },
    { label: "Próximos 7 dias", tone: "sky", value: data.standBy.proximos },
    { label: "Sem data", tone: "slate", value: data.standBy.sem_data },
  ] as const;

  return (
    <div className="space-y-6">
      <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-950">
              Visão executiva de Crédito&Cadastro
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Resultados consolidados da operação no ARAM. Esta visão é somente leitura.
            </p>
          </div>
          <form className="flex flex-wrap items-end gap-3" method="get">
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Comercial</span>
              <select
                className="h-10 min-w-72 rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                defaultValue={data.selectedCommercialId ?? ""}
                name="comercialId"
              >
                <option value="">Todos os comerciais</option>
                {data.commercials.map((commercial) => (
                  <option key={commercial.id} value={commercial.id}>
                    {commercial.nome} — {commercial.email}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="h-10 rounded bg-primary px-4 text-sm font-semibold text-primary-foreground"
              type="submit"
            >
              Filtrar
            </button>
            <Link
              className="inline-flex h-10 items-center rounded border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              href="/dashboard/credito-cadastro"
            >
              Limpar
            </Link>
          </form>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <Flag className="h-4 w-4 text-primary" />
          <h3 className="text-base font-semibold text-slate-950">Visão geral</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {metrics.map((item) => {
            const Icon = item.icon;
            return (
              <div
                className="rounded border border-slate-200 bg-white p-4 shadow-executive"
                key={item.label}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-slate-500">{item.label}</p>
                  <span
                    className={`rounded border p-1.5 ${
                      metricToneClasses[item.tone]
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                </div>
                <p className="mt-3 text-3xl font-semibold text-slate-950">{item.value}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="overflow-hidden rounded border border-slate-200 bg-white shadow-executive">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-950">Alertas de stand-by</h3>
          <p className="mt-1 text-sm text-slate-500">
            Retornos vencidos, de hoje e dos próximos sete dias.
          </p>
        </div>
        <div className="grid gap-3 border-b border-slate-200 p-5 sm:grid-cols-2 lg:grid-cols-4">
          {standByCards.map((item) => (
            <div
              className={`rounded border p-3 ${metricToneClasses[item.tone]}`}
              key={item.label}
            >
              <p className="text-xs">{item.label}</p>
              <p className="mt-1 text-2xl font-semibold">{item.value}</p>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Cadastro</th>
                <th className="px-4 py-3 font-semibold">Comercial</th>
                <th className="px-4 py-3 font-semibold">Retorno</th>
                <th className="px-4 py-3 font-semibold">Alerta</th>
                <th className="px-4 py-3 font-semibold">Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {data.standByAlerts.map((proposal) => {
                const alert = standByAlert(proposal.data_retorno);
                return (
                  <tr className="border-t border-slate-100" key={proposal.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{proposal.cedente_nome}</p>
                      <p className="text-xs text-slate-500">{proposal.cedente_documento}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{proposal.comercial_nome}</td>
                    <td className="px-4 py-3">{formatDateOnly(proposal.data_retorno)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded border px-2.5 py-1 text-xs font-semibold ${alert.className}`}
                      >
                        {alert.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {formatDateTime(proposal.atualizado_em)}
                    </td>
                  </tr>
                );
              })}
              {!data.standByAlerts.length ? (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={5}>
                    Nenhum stand-by vencido ou próximo do retorno.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white shadow-executive">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-950">Cadastros por comercial</h3>
        </div>
        <div className="space-y-4 p-5">
          {data.registrationsByCommercial.map((item) => {
            const width =
              largestRegistrationTotal > 0
                ? Math.max(8, Math.round((item.total / largestRegistrationTotal) * 100))
                : 0;
            return (
              <div
                className="grid gap-2 text-sm md:grid-cols-[220px_1fr_56px] md:items-center"
                key={item.comercial_id}
              >
                <div className="font-medium text-slate-800">{item.nome}</div>
                <div className="h-8 rounded bg-slate-100">
                  <div
                    className="flex h-8 items-center rounded bg-primary px-3 text-xs font-semibold text-primary-foreground"
                    style={{ width: `${width}%` }}
                  >
                    {item.total}
                  </div>
                </div>
                <div className="font-semibold md:text-right">{item.total}</div>
              </div>
            );
          })}
          {!data.registrationsByCommercial.length ? (
            <p className="text-sm text-slate-500">Nenhum cadastro encontrado.</p>
          ) : null}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.9fr_0.85fr_1.35fr]">
        <div className="rounded border border-slate-200 bg-white shadow-executive">
          <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="text-base font-semibold">Distribuição da esteira</h3>
          </div>
          <div className="space-y-4 p-4">
            {pipelineOrder.map((destination) => {
              const value = counts[destination];
              const width = percentage(value, pipelineTotal);
              return (
                <div key={destination}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium">{destinationLabels[destination]}</span>
                    <span className="text-slate-500">
                      {value} / {width}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full bg-primary"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded border border-slate-200 bg-white shadow-executive">
          <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="text-base font-semibold">Tempo médio por etapa</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {data.averageStageTimes.map((item) => (
              <div
                className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                key={item.destination}
              >
                <div>
                  <p className="font-medium">{destinationLabels[item.destination]}</p>
                  <p className="text-xs text-slate-500">
                    {item.occurrences} {item.occurrences === 1 ? "passagem" : "passagens"}
                  </p>
                </div>
                <p className="font-semibold">{formatDuration(item.averageMs)}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded border border-slate-200 bg-white shadow-executive">
          <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="text-base font-semibold">Métricas por comercial</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Comercial</th>
                  <th className="px-4 py-3 font-semibold">Total</th>
                  <th className="px-4 py-3 font-semibold">Aprovados</th>
                  <th className="px-4 py-3 font-semibold">Rejeitados</th>
                  <th className="px-4 py-3 font-semibold">Stand-by</th>
                  <th className="px-4 py-3 font-semibold">Voltar visita</th>
                </tr>
              </thead>
              <tbody>
                {data.commercialMetrics.map((row) => (
                  <tr className="border-t border-slate-100" key={row.comercial_id}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{row.comercial_nome}</p>
                      <p className="text-xs text-slate-500">{row.comercial_email}</p>
                    </td>
                    <td className="px-4 py-3">{row.total_enviados}</td>
                    <td className="px-4 py-3">{row.aprovados}</td>
                    <td className="px-4 py-3">{row.rejeitados}</td>
                    <td className="px-4 py-3">{row.stand_by}</td>
                    <td className="px-4 py-3">{row.voltar_visita}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded border border-slate-200 bg-white shadow-executive">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-950">Propostas recentes</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Cedente</th>
                <th className="px-4 py-3 font-semibold">CPF/CNPJ</th>
                <th className="px-4 py-3 font-semibold">Comercial</th>
                <th className="px-4 py-3 font-semibold">Etapa</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {data.recentProposals.map((proposal) => (
                <tr className="border-t border-slate-100" key={proposal.id}>
                  <td className="px-4 py-3 font-medium">{proposal.cedente_nome}</td>
                  <td className="px-4 py-3 text-slate-500">{proposal.cedente_documento}</td>
                  <td className="px-4 py-3 text-slate-600">{proposal.comercial_nome}</td>
                  <td className="px-4 py-3">
                    <StageBadge stage={proposal.etapa} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={proposal.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {formatDateTime(proposal.atualizado_em)}
                  </td>
                </tr>
              ))}
              {!data.recentProposals.length ? (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={6}>
                    Nenhuma proposta encontrada.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
