import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { importSingulareCarteiras } from "@/server/singulare/import-service";
import { importSingulareCaixa } from "@/server/singulare/cash-import-service";

export const runtime = "nodejs";

const importCarteirasSchema = z.object({
  dataAnalise: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato YYYY-MM-DD.")
    .optional(),
});

async function parseBody(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false, message: "Sessão expirada. Faça login novamente." },
      { status: 401 }
    );
  }

  if (!(await hasPermission("dre.import"))) {
    return NextResponse.json(
      { ok: false, message: "Você não tem permissão para importar carteiras." },
      { status: 403 }
    );
  }

  const parsed = importCarteirasSchema.safeParse(await parseBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: "Parâmetros inválidos.",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  try {
    const result = await importSingulareCarteiras(parsed.data.dataAnalise);
    const caixaResult = await importSingulareCaixa(parsed.data.dataAnalise);
    return NextResponse.json({ ok: true, result, caixaResult });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro desconhecido na importação.";

    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
