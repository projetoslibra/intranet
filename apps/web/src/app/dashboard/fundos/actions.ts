"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { setFundModuleVisibilityWithDependencies } from "@/server/funds/module-visibility";

export type DeleteFundState = {
  ok: boolean;
  message: string;
};

const deleteFundSchema = z.object({
  id: z.string().min(1),
});

export async function setFundModuleVisibilityAction(input: unknown) {
  const session = await auth();

  return setFundModuleVisibilityWithDependencies(input, {
    actorUserId: session?.user?.id ?? null,
    canManage: await hasPermission("funds.manage"),
    findFund: (fundId) =>
      prisma.fund.findUnique({ where: { id: fundId }, select: { id: true } }),
    upsertVisibility: ({ fundId, module, enabled, updatedByUserId }) =>
      prisma.fundModuleVisibility.upsert({
        where: { fundId_module: { fundId, module } },
        create: { fundId, module, enabled, updatedByUserId },
        update: { enabled, updatedByUserId },
        select: { enabled: true },
      }),
    revalidate: revalidatePath,
  });
}

export async function deleteFundAction(
  _previousState: DeleteFundState,
  formData: FormData
): Promise<DeleteFundState> {
  if (!(await hasPermission("funds.manage"))) {
    return {
      ok: false,
      message: "Voce nao tem permissao para desativar fundos.",
    };
  }

  const parsed = deleteFundSchema.safeParse({
    id: formData.get("id"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Fundo invalido.",
    };
  }

  try {
    await prisma.fund.update({
      where: {
        id: parsed.data.id,
      },
      data: {
        status: "INACTIVE",
      },
    });
  } catch {
    return {
      ok: false,
      message: "Nao foi possivel desativar o fundo.",
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/fundos");
  revalidatePath("/dashboard/dre");
  revalidatePath("/dashboard/caixa");
  revalidatePath("/dashboard/previsoes");
  revalidatePath("/dashboard/pdd");

  return {
    ok: true,
    message: "Fundo desativado.",
  };
}
