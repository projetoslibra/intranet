"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export type CreateFundState = {
  message: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

const createFundSchema = z.object({
  name: z.string().min(3, "Informe o nome completo."),
  shortName: z.string().min(2, "Informe o nome curto."),
  cnpj: z
    .string()
    .regex(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, "Informe um CNPJ válido."),
  fundType: z.enum(["FIDC", "FII", "FIM", "FIA"]),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  startDate: z.string().min(1, "Informe a data de início."),
});

export async function createFundAction(
  _previousState: CreateFundState,
  formData: FormData
): Promise<CreateFundState> {
  const parsed = createFundSchema.safeParse({
    name: formData.get("name"),
    shortName: formData.get("shortName"),
    cnpj: formData.get("cnpj"),
    fundType: formData.get("fundType"),
    status: formData.get("status"),
    startDate: formData.get("startDate"),
  });

  if (!parsed.success) {
    return {
      message: "Revise os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await prisma.fund.create({
      data: {
        name: parsed.data.name,
        shortName: parsed.data.shortName,
        cnpj: parsed.data.cnpj,
        fundType: parsed.data.fundType,
        status: parsed.data.status,
        startDate: new Date(`${parsed.data.startDate}T00:00:00.000Z`),
      },
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return {
        message: "Já existe um fundo cadastrado com este CNPJ.",
      };
    }

    return {
      message: "Não foi possível salvar o fundo. Tente novamente.",
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/fundos");
  redirect("/dashboard/fundos");
}
