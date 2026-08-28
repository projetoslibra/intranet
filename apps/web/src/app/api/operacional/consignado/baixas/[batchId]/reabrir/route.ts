import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { reopenSettlementBatch } from "@/server/operational/consignado-settlement-service";

export async function POST(request: Request, { params }: { params: { batchId: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 });
  if (!(await hasPermission("operational.finance.manage"))) return NextResponse.json({ ok: false, message: "Sem permissão." }, { status: 403 });
  try {
    const result = await reopenSettlementBatch(params.batchId, session.user.id);
    return NextResponse.json({ ok: true, result, message: `${result.reopenedItems} título(s) devolvidos para revisão.` });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Erro ao reabrir o lote." }, { status: 400 });
  }
}
