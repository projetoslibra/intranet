import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getSettlementWorkspace, importSettlementBatchFromBlob } from "@/server/operational/consignado-settlement-service";
import type { SettlementUploadMetadata } from "@/features/operational/consignado-settlement-upload";
import { DuplicateSettlementFileError } from "@/server/operational/consignado-settlement-safety";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 });
  if (!(await hasPermission("operational.view"))) return NextResponse.json({ ok: false, message: "Sem permissão." }, { status: 403 });
  try { return NextResponse.json({ ok: true, workspace: await getSettlementWorkspace({ createdDate: request.nextUrl.searchParams.get("createdDate") || undefined }) }); }
  catch (error) { return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Erro ao consultar baixas." }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 });
  if (!(await hasPermission("operational.finance.manage"))) return NextResponse.json({ ok: false, message: "Sem permissão para processar baixas." }, { status: 403 });
  try {
    const input = (await request.json()) as SettlementUploadMetadata;
    const result = await importSettlementBatchFromBlob({
      userId: session.user.id,
      ...input,
    });
    return NextResponse.json({ ok: true, result, message: "Arquivo processado e confrontado com o estoque ativo." });
  } catch (error) { return NextResponse.json({ ok: false, code: error instanceof DuplicateSettlementFileError ? error.code : undefined, message: error instanceof Error ? error.message : "Erro ao processar baixa." }, { status: error instanceof DuplicateSettlementFileError ? 409 : 400 }); }
}
