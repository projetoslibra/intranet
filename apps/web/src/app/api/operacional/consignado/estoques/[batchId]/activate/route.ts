import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { activateConsignadoStockBatch } from "@/server/operational/consignado-stock-service";

export const runtime = "nodejs";

type RouteContext = { params: { batchId: string } };

export async function POST(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 });
  }
  if (!(await hasPermission("operational.stock.import"))) {
    return NextResponse.json({ ok: false, message: "Sem permissão para ativar estoque." }, { status: 403 });
  }

  try {
    await activateConsignadoStockBatch(params.batchId);
    return NextResponse.json({ ok: true, message: "Versão do estoque ativada." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao ativar estoque.";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
