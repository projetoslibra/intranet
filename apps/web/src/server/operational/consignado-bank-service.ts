import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseBradescoStatement } from "./consignado-parsers";
import { parseDateOnly } from "./consignado-date";
import { planConsignadoReconciliation } from "./consignado-reconciliation";
import {
  assertBankReconciliationRecordsAvailable,
  normalizeBankReconciliationSelection,
  type BankReconciliationInput,
} from "./consignado-bank-input";

const CONSIGNADO_CNPJ = "54842157000193";
function digits(value: unknown) { return String(value ?? "").replace(/\D/g, ""); }
function fingerprint(parts: unknown[]) { return createHash("sha256").update(parts.map((part) => String(part ?? "").trim().toUpperCase()).join("|")).digest("hex"); }

type FundReader = Pick<Prisma.TransactionClient, "fund">;

async function fund(client: FundReader = prisma) {
  const funds = await client.fund.findMany({ where: { status: "ACTIVE" }, select: { id: true, cnpj: true, name: true } });
  const result = funds.find((item) => digits(item.cnpj) === CONSIGNADO_CNPJ || item.name.toUpperCase().includes("CONSIGNADO"));
  if (!result) throw new Error("Fundo Consignado não cadastrado.");
  return result;
}

export async function importBradescoStatement(input: { userId: string; fileName: string; buffer: Buffer }) {
  if (!input.fileName.toLowerCase().endsWith(".csv")) throw new Error("Envie o extrato Bradesco em formato .csv.");
  const consignado = await fund();
  const fileHash = createHash("sha256").update(input.buffer).digest("hex");
  const duplicateFile = await prisma.consignadoBankStatementImport.findUnique({ where: { fundId_fileHash: { fundId: consignado.id, fileHash } } });
  if (duplicateFile) return { duplicateFile: true, importedRows: 0, duplicateRows: duplicateFile.importedRows, ignoredRows: duplicateFile.ignoredRows };
  const parsed = parseBradescoStatement(input.buffer);
  const rows = parsed.entries.map((entry) => ({ ...entry, fingerprint: fingerprint([consignado.id, entry.transactionDate.toISOString().slice(0, 10), entry.document, entry.amount, entry.description]) }));
  const statementImport = await prisma.$transaction(async (tx) => {
    const created = await tx.consignadoBankStatementImport.create({ data: {
      fundId: consignado.id, importedByUserId: input.userId, fileName: input.fileName, fileHash,
      agency: parsed.agency, account: parsed.account, totalRows: parsed.totalRows,
      importedRows: 0, duplicateRows: 0, ignoredRows: parsed.ignoredRows,
    }});
    const inserted = rows.length
      ? await tx.consignadoBankCreditEntry.createMany({
          data: rows.map((row) => ({
            importId: created.id, fundId: consignado.id, transactionDate: row.transactionDate, description: row.description,
            document: row.document, amount: new Prisma.Decimal(row.amount), fingerprint: row.fingerprint,
          })),
          skipDuplicates: true,
        })
      : { count: 0 };
    const duplicateRows = rows.length - inserted.count;
    const updated = await tx.consignadoBankStatementImport.update({
      where: { id: created.id },
      data: { importedRows: inserted.count, duplicateRows },
    });
    await tx.consignadoStatusEvent.create({ data: { userId: input.userId, entityType: "BANK_STATEMENT_IMPORT", entityId: created.id, toStatus: "COMPLETED", metadata: { importedRows: inserted.count, duplicateRows, ignoredRows: parsed.ignoredRows } } });
    return updated;
  });
  return { id: statementImport.id, duplicateFile: false, importedRows: statementImport.importedRows, duplicateRows: statementImport.duplicateRows, ignoredRows: parsed.ignoredRows };
}

function entryStatus(amount: Prisma.Decimal, allocated: Prisma.Decimal, adjusted: Prisma.Decimal) {
  const settled = allocated.add(adjusted);
  if (settled.gte(amount)) return "RECONCILED" as const;
  if (settled.gt(0)) return "PARTIAL" as const;
  return "PENDING" as const;
}

function remittanceStatus(amount: Prisma.Decimal, allocated: Prisma.Decimal, adjusted: Prisma.Decimal) {
  const settled = allocated.add(adjusted);
  if (settled.gte(amount)) return "RECONCILED" as const;
  if (settled.gt(0)) return "RECONCILING" as const;
  return "GENERATED" as const;
}

export async function createBankReconciliation(input: BankReconciliationInput & { userId: string }) {
  return createBankReconciliationWithDependencies(input, {
    database: prisma,
    createId: randomUUID,
  });
}

