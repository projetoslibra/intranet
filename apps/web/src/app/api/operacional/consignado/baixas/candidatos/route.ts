import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { searchStockCandidates } from "@/server/operational/consignado-settlement-service";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 });
  if (!(await hasPermission("operational.finance.manage"))) return NextResponse.json({ ok: false, message: "Sem permissão." }, { status: 403 });
  try {
    const batchId = request.nextUrl.searchParams.get("batchId") ?? "";
    const query = request.nextUrl.searchParams.get("q") ?? "";
    if (!batchId || query.trim().length < 2) throw new Error("Informe ao menos dois caracteres para pesquisar.");
    return NextResponse.json({ ok: true, candidates: await searchStockCandidates(batchId, query) });
  } catch (error) { return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Erro ao pesquisar." }, { status: 400 }); }
}
