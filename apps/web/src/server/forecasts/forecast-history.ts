import {
  Prisma,
  type ForecastExecutionStatus,
  type ForecastSettlementMode,
} from "@prisma/client";
import { z } from "zod";
import {
  expectedOpenMovementSnapshot,
  forecastImpactDate,
  resolveForecastItemStatus,
  saoPauloDateAndHour,
  titleMatchesEvidence,
} from "@/features/forecasts/forecast-execution";
import type {
  CreateForecastInput,
  ForecastActionResult,
  ForecastHistoryEntry,
} from "@/features/forecasts/forecast-history-types";
import { fundListWhere } from "@/lib/fund-modules";
import { prisma } from "@/lib/prisma";

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const finiteNumber = z.number().finite();
const projectionSchema = z.object({
  date: dateKeySchema,
  pddTurnover: finiteNumber,
  pddReversal: finiteNumber,
  pddNet: finiteNumber,
  manualPddDelta: finiteNumber,
  creditRightsRevenue: finiteNumber,
  fundCost: finiteNumber,
  creditRights: finiteNumber,
  pdd: finiteNumber,
  patrimonio: finiteNumber,
  dailyReturn: finiteNumber,
  monthlyReturn: finiteNumber,
  yearlyReturn: finiteNumber,
});
const createForecastSchema = z.object({
  fundId: z.string().min(1),
  name: z.string().trim().min(3).max(120),
  periodEnd: dateKeySchema,
  sourceForecastId: z.string().min(1).optional(),
  stockReferenceDate: dateKeySchema,
  stockFundName: z.string().trim().min(1),
  titles: z
    .array(
      z.object({
        sourceStockId: z.string().uuid(),
        plannedExecutionDate: dateKeySchema,
        settlementMode: z.enum(["D0", "NEXT_BUSINESS_DAY"]),
        reversalAmount: finiteNumber.nonnegative(),
      })
    ),
  projections: z.array(projectionSchema).min(1),
});

function parseDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateKey(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? null;
}

function decimal(value: number) {
  return new Prisma.Decimal(value.toFixed(10));
}

function movementIsAtOrAfter(
  referenceDate: string,
  period: string,
  expectedDate: string,
  expectedPeriod: string
) {
  if (referenceDate !== expectedDate) return referenceDate > expectedDate;
  return expectedPeriod === "MANHA" || period === "TARDE";
}

type EvidenceForecast = Prisma.ForecastGetPayload<{
  include: { titles: true };
}>;

