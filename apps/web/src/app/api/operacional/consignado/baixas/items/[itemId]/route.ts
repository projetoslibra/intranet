import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { correctSettlementItem, setSettlementItemDecision } from "@/server/operational/consignado-settlement-service";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CORRECT"), replacementPositionId: z.string().min(1), justification: z.string().trim().min(5).max(500) }),
  z.object({ action: z.literal("EXCLUDE"), reason: z.string().trim().min(3).max(500).optional() }),
  z.object({ action: z.literal("APPROVE") }),
]);

export async function PATCH(request: NextRequest, { params }: { params: { itemId: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 });
  if (!(await hasPermission("operational.finance.manage"))) return NextResponse.json({ ok: false, message: "Sem permissão." }, { status: 403 });
  try {
    const input = schema.parse(await request.json());
    if (input.action === "CORRECT") await correctSettlementItem({ userId: session.user.id, itemId: params.itemId, replacementPositionId: input.replacementPositionId, justification: input.justification });
    else await setSettlementItemDecision({ userId: session.user.id, itemId: params.itemId, action: input.action, reason: "reason" in input ? input.reason : undefined });
    return NextResponse.json({ ok: true, message: input.action === "CORRECT" ? "Título substituído e auditado." : "Decisão salva." });
  } catch (error) { return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Erro ao salvar decisão." }, { status: 400 }); }
}
