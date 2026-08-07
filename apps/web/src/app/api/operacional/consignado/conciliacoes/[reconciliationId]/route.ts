import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { undoBankReconciliation } from "@/server/operational/consignado-bank-service";

export async function DELETE(_request: Request, { params }: { params: { reconciliationId: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 });
  if (!(await hasPermission("operational.finance.manage"))) return NextResponse.json({ ok: false, message: "Sem permissão." }, { status: 403 });
  try { await undoBankReconciliation(params.reconciliationId, session.user.id); return NextResponse.json({ ok: true, message: "Conciliação desfeita e saldos restaurados." }); }
  catch (error) { return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Erro ao desfazer." }, { status: 400 }); }
}