async function reconcileForecast(forecast: EvidenceForecast) {
  const pendingEvidence = forecast.titles.filter(
    (item) =>
      item.executedAt &&
      item.actualImpactDate &&
      item.status !== "STOCK_CONFIRMED"
  );
  if (!pendingEvidence.length) return;

  const expectedMovements = pendingEvidence.map((item) => ({
    item,
    expected: expectedOpenMovementSnapshot(item.executedAt!),
  }));
  const minimumMovementDate = expectedMovements.reduce(
    (minimum, entry) =>
      entry.expected.referenceDate < minimum
        ? entry.expected.referenceDate
        : minimum,
    expectedMovements[0]!.expected.referenceDate
  );
  const latestStock = await prisma.fidcEstoque.findFirst({
    where: { nomeFundo: forecast.stockFundName },
    orderBy: { dataReferencia: "desc" },
    select: { dataReferencia: true },
  });
  const [movementCandidates, latestStockTitles] = await Promise.all([
    prisma.fidcMovimentoAberto.findMany({
      where: {
        dataReferencia: { gte: parseDate(minimumMovementDate) },
        nomeFundo: forecast.stockFundName,
      },
      orderBy: [{ dataReferencia: "asc" }, { periodo: "asc" }],
      select: {
        createdAt: true,
        dataReferencia: true,
        dataVencimento: true,
        numeroDocumento: true,
        periodo: true,
        seuNumero: true,
        valorNominal: true,
      },
    }),
    latestStock
      ? prisma.fidcEstoque.findMany({
          where: {
            dataReferencia: latestStock.dataReferencia,
            nomeFundo: forecast.stockFundName,
          },
          select: {
            dataVencimentoOriginal: true,
            numeroDocumento: true,
            seuNumero: true,
            valorNominal: true,
          },
        })
      : Promise.resolve([]),
  ]);

  for (const { item, expected } of expectedMovements) {
    const movement = item.openMovementObservedAt
      ? null
      : movementCandidates.find((candidate) => {
          const candidateDate = dateKey(candidate.dataReferencia)!;
          return (
            movementIsAtOrAfter(
              candidateDate,
              candidate.periodo,
              expected.referenceDate,
              expected.period
            ) &&
            titleMatchesEvidence(
              {
                documentNumber: item.documentNumber,
                dueDate: dateKey(item.originalDueDate)!,
                nominalValue: Number(item.nominalValue),
                yourNumber: item.yourNumber,
              },
              {
                documentNumber: candidate.numeroDocumento,
                dueDate: dateKey(candidate.dataVencimento)!,
                nominalValue: Number(candidate.valorNominal),
                yourNumber: candidate.seuNumero,
              }
            )
          );
        }) ?? null;
    const stockSnapshot =
      latestStock && latestStock.dataReferencia >= item.actualImpactDate!
        ? latestStock
        : null;
    let status: ForecastExecutionStatus = item.status;

    if (stockSnapshot) {
      const foundInStock = latestStockTitles.some((candidate) =>
        titleMatchesEvidence(
          {
            documentNumber: item.documentNumber,
            dueDate: dateKey(item.originalDueDate) ?? "",
            nominalValue: Number(item.nominalValue),
            yourNumber: item.yourNumber,
          },
          {
            documentNumber: candidate.numeroDocumento,
            dueDate: dateKey(candidate.dataVencimentoOriginal) ?? "",
            nominalValue: Number(candidate.valorNominal),
            yourNumber: candidate.seuNumero,
          }
        )
      );
      status = foundInStock ? "DIVERGENT" : "STOCK_CONFIRMED";
    } else {
      status = "EXECUTED";
    }

    const evidenceData = movement
      ? {
          openMovementObservedAt: movement.createdAt,
          openMovementPeriod: movement.periodo,
          openMovementReferenceDate: movement.dataReferencia,
        }
      : {};
    const changed =
      status !== item.status ||
      Boolean(movement) ||
      dateKey(stockSnapshot?.dataReferencia ?? null) !==
        dateKey(item.checkedStockReferenceDate);

    if (!changed) continue;

    await prisma.forecastTitle.update({
      where: { id: item.id },
      data: {
        ...evidenceData,
        checkedStockReferenceDate: stockSnapshot?.dataReferencia ?? null,
        status,
        stockConfirmedAt:
          status === "STOCK_CONFIRMED" ? item.stockConfirmedAt ?? new Date() : null,
      },
    });
  }
}

export async function refreshForecastEvidenceForFund(fundId: string) {
  const forecasts = await prisma.forecast.findMany({
    where: { fundId, isActive: true },
    include: { titles: true },
  });

  for (const forecast of forecasts) await reconcileForecast(forecast);
}

