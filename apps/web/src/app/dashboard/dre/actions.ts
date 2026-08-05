"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { importSingulareCarteiras } from "@/server/singulare/import-service";
import { importSingulareCaixa } from "@/server/singulare/cash-import-service";
import type {
  SingulareCaixaImportResult,
  SingulareImportResult,
} from "@/server/singulare/types";
import {
  importConsignadoCarteira,
  type ConsignadoCarteiraImportResult,
} from "@/server/consignado/carteira-import-service";

export type ImportCarteirasState = {
  ok: boolean;
  message: string;
  result?: SingulareImportResult;
  caixaResult?: SingulareCaixaImportResult;
  fieldErrors?: Record<string, string[] | undefined>;
};

export type ImportConsignadoCarteiraState = {
  ok: boolean;
  message: string;
  result?: ConsignadoCarteiraImportResult;
  fieldErrors?: { file?: string[] };
};

const MAX_CONSIGNADO_FILE_SIZE = 5 * 1024 * 1024;

const importCarteirasSchema = z.object({
  dataAnalise: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use uma data válida.")
    .optional()
    .or(z.literal("")),
});

export async function importCarteirasAction(
  _previousState: ImportCarteirasState,
  formData: FormData
): Promise<ImportCarteirasState> {
  const session = await auth();

  if (!session?.user?.id) {
    return {
      ok: false,
      message: "Sessão expirada. Faça login novamente.",
    };
  }

  if (!(await hasPermission("dre.import"))) {
    return {
      ok: false,
      message: "Você não tem permissão para importar carteiras.",
    };
  }

  const parsed = importCarteirasSchema.safeParse({
    dataAnalise: formData.get("dataAnalise"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Revise a data informada.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const dataAnalise = parsed.data.dataAnalise || undefined;
    const result = await importSingulareCarteiras(dataAnalise);
    const caixaResult = await importSingulareCaixa(dataAnalise);

    revalidatePath("/dashboard/dre");

    return {
      ok: true,
      message: `Importação concluída: ${result.totalRows} linhas gravadas em CARTEIRAS e ${caixaResult.importedRows} linhas gravadas em CAIXAS.`,
      result,
      caixaResult,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Não foi possível importar as carteiras.",
    };
  }
}

export async function importConsignadoCarteiraAction(
  _previousState: ImportConsignadoCarteiraState,
  formData: FormData
): Promise<ImportConsignadoCarteiraState> {
  const session = await auth();

  if (!session?.user?.id) {
    return { ok: false, message: "Sessão expirada. Faça login novamente." };
  }

  if (!(await hasPermission("dre.import"))) {
    return { ok: false, message: "Você não tem permissão para importar carteiras." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return {
      ok: false,
      message: "Selecione o CSV da carteira do Consignado.",
      fieldErrors: { file: ["Selecione um arquivo CSV."] },
    };
  }

  if (!file.name.toLowerCase().endsWith(".csv")) {
    return {
      ok: false,
      message: "Formato inválido. Envie o fechamento em CSV.",
      fieldErrors: { file: ["O arquivo deve ter extensão .csv."] },
    };
  }

  if (file.size > MAX_CONSIGNADO_FILE_SIZE) {
    return {
      ok: false,
      message: "O arquivo excede o limite de 5 MB.",
      fieldErrors: { file: ["O CSV deve ter no máximo 5 MB."] },
    };
  }

  try {
    const result = await importConsignadoCarteira({
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      user: { id: session.user.id },
    });

    revalidatePath("/dashboard/dre");
    revalidatePath("/dashboard");

    return {
      ok: true,
      message: `Carteira de ${result.referenceDate.split("-").reverse().join("/")} importada com sucesso.`,
      result,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Não foi possível importar a carteira.",
    };
  }
}
