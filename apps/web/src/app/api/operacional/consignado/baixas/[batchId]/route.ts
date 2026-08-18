import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { cancelSettlementBatch } from "@/server/operational/consignado-settlement-service";

export const runtime = "nodejs";

export async function DELETE(_request: NextRequest, { params }: { params: { batchId: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 });
  if (!(await hasPermission("operational.finance.manage"))) return NextResponse.json({ ok: false, message: "Sem permissão para excluir lotes." }, { status: 403 });
  try {
    await cancelSettlementBatch(params.batchId, session.user.id);
    return NextResponse.json({ ok: true, message: "Lote excluído da visualização. O histórico foi preservado." });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Erro ao excluir lote." }, { status: 400 });
  }
}
