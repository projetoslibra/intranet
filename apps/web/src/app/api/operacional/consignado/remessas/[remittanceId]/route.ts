import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { cancelSettlementRemittance } from "@/server/operational/consignado-settlement-service";

export const runtime = "nodejs";

export async function DELETE(_request: NextRequest, { params }: { params: { remittanceId: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 });
  if (!(await hasPermission("operational.finance.manage"))) return NextResponse.json({ ok: false, message: "Sem permissão para cancelar remessas." }, { status: 403 });
  try {
    await cancelSettlementRemittance(params.remittanceId, session.user.id);
    return NextResponse.json({ ok: true, message: "Remessa cancelada e removida das pendências da conciliação." });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Erro ao cancelar remessa." }, { status: 409 });
  }
}
