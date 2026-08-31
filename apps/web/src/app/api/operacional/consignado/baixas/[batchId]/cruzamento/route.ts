import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { applyCrossMatches, suggestCrossMatches } from "@/server/operational/consignado-cross-match-service";

const applySchema = z.object({ itemIds: z.array(z.string().min(1)).min(1).max(2000) });

async function guard(): Promise<{ error: NextResponse | null; userId: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 }), userId: "" };
  if (!(await hasPermission("operational.finance.manage"))) return { error: NextResponse.json({ ok: false, message: "Sem permissão." }, { status: 403 }), userId: "" };
  return { error: null, userId: session.user.id };
}

export async function GET(request: Request, { params }: { params: { batchId: string } }) {
  const access = await guard();
  if (access.error) return access.error;
  try {
    const result = await suggestCrossMatches(params.batchId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Erro ao cruzar títulos." }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: { params: { batchId: string } }) {
  const access = await guard();
  if (access.error) return access.error;
  try {
    const input = applySchema.parse(await request.json());
    const result = await applyCrossMatches({ userId: access.userId, batchId: params.batchId, itemIds: input.itemIds });
    return NextResponse.json({ ok: true, result, message: `${result.appliedItems} título(s) cruzados e liberados para a remessa.` });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Erro ao aplicar o cruzamento." }, { status: 400 });
  }
}
