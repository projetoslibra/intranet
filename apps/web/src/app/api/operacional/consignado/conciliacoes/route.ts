import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createBankReconciliation } from "@/server/operational/consignado-bank-service";

const schema = z.object({ entryIds: z.array(z.string().min(1)).min(1), remittanceIds: z.array(z.string().min(1)).min(1), note: z.string().trim().max(500).optional() });

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 });
  if (!(await hasPermission("operational.finance.manage"))) return NextResponse.json({ ok: false, message: "Sem permissão." }, { status: 403 });
  try { const input = schema.parse(await request.json()); const result = await createBankReconciliation({ userId: session.user.id, ...input }); return NextResponse.json({ ok: true, result, message: "Conciliação registrada." }); }
  catch (error) { return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Erro ao conciliar." }, { status: 400 }); }
}
