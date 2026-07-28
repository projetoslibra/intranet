"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export type DeleteFundState = {
  ok: boolean;
  message: string;
};

const deleteFundSchema = z.object({
  id: z.string().min(1),
});

export async function deleteFundAction(
  _previousState: DeleteFundState,
  formData: FormData
): Promise<DeleteFundState> {
  if (!(await hasPermission("funds.manage"))) {
    return {
      ok: false,
      message: "Voce nao tem permissao para excluir fundos.",
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
      message: "Nao foi possivel excluir o fundo.",
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/fundos");
  revalidatePath("/dashboard/dre");
  revalidatePath("/dashboard/caixa");
  revalidatePath("/dashboard/previsoes");

  return {
    ok: true,
    message: "Fundo excluido das telas operacionais.",
  };
}
