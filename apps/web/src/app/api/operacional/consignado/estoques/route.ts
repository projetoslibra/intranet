import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  getConsignadoStockHistory,
  registerConsignadoStockUpload,
} from "@/server/operational/consignado-stock-service";

export const runtime = "nodejs";

const registerSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/i),
  fileSize: z.number().int().positive(),
  storageKey: z.string().trim().min(1),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 });
  }
  if (!(await hasPermission("operational.view"))) {
    return NextResponse.json({ ok: false, message: "Sem permissão." }, { status: 403 });
  }

  try {
    return NextResponse.json({ ok: true, batches: await getConsignadoStockHistory() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao consultar estoques.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 });
  }
  if (!(await hasPermission("operational.stock.import"))) {
    return NextResponse.json({ ok: false, message: "Sem permissão para importar estoque." }, { status: 403 });
  }

  try {
    const input = registerSchema.parse(await request.json());
    const result = await registerConsignadoStockUpload({ ...input, userId: session.user.id });
    return NextResponse.json({
      ok: true,
      result,
      message: result.duplicate
        ? "Este arquivo já foi enviado anteriormente."
        : "Arquivo recebido. O processamento foi iniciado.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao registrar estoque.";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
