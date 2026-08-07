import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getSettlementWorkspace, importSettlementBatch } from "@/server/operational/consignado-settlement-service";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 });
  if (!(await hasPermission("operational.view"))) return NextResponse.json({ ok: false, message: "Sem permissão." }, { status: 403 });
  try { return NextResponse.json({ ok: true, workspace: await getSettlementWorkspace() }); }
  catch (error) { return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Erro ao consultar baixas." }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 });
  if (!(await hasPermission("operational.finance.manage"))) return NextResponse.json({ ok: false, message: "Sem permissão para processar baixas." }, { status: 403 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    const source = String(form.get("source") ?? "").toUpperCase();
    if (!(file instanceof File)) throw new Error("Selecione o arquivo de baixa.");
    if (!(["BMP", "UY3"] as string[]).includes(source)) throw new Error("Selecione BMP ou UY3.");
    if (file.size > 15 * 1024 * 1024) throw new Error("O arquivo de baixa deve possuir no máximo 15 MB.");
    const result = await importSettlementBatch({ userId: session.user.id, source: source as "BMP" | "UY3", originatorCode: String(form.get("originator") ?? ""), fileName: file.name, buffer: Buffer.from(await file.arrayBuffer()) });
    return NextResponse.json({ ok: true, result, message: result.duplicate ? "Este arquivo já foi processado." : "Arquivo processado e confrontado com o estoque ativo." });
  } catch (error) { return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Erro ao processar baixa." }, { status: 400 }); }
}