export async function createForecast(
  rawInput: CreateForecastInput,
  userId: string
): Promise<ForecastActionResult> {
  const parsed = createForecastSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, message: "Revise os dados da previsão antes de gravar." };
  }
  const input = parsed.data;
  const sourceIds = input.titles.map((title) => title.sourceStockId);
  if (new Set(sourceIds).size !== sourceIds.length) {
    return { ok: false, message: "A previsão possui títulos repetidos." };
  }

  const [fund, stockRows, stockSnapshot, sourceForecast] = await Promise.all([
    prisma.fund.findFirst({
      where: { id: input.fundId, ...fundListWhere("FORECASTS") },
      select: { id: true },
    }),
    prisma.fidcEstoque.findMany({
      where: {
        id: { in: sourceIds },
        dataReferencia: parseDate(input.stockReferenceDate),
      },
    }),
    prisma.fidcEstoque.findFirst({
      where: {
        dataReferencia: parseDate(input.stockReferenceDate),
        nomeFundo: input.stockFundName,
      },
      select: { id: true },
    }),
    input.sourceForecastId
      ? prisma.forecast.findUnique({
          where: { id: input.sourceForecastId },
          include: { titles: true },
        })
      : Promise.resolve(null),
  ]);
  if (!fund || !stockSnapshot || stockRows.length !== sourceIds.length) {
    return {
      ok: false,
      message: "O estoque mudou ou algum título não está mais disponível. Atualize a página.",
    };
  }
  if (input.sourceForecastId && !sourceForecast) {
    return { ok: false, message: "A versão-base não foi encontrada." };
  }
  const stockFundNames = new Set(stockRows.map((row) => row.nomeFundo));
  if (
    stockFundNames.size > 1 ||
    (stockFundNames.size === 1 && !stockFundNames.has(input.stockFundName))
  ) {
    return { ok: false, message: "Os títulos selecionados pertencem a estoques diferentes." };
  }
  if (sourceForecast && sourceForecast.fundId !== input.fundId) {
    return { ok: false, message: "A versão-base pertence a outro fundo." };
  }
  const titleInputById = new Map(
    input.titles.map((title) => [title.sourceStockId, title])
  );
  const periodEnd = parseDate(input.periodEnd);

  try {
    const forecast = await prisma.$transaction(async (tx) => {
      const latest = await tx.forecast.aggregate({
        where: { fundId: input.fundId, periodEnd },
        _max: { version: true },
      });
      const version = (latest._max.version ?? 0) + 1;
      await tx.forecast.updateMany({
        where: { fundId: input.fundId, isActive: true },
        data: { isActive: false },
      });
      const created = await tx.forecast.create({
        data: {
          createdByUserId: userId,
          fundId: input.fundId,
          isActive: true,
          name: input.name,
          periodEnd,
          sourceForecastId: sourceForecast?.id ?? null,
          stockFundName: input.stockFundName,
          stockReferenceDate: parseDate(input.stockReferenceDate),
          version,
          dailyProjections: {
            create: input.projections.map((row) => ({
              projectionDate: parseDate(row.date),
              pddTurnover: decimal(row.pddTurnover),
              pddReversal: decimal(row.pddReversal),
              pddNet: decimal(row.pddNet),
              manualPddDelta: decimal(row.manualPddDelta),
              creditRightsRevenue: decimal(row.creditRightsRevenue),
              fundCost: decimal(row.fundCost),
              creditRights: decimal(row.creditRights),
              pdd: decimal(row.pdd),
              patrimonio: decimal(row.patrimonio),
              dailyReturn: decimal(row.dailyReturn),
              monthlyReturn: decimal(row.monthlyReturn),
              yearlyReturn: decimal(row.yearlyReturn),
            })),
          },
          titles: {
            create: [
              ...stockRows.map((row) => {
              const selected = titleInputById.get(row.id)!;
              const inherited = sourceForecast?.titles.find((sourceTitle) =>
                titleMatchesEvidence(
                  {
                    documentNumber: row.numeroDocumento,
                    dueDate: dateKey(row.dataVencimentoOriginal)!,
                    nominalValue: Number(row.valorNominal),
                    yourNumber: row.seuNumero,
                  },
                  {
                    documentNumber: sourceTitle.documentNumber,
                    dueDate: dateKey(sourceTitle.originalDueDate)!,
                    nominalValue: Number(sourceTitle.nominalValue),
                    yourNumber: sourceTitle.yourNumber,
                  }
                )
              );
              return {
                sourceStockId: row.id,
                cedentName: row.nomeCedente,
                cedentDocument: row.docCedente,
                debtorName: row.nomeSacado,
                debtorDocument: row.docSacado,
                documentNumber: row.numeroDocumento,
                yourNumber: row.seuNumero,
                originalDueDate: row.dataVencimentoOriginal,
                nominalValue: row.valorNominal,
                presentValue: row.valorPresente,
                pddValue: row.valorPdd,
                reversalAmount: decimal(selected.reversalAmount),
                settlementMode: selected.settlementMode,
                plannedExecutionDate: parseDate(selected.plannedExecutionDate),
                plannedImpactDate: parseDate(
                  forecastImpactDate(
                    selected.plannedExecutionDate,
                    selected.settlementMode
                  )
                ),
                ...(inherited && inherited.status !== "PENDING"
                  ? {
                      actualExecutionDate: inherited.actualExecutionDate,
                      actualImpactDate: inherited.actualImpactDate,
                      checkedStockReferenceDate: inherited.checkedStockReferenceDate,
                      executedAt: inherited.executedAt,
                      executedByUserId: inherited.executedByUserId,
                      openMovementObservedAt: inherited.openMovementObservedAt,
                      openMovementPeriod: inherited.openMovementPeriod,
                      openMovementReferenceDate: inherited.openMovementReferenceDate,
                      status: inherited.status,
                      stockConfirmedAt: inherited.stockConfirmedAt,
                    }
                  : {}),
              };
              }),
              ...(sourceForecast?.titles
                .filter(
                  (sourceTitle) =>
                    sourceTitle.status !== "PENDING" &&
                    !stockRows.some((row) =>
                      titleMatchesEvidence(
                        {
                          documentNumber: row.numeroDocumento,
                          dueDate: dateKey(row.dataVencimentoOriginal)!,
                          nominalValue: Number(row.valorNominal),
                          yourNumber: row.seuNumero,
                        },
                        {
                          documentNumber: sourceTitle.documentNumber,
                          dueDate: dateKey(sourceTitle.originalDueDate)!,
                          nominalValue: Number(sourceTitle.nominalValue),
                          yourNumber: sourceTitle.yourNumber,
                        }
                      )
                    )
                )
                .map(({ id, forecastId, createdAt, updatedAt, ...sourceTitle }) => sourceTitle) ?? []),
            ],
          },
        },
      });
      await tx.auditLog.create({
        data: {
          action: "FORECAST_CREATED",
          entity: "Forecast",
          entityId: created.id,
          metadata: { name: input.name, version },
          userId,
        },
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return { ok: true, message: "Previsão gravada com sucesso.", forecastId: forecast.id };
  } catch {
    return { ok: false, message: "Não foi possível gravar a previsão. Tente novamente." };
  }
}

export async function setForecastItemsExecuted(input: {
  action: "EXECUTE" | "UNDO";
  forecastId: string;
  itemIds: string[];
  userId: string;
}): Promise<ForecastActionResult> {
  if (!input.itemIds.length) return { ok: false, message: "Selecione ao menos um título." };
  const forecast = await prisma.forecast.findFirst({
    where: { id: input.forecastId, isActive: true },
    select: { id: true },
  });
  if (!forecast) return { ok: false, message: "Somente a previsão ativa pode ser alterada." };

  const now = new Date();
  const actualExecutionDate = saoPauloDateAndHour(now).date;
  const items = await prisma.forecastTitle.findMany({
    where: { forecastId: input.forecastId, id: { in: input.itemIds } },
    select: { id: true, settlementMode: true, status: true },
  });
  const eligible = items.filter((item) =>
    input.action === "EXECUTE"
      ? item.status === "PENDING"
      : item.status !== "PENDING" && item.status !== "STOCK_CONFIRMED"
  );
  if (!eligible.length) {
    return { ok: false, message: "Nenhum título selecionado pode receber essa ação." };
  }

  await prisma.$transaction(async (tx) => {
    for (const item of eligible) {
      await tx.forecastTitle.update({
        where: { id: item.id },
        data:
          input.action === "EXECUTE"
            ? {
                actualExecutionDate: parseDate(actualExecutionDate),
                actualImpactDate: parseDate(
                  forecastImpactDate(
                    actualExecutionDate,
                    item.settlementMode as ForecastSettlementMode
                  )
                ),
                checkedStockReferenceDate: null,
                executedAt: now,
                executedByUserId: input.userId,
                openMovementObservedAt: null,
                openMovementPeriod: null,
                openMovementReferenceDate: null,
                status: "EXECUTED",
                stockConfirmedAt: null,
              }
            : {
                actualExecutionDate: null,
                actualImpactDate: null,
                checkedStockReferenceDate: null,
                executedAt: null,
                executedByUserId: null,
                openMovementObservedAt: null,
                openMovementPeriod: null,
                openMovementReferenceDate: null,
                status: "PENDING",
                stockConfirmedAt: null,
              },
      });
    }
    await tx.auditLog.create({
      data: {
        action:
          input.action === "EXECUTE"
            ? "FORECAST_TITLES_EXECUTED"
            : "FORECAST_TITLES_EXECUTION_UNDONE",
        entity: "Forecast",
        entityId: input.forecastId,
        metadata: { itemIds: eligible.map((item) => item.id) },
        userId: input.userId,
      },
    });
  });

  return {
    ok: true,
    message:
      input.action === "EXECUTE"
        ? `${eligible.length} baixa(s) confirmada(s).`
        : `${eligible.length} confirmação(ões) desfeita(s).`,
  };
}

export async function getForecastHistory(fundId: string): Promise<ForecastHistoryEntry[]> {
  await refreshForecastEvidenceForFund(fundId);
  const forecasts = await prisma.forecast.findMany({
    where: { fundId },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    include: {
      createdBy: { select: { name: true } },
      dailyProjections: { orderBy: { projectionDate: "asc" } },
      titles: {
        orderBy: [{ plannedExecutionDate: "asc" }, { debtorName: "asc" }],
        include: { executedBy: { select: { name: true } } },
      },
    },
  });

  return forecasts.map((forecast) => ({
    id: forecast.id,
    name: forecast.name,
    version: forecast.version,
    periodEnd: dateKey(forecast.periodEnd)!,
    stockReferenceDate: dateKey(forecast.stockReferenceDate)!,
    isActive: forecast.isActive,
    createdAt: forecast.createdAt.toISOString(),
    createdByName: forecast.createdBy.name,
    manualPddInputs: forecast.dailyProjections
      .filter((row) => !row.manualPddDelta.isZero())
      .map((row) => ({
        date: dateKey(row.projectionDate)!,
        value: Number(row.manualPddDelta),
      })),
    titles: forecast.titles.map((item) => ({
      id: item.id,
      sourceStockId: item.sourceStockId,
      cedentName: item.cedentName,
      debtorName: item.debtorName,
      documentNumber: item.documentNumber,
      yourNumber: item.yourNumber,
      originalDueDate: dateKey(item.originalDueDate)!,
      nominalValue: item.nominalValue.toFixed(2),
      pddValue: item.pddValue.toFixed(2),
      reversalAmount: item.reversalAmount.toFixed(2),
      settlementMode: item.settlementMode,
      plannedExecutionDate: dateKey(item.plannedExecutionDate)!,
      plannedImpactDate: dateKey(item.plannedImpactDate)!,
      status: resolveForecastItemStatus({
        executed: Boolean(item.executedAt),
        foundInOpenMovement: Boolean(item.openMovementObservedAt),
        hasEligibleStockSnapshot: Boolean(item.checkedStockReferenceDate),
        foundInStock: item.status === "DIVERGENT",
        mode: item.settlementMode,
      }),
      executedAt: item.executedAt?.toISOString() ?? null,
      executedByName: item.executedBy?.name ?? null,
      actualExecutionDate: dateKey(item.actualExecutionDate),
      actualImpactDate: dateKey(item.actualImpactDate),
      openMovementReferenceDate: dateKey(item.openMovementReferenceDate),
      openMovementPeriod: item.openMovementPeriod,
      checkedStockReferenceDate: dateKey(item.checkedStockReferenceDate),
    })),
  }));
}
