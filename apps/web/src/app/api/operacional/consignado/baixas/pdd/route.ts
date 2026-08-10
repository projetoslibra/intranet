import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { importConsignadoPddHistory } from "@/server/operational/consignado-pdd-service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 });
  if (!(await hasPermission("operational.finance.manage"))) return NextResponse.json({ ok: false, message: "Sem permissão para importar a base PDD." }, { status: 403 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Selecione a planilha consolidada de PDD.");
    if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("A base histórica de PDD deve ser uma planilha XLSX.");
    if (file.size > 15 * 1024 * 1024) throw new Error("A planilha PDD deve possuir no máximo 15 MB.");
    const result = await importConsignadoPddHistory({ userId: session.user.id, fileName: file.name, buffer: Buffer.from(await file.arrayBuffer()) });
    const message = result.duplicateFile
      ? "Esta planilha PDD já havia sido importada; nenhum registro foi duplicado."
      : `${result.import.importedRows.toLocaleString("pt-BR")} títulos PDD importados. ${result.reclassification.recovered.toLocaleString("pt-BR")} não encontrados foram reclassificados como recuperação de PDD.`;
    return NextResponse.json({ ok: true, result, message });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Erro ao importar a base PDD." }, { status: 400 });
  }
}
