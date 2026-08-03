import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type CreditStage = "PRE_COMITE" | "COMITE" | "FORMALIZACAO" | "APTOS";
export type CreditStatus =
  | "AGUARDANDO_PRE_COMITE"
  | "VOLTAR_VISITA"
  | "REJEITADO"
  | "AGUARDANDO_COMITE"
  | "EM_FORMALIZACAO"
  | "APROVADO"
  | "NEGADO"
  | "STAND_BY";
export type PipelineDestination =
  | "PRE_COMITE"
  | "COMITE"
  | "FORMALIZACAO"
  | "APTOS"
  | "STAND_BY"
  | "REJEITADOS";

type CommercialRow = {
  id: string;
  nome: string;
  email: string;
};

type OverviewRow = {
  total: number;
  aprovadas: number;
  voltar_visita: number;
};

type ProposalTimingRow = {
  id: string;
  criado_em: Date;
  etapa: CreditStage;
  status: CreditStatus;
};

type HistoryTimingRow = {
  proposta_id: string;
  etapa: CreditStage;
  status_novo: CreditStatus;
  criado_em: Date;
};

type RecentProposalRow = {
  id: string;
  etapa: CreditStage;
  status: CreditStatus;
  atualizado_em: Date;
  cedente_nome: string;
  cedente_documento: string;
  comercial_nome: string;
};

type StandByOverviewRow = {
  vencidos: number;
  hoje: number;
  proximos: number;
  sem_data: number;
};

type StandByAlertRow = {
  id: string;
  data_retorno: Date | null;
  atualizado_em: Date;
  cedente_nome: string;
  cedente_documento: string;
  comercial_nome: string;
};

type RegistrationByCommercialRow = {
  comercial_id: string;
  nome: string;
  total: number;
};

export type CommercialMetricsRow = {
  comercial_id: string;
  comercial_nome: string;
  comercial_email: string;
  total_enviados: number;
  aprovados: number;
  rejeitados: number;
  stand_by: number;
  voltar_visita: number;
};

export type AverageStageTime = {
  destination: PipelineDestination;
  occurrences: number;
  averageMs: number | null;
};

export type CreditRegistrationDashboardData = {
  commercials: CommercialRow[];
  selectedCommercialId: string | null;
  overview: OverviewRow;
  destinationCounts: Record<PipelineDestination, number>;
  standBy: StandByOverviewRow;
  standByAlerts: StandByAlertRow[];
  registrationsByCommercial: RegistrationByCommercialRow[];
  commercialMetrics: CommercialMetricsRow[];
  averageStageTimes: AverageStageTime[];
  recentProposals: RecentProposalRow[];
};

const destinationOrder: PipelineDestination[] = [
  "PRE_COMITE",
  "COMITE",
  "FORMALIZACAO",
  "APTOS",
  "STAND_BY",
  "REJEITADOS",
];

function dateOnlyFromBrazilOffset(daysToAdd = 0) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = new Date(`${byType.year}-${byType.month}-${byType.day}T00:00:00.000Z`);

  date.setUTCDate(date.getUTCDate() + daysToAdd);
  return date;
}

export function getProposalDestination(input: {
  etapa: CreditStage;
  status: CreditStatus;
}): PipelineDestination {
  if (input.status === "STAND_BY") {
    return "STAND_BY";
  }
  if (input.status === "REJEITADO" || input.status === "NEGADO") {
    return "REJEITADOS";
  }
  if (input.etapa === "APTOS" || input.status === "APROVADO") {
    return "APTOS";
  }
  if (input.etapa === "FORMALIZACAO" || input.status === "EM_FORMALIZACAO") {
    return "FORMALIZACAO";
  }
  if (input.etapa === "COMITE" || input.status === "AGUARDANDO_COMITE") {
    return "COMITE";
  }
  return "PRE_COMITE";
}

