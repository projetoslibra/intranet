import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getBankReconciliationWorkspace, importBradescoStatement } from "@/server/operational/consignado-bank-service";
import { loadBankReconciliationView } from "@/server/operational/consignado-bank-overview";
import { getOpenDifferenceOverview } from "@/server/operational/consignado-difference-report";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 });
  if (!(await hasPermission("operational.view"))) return NextResponse.json({ ok: false, message: "Sem permissão." }, { status: 403 });
  try {
    const result = await loadBankReconciliationView(
      () => getBankReconciliationWorkspace({ transactionDate: request.nextUrl.searchParams.get("transactionDate") || undefined }),
      getOpenDifferenceOverview,
      (error) => console.error("[consignado-bank-overview] Falha ao atualizar badge.", error),
    );
    return NextResponse.json({ ok: true, ...result });
  }
  catch (error) { return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Erro ao consultar conciliação." }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 });
  if (!(await hasPermission("operational.finance.manage"))) return NextResponse.json({ ok: false, message: "Sem permissão." }, { status: 403 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Selecione o CSV do extrato Bradesco.");
    if (file.size > 10 * 1024 * 1024) throw new Error("O extrato deve possuir no máximo 10 MB.");
    const result = await importBradescoStatement({ userId: session.user.id, fileName: file.name, buffer: Buffer.from(await file.arrayBuffer()) });
    return NextResponse.json({ ok: true, result, message: result.duplicateFile ? "Este extrato já havia sido importado." : `${result.importedRows} entradas novas, ${result.duplicateRows} repetidas e ${result.ignoredRows} ignoradas.` });
  } catch (error) { return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Erro ao importar extrato." }, { status: 400 }); }
}
