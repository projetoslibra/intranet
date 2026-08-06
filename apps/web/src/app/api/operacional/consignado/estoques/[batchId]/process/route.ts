import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { processConsignadoStockBatch } from "@/server/operational/consignado-stock-service";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = { params: { batchId: string } };

export async function POST(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 });
  }
  if (!(await hasPermission("operational.stock.import"))) {
    return NextResponse.json({ ok: false, message: "Sem permissão para processar estoque." }, { status: 403 });
  }

  try {
    const batch = await processConsignadoStockBatch(params.batchId);
    return NextResponse.json({ ok: true, status: batch.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao processar estoque.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
