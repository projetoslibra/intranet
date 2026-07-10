import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { importRiskLimits } from "@/server/operational/import-service";

export const runtime = "nodejs";

function parseRequiredDate(value: FormDataEntryValue | null): Date {
  const text = String(value ?? "");
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error("Informe a data de referência do risco.");
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false, message: "Sessão expirada. Faça login novamente." },
      { status: 401 }
    );
  }

  if (!(await hasPermission("operational.risk.import"))) {
    return NextResponse.json(
      { ok: false, message: "Você não tem permissão para importar risco." },
      { status: 403 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, message: "Envie uma planilha .xlsx de risco." },
        { status: 400 }
      );
    }

    const result = await importRiskLimits({
      user: { id: session.user.id },
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      referenceDate: parseRequiredDate(formData.get("referenceDate")),
    });

    return NextResponse.json({ ok: true, result, message: result.message });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao importar risco.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
