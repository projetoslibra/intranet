import { z } from "zod";
import { Prisma } from "@prisma/client";

const bankDifferenceCategorySchema = z.enum([
  "BANK_FEE",
  "UNIDENTIFIED_CREDIT",
  "VALUE_DIFFERENCE",
  "ROUNDING",
  "TIMING_DIFFERENCE",
  "OTHER",
]);

const positiveCentAmountSchema = z.string()
  .regex(/^(?:0|[1-9]\d{0,21})(?:\.\d{1,2})?$/, "Informe um valor monetário válido.")
  .refine((amount) => {
    try {
      const decimal = new Prisma.Decimal(amount);
      return decimal.isFinite() && decimal.gt(0);
    } catch {
      return false;
    }
  }, "O valor deve ser positivo.");

export const bankReconciliationInputSchema = z.object({
  entryIds: z.array(z.string().min(1)).min(1),
  remittanceIds: z.array(z.string().min(1)).min(1),
  exclusionIds: z.array(z.string().min(1)),
  otherDifferences: z.array(z.object({
    category: bankDifferenceCategorySchema,
    amount: positiveCentAmountSchema,
    reason: z.string().trim().min(5).max(500),
  })),
  note: z.string().trim().max(500).optional(),
}).strict();

export type BankReconciliationInput = z.infer<typeof bankReconciliationInputSchema>;

export function normalizeBankReconciliationSelection(input: Pick<
  BankReconciliationInput,
  "entryIds" | "remittanceIds" | "exclusionIds"
>) {
  return {
    entryIds: Array.from(new Set(input.entryIds)),
    remittanceIds: Array.from(new Set(input.remittanceIds)),
    exclusionIds: Array.from(new Set(input.exclusionIds)),
  };
}

type LoadedEntry = {
  id: string;
  fundId: string;
  status: string;
};

type LoadedRemittance = {
  id: string;
  fundId: string;
  status: string;
  batch: { status: string };
};

type LoadedExclusion = {
  id: string;
  remittanceId: string;
  remittance: {
    fundId: string;
    status: string;
    batch: { status: string };
  };
  differenceTitles: unknown[];
};

function hasExactIds(expectedIds: string[], records: Array<{ id: string }>) {
  const loadedIds = new Set(records.map((record) => record.id));
  return records.length === expectedIds.length && expectedIds.every((id) => loadedIds.has(id));
}

export function assertBankReconciliationRecordsAvailable(input: {
  fundId: string;
  entryIds: string[];
  remittanceIds: string[];
  exclusionIds: string[];
  entries: LoadedEntry[];
  remittances: LoadedRemittance[];
  exclusions: LoadedExclusion[];
}) {
  const entriesAvailable = hasExactIds(input.entryIds, input.entries)
    && input.entries.every((entry) => entry.fundId === input.fundId && entry.status !== "RECONCILED");
  const remittancesAvailable = hasExactIds(input.remittanceIds, input.remittances)
    && input.remittances.every((remittance) => (
      remittance.fundId === input.fundId
      && ["GENERATED", "RECONCILING"].includes(remittance.status)
      && remittance.batch.status !== "CANCELLED"
    ));

  if (!entriesAvailable || !remittancesAvailable) {
    throw new Error("Algum item selecionado já foi conciliado ou alterado. Atualize a tela.");
  }
  if (!hasExactIds(input.exclusionIds, input.exclusions)) {
    throw new Error("Algum título selecionado foi removido ou alterado. Atualize a tela.");
  }

  const selectedRemittanceIds = new Set(input.remittanceIds);
  for (const exclusion of input.exclusions) {
    if (!selectedRemittanceIds.has(exclusion.remittanceId)) {
      throw new Error("Título pertence a uma remessa não selecionada.");
    }
    if (
      exclusion.remittance.fundId !== input.fundId
      || !["GENERATED", "RECONCILING"].includes(exclusion.remittance.status)
      || exclusion.remittance.batch.status === "CANCELLED"
    ) {
      throw new Error("Título pertence a uma remessa ou lote cancelado.");
    }
    if (exclusion.differenceTitles.length > 0) {
      throw new Error("Título já foi usado em outra conciliação ativa.");
    }
  }
}
