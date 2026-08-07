import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { generateSettlementRemittance } from "@/server/operational/consignado-settlement-service";

export async function POST(_request: Request, { params }: { params: { batchId: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 });
  if (!(await hasPermission("operational.finance.manage"))) return NextResponse.json({ ok: false, message: "Sem permissão." }, { status: 403 });
  try { const remittance = await generateSettlementRemittance(params.batchId, session.user.id); return NextResponse.json({ ok: true, remittance, message: "Remessa Daycoval gerada com sucesso." }); }
  catch (error) { return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Erro ao gerar remessa." }, { status: 400 }); }
}
