import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { importReceivableStock } from "@/server/operational/import-service";

export const runtime = "nodejs";

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
      { ok: false, message: "Você não tem permissão para importar estoque." },
      { status: 403 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, message: "Envie uma planilha .xlsx de estoque." },
        { status: 400 }
      );
    }

    const result = await importReceivableStock({
      user: { id: session.user.id },
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
    });

    return NextResponse.json({ ok: true, result, message: result.message });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao importar estoque.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
