import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { importFidcOpenMovements } from "@/server/operational/import-service";

export const runtime = "nodejs";

function parseReferenceDate(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const date = new Date(`${value.trim()}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false, message: "Sessão expirada. Faça login novamente." },
      { status: 401 }
    );
  }

  if (!(await hasPermission("operational.stock.import"))) {
    return NextResponse.json(
      { ok: false, message: "Você não tem permissão para importar movimento aberto." },
      { status: 403 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, message: "Envie um arquivo .csv de movimento aberto." },
        { status: 400 }
      );
    }

    const result = await importFidcOpenMovements({
      user: { id: session.user.id },
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      referenceDate: parseReferenceDate(formData.get("dataReferencia")),
    });

    return NextResponse.json({ ok: true, result, message: result.message });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro ao importar movimento aberto.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
