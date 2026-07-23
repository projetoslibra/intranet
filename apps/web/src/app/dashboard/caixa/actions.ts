"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { sortFundsByDisplayPriority } from "@/lib/fund-order";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import type {
  CashActionResult,
  CashBatchInput,
  CashBalanceInput,
  CashDailyBalance,
  CashFund,
} from "@/features/cash/types/cash";

const cashDailyBalanceSchema = z.object({
  fundId: z.string().min(1),
  receivingBalance: z.number().min(0),
  reconciliationBalance: z.number().min(0),
  reserveBalance: z.number().min(0),
  paymentBalance: z.number().min(0),
  usedAmount: z.number().min(0),
  note: z.string().optional(),
});

const cashDailyBalanceBatchSchema = z.object({
  referenceDate: z.coerce.date(),
  balances: z.array(cashDailyBalanceSchema).min(1),
});

const singleCashDailyBalanceSchema = cashDailyBalanceSchema.extend({
  referenceDate: z.coerce.date(),
});

/** Caixa = Conta pgto − Reserva − Usado. Aritmética Decimal, nunca float. */
function computeCash(
  paymentBalance: Prisma.Decimal,
  reserveBalance: Prisma.Decimal,
  usedAmount: Prisma.Decimal
): Prisma.Decimal {
  return paymentBalance.minus(reserveBalance).minus(usedAmount);
}

/** Normaliza uma data para meia-noite UTC, compatível com colunas @db.Date. */
function normalizeDate(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

type CashBalanceRow = Prisma.CompanyCashDailyBalanceGetPayload<{
  include: { fund: { select: { id: true; name: true; shortName: true } } };
}>;

function serialize(row: CashBalanceRow): CashDailyBalance {
  const cash = computeCash(row.paymentBalance, row.reserveBalance, row.usedAmount);

  return {
    fundId: row.fundId,
    fundName: row.fund.name,
    fundShortName: row.fund.shortName,
    referenceDate: row.referenceDate.toISOString().slice(0, 10),
    receivingBalance: row.receivingBalance.toFixed(2),
    reconciliationBalance: row.reconciliationBalance.toFixed(2),
    reserveBalance: row.reserveBalance.toFixed(2),
    paymentBalance: row.paymentBalance.toFixed(2),
    usedAmount: row.usedAmount.toFixed(2),
    cash: cash.toFixed(2),
    note: row.note,
  };
}

function balanceData(input: CashBalanceInput) {
  return {
    receivingBalance: new Prisma.Decimal(input.receivingBalance.toFixed(2)),
    reconciliationBalance: new Prisma.Decimal(input.reconciliationBalance.toFixed(2)),
    reserveBalance: new Prisma.Decimal(input.reserveBalance.toFixed(2)),
    paymentBalance: new Prisma.Decimal(input.paymentBalance.toFixed(2)),
    usedAmount: new Prisma.Decimal(input.usedAmount.toFixed(2)),
    note: input.note?.trim() ? input.note.trim() : null,
  };
}

/** Lista os fundos ativos (colunas/cards do Caixa). Não hardcoda nomes. */
export async function getActiveCashFunds(): Promise<CashFund[]> {
  if (!(await hasPermission("cash.view"))) {
    return [];
  }

  return sortFundsByDisplayPriority(await prisma.fund.findMany({
    where: {
      status: "ACTIVE",
      cnpj: {
        not: "00.000.000/0001-00",
      },
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, shortName: true },
  }));
}

export async function getAvailableCashDates(): Promise<string[]> {
  if (!(await hasPermission("cash.view"))) {
    return [];
  }

  const rows = await prisma.companyCashDailyBalance.findMany({
    distinct: ["referenceDate"],
    select: { referenceDate: true },
    orderBy: { referenceDate: "desc" },
  });

  return rows.map((row) => row.referenceDate.toISOString().slice(0, 10));
}

export async function getCashDailyBalancesByDate(
  dateStr: string
): Promise<CashDailyBalance[]> {
  if (!(await hasPermission("cash.view"))) {
    return [];
  }

  const rows = await prisma.companyCashDailyBalance.findMany({
    where: { referenceDate: parseDateOnly(dateStr) },
    include: { fund: { select: { id: true, name: true, shortName: true } } },
    orderBy: { fund: { name: "asc" } },
  });

  return rows.map(serialize);
}

export async function upsertCashDailyBalance(
  input: CashBalanceInput & { referenceDate: string }
): Promise<CashActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Sessão expirada. Faça login novamente." };
  }
  if (!(await hasPermission("cash.manage"))) {
    return { ok: false, message: "Você não tem permissão para editar o caixa." };
  }

  const parsed = singleCashDailyBalanceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Dados inválidos. Revise os valores informados." };
  }

  const { referenceDate, ...balance } = parsed.data;
  const date = normalizeDate(referenceDate);
  const data = balanceData(balance);
  const userId = session.user.id;

  try {
    await prisma.companyCashDailyBalance.upsert({
      where: { fundId_referenceDate: { fundId: balance.fundId, referenceDate: date } },
      update: { ...data, updatedById: userId },
      create: {
        ...data,
        fundId: balance.fundId,
        referenceDate: date,
        createdById: userId,
        updatedById: userId,
      },
    });
  } catch {
    return { ok: false, message: "Não foi possível salvar a posição. Tente novamente." };
  }

  revalidatePath("/dashboard/caixa");
  return { ok: true, message: "Posição salva com sucesso." };
}

export async function upsertBatchCashDailyBalances(
  input: CashBatchInput
): Promise<CashActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Sessão expirada. Faça login novamente." };
  }
  if (!(await hasPermission("cash.manage"))) {
    return { ok: false, message: "Você não tem permissão para editar o caixa." };
  }

  const parsed = cashDailyBalanceBatchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Dados inválidos. Revise os valores informados." };
  }

  const { referenceDate, balances } = parsed.data;
  const date = normalizeDate(referenceDate);
  const userId = session.user.id;

  try {
    await prisma.$transaction(
      balances.map((balance) => {
        const data = balanceData(balance);
        return prisma.companyCashDailyBalance.upsert({
          where: {
            fundId_referenceDate: { fundId: balance.fundId, referenceDate: date },
          },
          update: { ...data, updatedById: userId },
          create: {
            ...data,
            fundId: balance.fundId,
            referenceDate: date,
            createdById: userId,
            updatedById: userId,
          },
        });
      })
    );
  } catch {
    return {
      ok: false,
      message: "Não foi possível salvar as posições. Tente novamente.",
    };
  }

  revalidatePath("/dashboard/caixa");
  return { ok: true, message: "Posições salvas com sucesso." };
}
