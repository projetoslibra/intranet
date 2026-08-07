import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseBradescoStatement } from "./consignado-parsers";

const CONSIGNADO_CNPJ = "54842157000193";
function digits(value: unknown) { return String(value ?? "").replace(/\D/g, ""); }
function fingerprint(parts: unknown[]) { return createHash("sha256").update(parts.map((part) => String(part ?? "").trim().toUpperCase()).join("|")).digest("hex"); }

async function fund() {
  const funds = await prisma.fund.findMany({ where: { status: "ACTIVE" }, select: { id: true, cnpj: true, name: true } });
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

function entryStatus(amount: Prisma.Decimal, allocated: Prisma.Decimal) {
  if (allocated.gte(amount)) return "RECONCILED" as const;
  if (allocated.gt(0)) return "PARTIAL" as const;
  return "PENDING" as const;
}

function remittanceStatus(amount: Prisma.Decimal, allocated: Prisma.Decimal) {
  if (allocated.gte(amount)) return "RECONCILED" as const;
  if (allocated.gt(0)) return "RECONCILING" as const;
  return "GENERATED" as const;
}

export async function createBankReconciliation(input: { userId: string; entryIds: string[]; remittanceIds: string[]; note?: string }) {
  const entryIds = Array.from(new Set(input.entryIds));
  const remittanceIds = Array.from(new Set(input.remittanceIds));
  if (!entryIds.length || !remittanceIds.length) throw new Error("Selecione ao menos uma entrada e uma remessa.");
  return prisma.$transaction(async (tx) => {
    const entries = await tx.consignadoBankCreditEntry.findMany({ where: { id: { in: entryIds }, status: { not: "RECONCILED" } }, orderBy: [{ transactionDate: "asc" }, { id: "asc" }] });
    const remittances = await tx.consignadoRemittance.findMany({ where: { id: { in: remittanceIds }, status: { in: ["GENERATED", "RECONCILING"] } }, orderBy: [{ generatedAt: "asc" }, { id: "asc" }] });
    if (entries.length !== entryIds.length || remittances.length !== remittanceIds.length) throw new Error("Algum item selecionado já foi conciliado ou alterado. Atualize a tela.");
    const entryBalances = entries.map((entry) => ({ item: entry, remaining: entry.amount.sub(entry.allocatedAmount) }));
    const remittanceBalances = remittances.map((item) => ({ item, remaining: item.totalAmount.sub(item.allocatedAmount) }));
    const allocations: Array<{ bankEntryId: string; remittanceId: string; amount: Prisma.Decimal }> = [];
    for (const entry of entryBalances) {
      for (const remittance of remittanceBalances) {
        if (entry.remaining.lte(0)) break;
        if (remittance.remaining.lte(0)) continue;
        const amount = Prisma.Decimal.min(entry.remaining, remittance.remaining);
        if (amount.lte(0)) continue;
        allocations.push({ bankEntryId: entry.item.id, remittanceId: remittance.item.id, amount });
        entry.remaining = entry.remaining.sub(amount);
        remittance.remaining = remittance.remaining.sub(amount);
      }
    }
    if (!allocations.length) throw new Error("Não há saldo disponível entre os itens selecionados.");
    const total = allocations.reduce((sum, allocation) => sum.add(allocation.amount), new Prisma.Decimal(0));
    const reconciliation = await tx.consignadoBankReconciliation.create({ data: { createdByUserId: input.userId, totalAmount: total, note: input.note?.trim() || null } });
    await tx.consignadoBankAllocation.createMany({ data: allocations.map((allocation) => ({ reconciliationId: reconciliation.id, ...allocation })) });
    for (const entry of entries) {
      const added = allocations.filter((allocation) => allocation.bankEntryId === entry.id).reduce((sum, allocation) => sum.add(allocation.amount), new Prisma.Decimal(0));
      const allocated = entry.allocatedAmount.add(added);
      await tx.consignadoBankCreditEntry.update({ where: { id: entry.id }, data: { allocatedAmount: allocated, status: entryStatus(entry.amount, allocated) } });
    }
    for (const remittance of remittances) {
      const added = allocations.filter((allocation) => allocation.remittanceId === remittance.id).reduce((sum, allocation) => sum.add(allocation.amount), new Prisma.Decimal(0));
      const allocated = remittance.allocatedAmount.add(added);
      const status = remittanceStatus(remittance.totalAmount, allocated);
      await tx.consignadoRemittance.update({ where: { id: remittance.id }, data: { allocatedAmount: allocated, status } });
      await tx.consignadoSettlementBatch.update({ where: { id: remittance.batchId }, data: { status: status === "RECONCILED" ? "RECONCILED" : "RECONCILING" } });
    }
    await tx.consignadoStatusEvent.create({ data: { userId: input.userId, entityType: "BANK_RECONCILIATION", entityId: reconciliation.id, toStatus: "ACTIVE", metadata: { total: total.toString(), entryIds, remittanceIds } } });
    return reconciliation;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function undoBankReconciliation(reconciliationId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const reconciliation = await tx.consignadoBankReconciliation.findFirstOrThrow({ where: { id: reconciliationId, status: "ACTIVE" }, include: { allocations: true } });
    const entryIds = Array.from(new Set(reconciliation.allocations.map((item) => item.bankEntryId)));
    const remittanceIds = Array.from(new Set(reconciliation.allocations.map((item) => item.remittanceId)));
    const entries = await tx.consignadoBankCreditEntry.findMany({ where: { id: { in: entryIds } } });
    const remittances = await tx.consignadoRemittance.findMany({ where: { id: { in: remittanceIds } } });
    for (const entry of entries) {
      const removed = reconciliation.allocations.filter((item) => item.bankEntryId === entry.id).reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0));
      const allocated = Prisma.Decimal.max(0, entry.allocatedAmount.sub(removed));
      await tx.consignadoBankCreditEntry.update({ where: { id: entry.id }, data: { allocatedAmount: allocated, status: entryStatus(entry.amount, allocated) } });
    }
    for (const remittance of remittances) {
      const removed = reconciliation.allocations.filter((item) => item.remittanceId === remittance.id).reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0));
      const allocated = Prisma.Decimal.max(0, remittance.allocatedAmount.sub(removed));
      const status = remittanceStatus(remittance.totalAmount, allocated);
      await tx.consignadoRemittance.update({ where: { id: remittance.id }, data: { allocatedAmount: allocated, status } });
      await tx.consignadoSettlementBatch.update({ where: { id: remittance.batchId }, data: { status: status === "GENERATED" ? "GENERATED" : status === "RECONCILED" ? "RECONCILED" : "RECONCILING" } });
    }
    await tx.consignadoBankReconciliation.update({ where: { id: reconciliation.id }, data: { status: "UNDONE", undoneByUserId: userId, undoneAt: new Date() } });
    await tx.consignadoStatusEvent.create({ data: { userId, entityType: "BANK_RECONCILIATION", entityId: reconciliation.id, fromStatus: "ACTIVE", toStatus: "UNDONE" } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function getBankReconciliationWorkspace() {
  const consignado = await fund();
  const [entries, remittances, reconciliations, imports] = await Promise.all([
    prisma.consignadoBankCreditEntry.findMany({ where: { fundId: consignado.id, status: { not: "RECONCILED" } }, orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }], take: 500 }),
    prisma.consignadoRemittance.findMany({ where: { fundId: consignado.id, status: { in: ["GENERATED", "RECONCILING"] } }, include: { batch: { include: { originator: true } } }, orderBy: { generatedAt: "asc" } }),
    prisma.consignadoBankReconciliation.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { createdBy: { select: { name: true } }, undoneBy: { select: { name: true } }, allocations: true } }),
    prisma.consignadoBankStatementImport.findMany({ where: { fundId: consignado.id }, orderBy: { createdAt: "desc" }, take: 20, include: { importedBy: { select: { name: true } } } }),
  ]);
  return JSON.parse(JSON.stringify({ entries, remittances, reconciliations, imports }, (_, value) => value instanceof Prisma.Decimal ? value.toString() : value));
}
