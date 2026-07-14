import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { importCedentDimension } from "@/server/operational/import-service";

export const runtime = "nodejs";

function parseDateOnly(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
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

  if (!(await hasPermission("operational.dimension.import"))) {
    return NextResponse.json(
      { ok: false, message: "Você não tem permissão para importar a DIM cedentes." },
      { status: 403 }
    );
  }

  try {
    const formData = await request.formData();
    const result = await importCedentDimension({
      user: { id: session.user.id },
      referenceDate: parseDateOnly(String(formData.get("referenceDate") ?? "")),
    });

    return NextResponse.json({ ok: true, result, message: result.message });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao importar DIM cedentes.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