export async function createBankReconciliationWithDependencies(
  input: BankReconciliationInput & { userId: string },
  dependencies: {
    database: Pick<typeof prisma, "$transaction">;
    createId: () => string;
  },
) {
  const { entryIds, remittanceIds, exclusionIds } = normalizeBankReconciliationSelection(input);
  if (!entryIds.length || !remittanceIds.length) throw new Error("Selecione ao menos uma entrada e uma remessa.");
  return dependencies.database.$transaction(async (tx) => {
    const consignado = await fund(tx);
    const [entries, remittances, exclusions] = await Promise.all([
      tx.consignadoBankCreditEntry.findMany({
        where: { id: { in: entryIds } },
        orderBy: [{ transactionDate: "asc" }, { id: "asc" }],
      }),
      tx.consignadoRemittance.findMany({
        where: { id: { in: remittanceIds } },
        include: { batch: { select: { status: true } } },
        orderBy: [{ generatedAt: "asc" }, { id: "asc" }],
      }),
      tx.consignadoRemittanceExclusion.findMany({
        where: { id: { in: exclusionIds } },
        include: {
          remittance: {
            select: {
              fundId: true,
              status: true,
              batch: { select: { status: true } },
            },
          },
          differenceTitles: {
            where: { reconciliation: { status: "ACTIVE" } },
            select: { reconciliationId: true },
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    ]);
    assertBankReconciliationRecordsAvailable({
      fundId: consignado.id,
      entryIds,
      remittanceIds,
      exclusionIds,
      entries,
      remittances,
      exclusions,
    });
    const entryBalances = entries.map((entry) => ({
      id: entry.id,
      remaining: entry.amount.sub(entry.allocatedAmount).sub(entry.adjustedAmount),
    }));
    const remittanceBalances = remittances.map((item) => ({
      id: item.id,
      remaining: item.totalAmount.sub(item.allocatedAmount).sub(item.adjustedAmount),
    }));
    const initialPlan = planConsignadoReconciliation({
      entries: entryBalances,
      remittances: remittanceBalances,
    });
    const plan = planConsignadoReconciliation({
      entries: entryBalances,
      remittances: remittanceBalances,
      differenceTitles: exclusions.map((item) => ({
        id: item.id,
        remittanceId: item.remittanceId,
        amount: item.paidAmount,
      })),
      otherDifferences: input.otherDifferences.map((item) => ({
        category: item.category,
        direction: initialPlan.direction,
        amount: new Prisma.Decimal(item.amount),
        reason: item.reason,
      })),
    });
    if (!plan.allocations.length) throw new Error("Não há saldo disponível entre os itens selecionados.");
    const differenceReason = plan.difference.gt(0)
      ? [
          plan.titleDifferenceTotal.gt(0)
            ? `${exclusions.length} título(s) fora da remessa: ${plan.titleDifferenceTotal.toFixed(2)}`
            : null,
          plan.otherDifferenceTotal.gt(0)
            ? `${input.otherDifferences.length} outro(s) ajuste(s): ${plan.otherDifferenceTotal.toFixed(2)}`
            : null,
        ].filter((item): item is string => Boolean(item)).join("; ")
      : null;
    const identifiedOtherDifferences = input.otherDifferences.map((item) => ({
      ...item,
      id: dependencies.createId(),
    }));
    const reconciliation = await tx.consignadoBankReconciliation.create({ data: {
      createdByUserId: input.userId,
      totalAmount: plan.allocatedTotal,
      entryTotalAmount: plan.entryTotal,
      remittanceTotalAmount: plan.remittanceTotal,
      differenceAmount: plan.difference,
      differenceReason,
      note: input.note?.trim() || null,
    } });
    await tx.consignadoBankAllocation.createMany({ data: plan.allocations.map((allocation) => ({ reconciliationId: reconciliation.id, ...allocation })) });
    if (exclusions.length) {
      await tx.consignadoBankDifferenceTitle.createMany({
        data: exclusions.map((item) => ({
          reconciliationId: reconciliation.id,
          remittanceExclusionId: item.id,
          amount: item.paidAmount,
        })),
      });
    }
    if (identifiedOtherDifferences.length) {
      await tx.consignadoBankOtherDifference.createMany({
        data: identifiedOtherDifferences.map((item) => ({
          id: item.id,
          reconciliationId: reconciliation.id,
          createdByUserId: input.userId,
          category: item.category,
          direction: plan.direction,
          amount: new Prisma.Decimal(item.amount),
          reason: item.reason.trim(),
        })),
      });
    }
    const adjustments = [
      ...plan.entryAdjustments.map((adjustment) => ({ reconciliationId: reconciliation.id, bankEntryId: adjustment.entityId, amount: adjustment.amount })),
      ...plan.remittanceAdjustments.map((adjustment) => ({ reconciliationId: reconciliation.id, remittanceId: adjustment.entityId, amount: adjustment.amount })),
    ];
    if (adjustments.length) await tx.consignadoBankAdjustment.createMany({ data: adjustments });
    for (const entry of entries) {
      const added = plan.allocations.filter((allocation) => allocation.bankEntryId === entry.id).reduce((sum, allocation) => sum.add(allocation.amount), new Prisma.Decimal(0));
      const adjusted = entry.adjustedAmount.add(plan.entryAdjustments.find((item) => item.entityId === entry.id)?.amount ?? 0);
      const allocated = entry.allocatedAmount.add(added);
      await tx.consignadoBankCreditEntry.update({ where: { id: entry.id }, data: { allocatedAmount: allocated, adjustedAmount: adjusted, status: entryStatus(entry.amount, allocated, adjusted) } });
    }
    for (const remittance of remittances) {
      const added = plan.allocations.filter((allocation) => allocation.remittanceId === remittance.id).reduce((sum, allocation) => sum.add(allocation.amount), new Prisma.Decimal(0));
      const adjusted = remittance.adjustedAmount.add(plan.remittanceAdjustments.find((item) => item.entityId === remittance.id)?.amount ?? 0);
      const allocated = remittance.allocatedAmount.add(added);
      const status = remittanceStatus(remittance.totalAmount, allocated, adjusted);
      await tx.consignadoRemittance.update({ where: { id: remittance.id }, data: { allocatedAmount: allocated, adjustedAmount: adjusted, status } });
      await tx.consignadoSettlementBatch.update({ where: { id: remittance.batchId }, data: { status: status === "RECONCILED" ? "RECONCILED" : "RECONCILING" } });
    }
    await tx.consignadoStatusEvent.create({ data: { userId: input.userId, entityType: "BANK_RECONCILIATION", entityId: reconciliation.id, toStatus: "ACTIVE", metadata: {
      allocatedTotal: plan.allocatedTotal.toString(),
      entryTotal: plan.entryTotal.toString(),
      remittanceTotal: plan.remittanceTotal.toString(),
      signedDifference: plan.signedDifference.toString(),
      difference: plan.difference.toString(),
      direction: plan.direction,
      titleDifferenceTotal: plan.titleDifferenceTotal.toString(),
      otherDifferenceTotal: plan.otherDifferenceTotal.toString(),
      differenceReason,
      entryIds,
      remittanceIds,
      exclusionIds,
      otherDifferenceIds: identifiedOtherDifferences.map((item) => item.id),
    } } });
    return reconciliation;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function undoBankReconciliation(reconciliationId: string, userId: string) {
  return undoBankReconciliationWithDependencies(reconciliationId, userId, {
    database: prisma,
    now: () => new Date(),
  });
}

export async function undoBankReconciliationWithDependencies(
  reconciliationId: string,
  userId: string,
  dependencies: {
    database: Pick<typeof prisma, "$transaction">;
    now: () => Date;
  },
) {
  return dependencies.database.$transaction(async (tx) => {
    const reconciliation = await tx.consignadoBankReconciliation.findFirstOrThrow({
      where: { id: reconciliationId, status: "ACTIVE" },
      include: {
        allocations: true,
        adjustments: true,
        differenceTitles: true,
        otherDifferences: true,
      },
    });
    const entryIds = Array.from(new Set([...reconciliation.allocations.map((item) => item.bankEntryId), ...reconciliation.adjustments.map((item) => item.bankEntryId).filter((id): id is string => Boolean(id))]));
    const remittanceIds = Array.from(new Set([...reconciliation.allocations.map((item) => item.remittanceId), ...reconciliation.adjustments.map((item) => item.remittanceId).filter((id): id is string => Boolean(id))]));
    const entries = await tx.consignadoBankCreditEntry.findMany({ where: { id: { in: entryIds } } });
    const remittances = await tx.consignadoRemittance.findMany({ where: { id: { in: remittanceIds } } });
    for (const entry of entries) {
      const removed = reconciliation.allocations.filter((item) => item.bankEntryId === entry.id).reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0));
      const adjustmentRemoved = reconciliation.adjustments.filter((item) => item.bankEntryId === entry.id).reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0));
      const allocated = Prisma.Decimal.max(0, entry.allocatedAmount.sub(removed));
      const adjusted = Prisma.Decimal.max(0, entry.adjustedAmount.sub(adjustmentRemoved));
      await tx.consignadoBankCreditEntry.update({ where: { id: entry.id }, data: { allocatedAmount: allocated, adjustedAmount: adjusted, status: entryStatus(entry.amount, allocated, adjusted) } });
    }
    for (const remittance of remittances) {
      const removed = reconciliation.allocations.filter((item) => item.remittanceId === remittance.id).reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0));
      const adjustmentRemoved = reconciliation.adjustments.filter((item) => item.remittanceId === remittance.id).reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0));
      const allocated = Prisma.Decimal.max(0, remittance.allocatedAmount.sub(removed));
      const adjusted = Prisma.Decimal.max(0, remittance.adjustedAmount.sub(adjustmentRemoved));
      const status = remittanceStatus(remittance.totalAmount, allocated, adjusted);
      await tx.consignadoRemittance.update({ where: { id: remittance.id }, data: { allocatedAmount: allocated, adjustedAmount: adjusted, status } });
      await tx.consignadoSettlementBatch.update({ where: { id: remittance.batchId }, data: { status: status === "GENERATED" ? "GENERATED" : status === "RECONCILED" ? "RECONCILED" : "RECONCILING" } });
    }
    const undoneAt = dependencies.now();
    if (reconciliation.otherDifferences.length) {
      await tx.consignadoBankOtherDifference.updateMany({
        where: { reconciliationId: reconciliation.id },
        data: { status: "CANCELLED", cancelledAt: undoneAt },
      });
    }
    await tx.consignadoBankReconciliation.update({ where: { id: reconciliation.id }, data: { status: "UNDONE", undoneByUserId: userId, undoneAt } });
    await tx.consignadoStatusEvent.create({ data: {
      userId,
      entityType: "BANK_RECONCILIATION",
      entityId: reconciliation.id,
      fromStatus: "ACTIVE",
      toStatus: "UNDONE",
      metadata: {
        exclusionIds: reconciliation.differenceTitles.map((item) => item.remittanceExclusionId),
        otherDifferenceIds: reconciliation.otherDifferences.map((item) => item.id),
      },
    } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function getBankReconciliationWorkspace(input: { transactionDate?: string } = {}) {
  return getBankReconciliationWorkspaceWithDependencies(input, { database: prisma });
}

export async function getBankReconciliationWorkspaceWithDependencies(
  input: { transactionDate?: string },
  dependencies: {
    database: Pick<
      typeof prisma,
      | "fund"
      | "consignadoBankCreditEntry"
      | "consignadoRemittance"
      | "consignadoBankReconciliation"
      | "consignadoBankStatementImport"
    >;
  },
) {
  const { database } = dependencies;
  const consignado = await fund(database);
  const openWhere = { fundId: consignado.id, status: { not: "RECONCILED" as const } };
  const [entries, remittances, reconciliations, imports, summaryAggregate] = await Promise.all([
    database.consignadoBankCreditEntry.findMany({ where: { ...openWhere, ...(input.transactionDate ? { transactionDate: parseDateOnly(input.transactionDate) } : {}) }, orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }] }),
    database.consignadoRemittance.findMany({
      where: {
        fundId: consignado.id,
        status: { in: ["GENERATED", "RECONCILING"] },
        batch: { status: { not: "CANCELLED" } },
      },
      include: {
        batch: { include: { originator: true } },
        exclusions: {
          where: { differenceTitles: { none: { reconciliation: { status: "ACTIVE" } } } },
          include: { settlementItem: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
      orderBy: { generatedAt: "asc" },
    }),
    database.consignadoBankReconciliation.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        createdBy: { select: { name: true } },
        undoneBy: { select: { name: true } },
        allocations: true,
        adjustments: true,
        differenceTitles: {
          include: {
            remittanceExclusion: {
              include: {
                settlementItem: true,
                remittance: {
                  select: {
                    id: true,
                    fileName: true,
                    batch: { select: { id: true, fileName: true } },
                  },
                },
              },
            },
          },
        },
        otherDifferences: {
          include: {
            createdBy: { select: { name: true } },
            resolvedBy: { select: { name: true } },
          },
        },
      },
    }),
    database.consignadoBankStatementImport.findMany({ where: { fundId: consignado.id }, orderBy: { createdAt: "desc" }, take: 20, include: { importedBy: { select: { name: true } } } }),
    database.consignadoBankCreditEntry.aggregate({ where: openWhere, _count: { _all: true }, _sum: { amount: true, allocatedAmount: true, adjustedAmount: true } }),
  ]);
  const openEntryAmount = (summaryAggregate._sum.amount ?? new Prisma.Decimal(0))
    .sub(summaryAggregate._sum.allocatedAmount ?? 0)
    .sub(summaryAggregate._sum.adjustedAmount ?? 0);
  const summary = { openEntryCount: summaryAggregate._count._all, openEntryAmount };
  return JSON.parse(JSON.stringify({ entries, remittances, reconciliations, imports, summary }, (_, value) => value instanceof Prisma.Decimal ? value.toString() : value));
}