function calculateAverageStageTimes(
  proposals: ProposalTimingRow[],
  histories: HistoryTimingRow[],
  now: Date
): AverageStageTime[] {
  const historiesByProposal = new Map<string, HistoryTimingRow[]>();
  histories.forEach((history) => {
    const current = historiesByProposal.get(history.proposta_id) ?? [];
    current.push(history);
    historiesByProposal.set(history.proposta_id, current);
  });

  const totals = new Map(
    destinationOrder.map((destination) => [
      destination,
      { totalMs: 0, occurrences: 0 },
    ])
  );

  proposals.forEach((proposal) => {
    const timeline = (historiesByProposal.get(proposal.id) ?? []).sort(
      (a, b) => a.criado_em.getTime() - b.criado_em.getTime()
    );

    if (!timeline.length) {
      const destination = getProposalDestination(proposal);
      const current = totals.get(destination);
      if (current) {
        current.totalMs += Math.max(0, now.getTime() - proposal.criado_em.getTime());
        current.occurrences += 1;
      }
      return;
    }

    timeline.forEach((history, index) => {
      const destination = getProposalDestination({
        etapa: history.etapa,
        status: history.status_novo,
      });
      const current = totals.get(destination);
      if (!current) {
        return;
      }
      const end = timeline[index + 1]?.criado_em ?? now;
      current.totalMs += Math.max(0, end.getTime() - history.criado_em.getTime());
      current.occurrences += 1;
    });
  });

  return destinationOrder.map((destination) => {
    const current = totals.get(destination) ?? { totalMs: 0, occurrences: 0 };
    return {
      destination,
      occurrences: current.occurrences,
      averageMs:
        current.occurrences > 0 ? current.totalMs / current.occurrences : null,
    };
  });
}

export function formatDuration(ms: number | null) {
  if (ms === null) {
    return "-";
  }
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (totalHours > 0) {
    return minutes > 0 ? `${totalHours}h ${minutes}min` : `${totalHours}h`;
  }
  return `${Math.max(1, minutes)}min`;
}

