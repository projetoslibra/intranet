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

export type ImportCarteirasState = {
  ok: boolean;
  message: string;
  result?: SingulareImportResult;
  caixaResult?: SingulareCaixaImportResult;
  fieldErrors?: Record<string, string[] | undefined>;
};

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