export async function getCreditRegistrationDashboardData(
  requestedCommercialId?: string
): Promise<CreditRegistrationDashboardData> {
  const commercials = await prisma.$queryRaw<CommercialRow[]>(Prisma.sql`
    SELECT id::text, nome, email
    FROM "ARAM"."usuarios"
    WHERE papel::text = 'COMERCIAL' AND ativo = true
    ORDER BY nome ASC
  `);
  const selectedCommercialId =
    commercials.find((commercial) => commercial.id === requestedCommercialId)?.id ?? null;
  const proposalFilter = selectedCommercialId
    ? Prisma.sql`WHERE p.comercial_id = ${selectedCommercialId}::uuid`
    : Prisma.empty;
  const proposalAndFilter = selectedCommercialId
    ? Prisma.sql`AND p.comercial_id = ${selectedCommercialId}::uuid`
    : Prisma.empty;
  const commercialFilter = selectedCommercialId
    ? Prisma.sql`WHERE u.id = ${selectedCommercialId}::uuid`
    : Prisma.empty;
  const metricsFilter = selectedCommercialId
    ? Prisma.sql`WHERE comercial_id = ${selectedCommercialId}::uuid`
    : Prisma.empty;
  const today = dateOnlyFromBrazilOffset();
  const tomorrow = dateOnlyFromBrazilOffset(1);
  const nextSevenDays = dateOnlyFromBrazilOffset(7);

  const [
    overviewRows,
    proposals,
    histories,
    recentProposals,
    standByRows,
    standByAlerts,
    registrationsByCommercial,
    commercialMetrics,
  ] = await Promise.all([
    prisma.$queryRaw<OverviewRow[]>(Prisma.sql`
      SELECT
        COUNT(*)::integer AS total,
        (COUNT(*) FILTER (WHERE p.status::text = 'APROVADO'))::integer AS aprovadas,
        (COUNT(*) FILTER (WHERE p.status::text = 'VOLTAR_VISITA'))::integer AS voltar_visita
      FROM "ARAM"."propostas" p
      ${proposalFilter}
    `),
    prisma.$queryRaw<ProposalTimingRow[]>(Prisma.sql`
      SELECT
        p.id::text,
        p.criado_em,
        p.etapa::text AS etapa,
        p.status::text AS status
      FROM "ARAM"."propostas" p
      ${proposalFilter}
    `),
    prisma.$queryRaw<HistoryTimingRow[]>(Prisma.sql`
      SELECT
        h.proposta_id::text,
        h.etapa::text AS etapa,
        h.status_novo::text AS status_novo,
        h.criado_em
      FROM "ARAM"."historico_status" h
      INNER JOIN "ARAM"."propostas" p ON p.id = h.proposta_id
      ${proposalFilter}
      ORDER BY h.criado_em ASC
    `),
    prisma.$queryRaw<RecentProposalRow[]>(Prisma.sql`
      SELECT
        p.id::text,
        p.etapa::text AS etapa,
        p.status::text AS status,
        p.atualizado_em,
        c.razao_social AS cedente_nome,
        c.cpf_cnpj AS cedente_documento,
        u.nome AS comercial_nome
      FROM "ARAM"."propostas" p
      INNER JOIN "ARAM"."cedentes" c ON c.id = p.cedente_id
      INNER JOIN "ARAM"."usuarios" u ON u.id = p.comercial_id
      ${proposalFilter}
      ORDER BY p.atualizado_em DESC
      LIMIT 8
    `),
    prisma.$queryRaw<StandByOverviewRow[]>(Prisma.sql`
      SELECT
        (COUNT(*) FILTER (
          WHERE p.status::text = 'STAND_BY' AND p.data_retorno_standby < ${today}
        ))::integer AS vencidos,
        (COUNT(*) FILTER (
          WHERE p.status::text = 'STAND_BY' AND p.data_retorno_standby = ${today}
        ))::integer AS hoje,
        (COUNT(*) FILTER (
          WHERE p.status::text = 'STAND_BY'
            AND p.data_retorno_standby >= ${tomorrow}
            AND p.data_retorno_standby <= ${nextSevenDays}
        ))::integer AS proximos,
        (COUNT(*) FILTER (
          WHERE p.status::text = 'STAND_BY' AND p.data_retorno_standby IS NULL
        ))::integer AS sem_data
      FROM "ARAM"."propostas" p
      ${proposalFilter}
    `),
    prisma.$queryRaw<StandByAlertRow[]>(Prisma.sql`
      SELECT
        p.id::text,
        p.data_retorno_standby AS data_retorno,
        p.atualizado_em,
        c.razao_social AS cedente_nome,
        c.cpf_cnpj AS cedente_documento,
        u.nome AS comercial_nome
      FROM "ARAM"."propostas" p
      INNER JOIN "ARAM"."cedentes" c ON c.id = p.cedente_id
      INNER JOIN "ARAM"."usuarios" u ON u.id = p.comercial_id
      WHERE p.status::text = 'STAND_BY'
        ${proposalAndFilter}
        AND (
          p.data_retorno_standby <= ${nextSevenDays}
          OR p.data_retorno_standby IS NULL
        )
      ORDER BY p.data_retorno_standby ASC NULLS LAST, p.atualizado_em DESC
      LIMIT 8
    `),
    prisma.$queryRaw<RegistrationByCommercialRow[]>(Prisma.sql`
      SELECT
        u.id::text AS comercial_id,
        u.nome,
        COUNT(c.id)::integer AS total
      FROM "ARAM"."cedentes" c
      INNER JOIN "ARAM"."usuarios" u ON u.id = c.criado_por
      ${commercialFilter}
      GROUP BY u.id, u.nome
      ORDER BY total DESC, u.nome ASC
    `),
    prisma.$queryRaw<CommercialMetricsRow[]>(Prisma.sql`
      SELECT
        comercial_id::text,
        comercial_nome,
        comercial_email,
        total_enviados,
        aprovados,
        rejeitados,
        stand_by,
        voltar_visita
      FROM "ARAM"."vw_metricas_comercial"
      ${metricsFilter}
      ORDER BY total_enviados DESC, comercial_nome ASC
    `),
  ]);

  const destinationCounts = proposals.reduce(
    (counts, proposal) => {
      counts[getProposalDestination(proposal)] += 1;
      return counts;
    },
    {
      APTOS: 0,
      COMITE: 0,
      FORMALIZACAO: 0,
      PRE_COMITE: 0,
      REJEITADOS: 0,
      STAND_BY: 0,
    } satisfies Record<PipelineDestination, number>
  );

  return {
    commercials,
    selectedCommercialId,
    overview: overviewRows[0] ?? { total: 0, aprovadas: 0, voltar_visita: 0 },
    destinationCounts,
    standBy: standByRows[0] ?? { vencidos: 0, hoje: 0, proximos: 0, sem_data: 0 },
    standByAlerts,
    registrationsByCommercial,
    commercialMetrics,
    averageStageTimes: calculateAverageStageTimes(proposals, histories, new Date()),
    recentProposals,
  };
}
