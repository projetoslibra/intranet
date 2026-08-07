import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  approveUnderpaid77InBulk,
  BULK_UNDERPAID_LIMIT_PERCENT,
} from "@/server/operational/consignado-settlement-service";

export async function POST(
  request: Request,
  { params }: { params: { batchId: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 });
  }
  if (!(await hasPermission("operational.finance.manage"))) {
    return NextResponse.json({ ok: false, message: "Sem permissão." }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({})) as { mode?: string };
    if (body.mode !== "UP_TO_10" && body.mode !== "GROUPED_DEBTOR") {
      throw new Error("Selecione uma faixa válida para liberação em lote.");
    }
    const result = await approveUnderpaid77InBulk({
      userId: session.user.id,
      batchId: params.batchId,
      mode: body.mode,
    });
    return NextResponse.json({
      ok: true,
      result,
      message: body.mode === "UP_TO_10"
        ? `${result.approvedItems} títulos com diferença de até ${BULK_UNDERPAID_LIMIT_PERCENT}% foram liberados.`
        : `${result.approvedItems} títulos acima de 10% de sacados recorrentes foram liberados.`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Erro ao liberar antecipações.",
      },
      { status: 400 }
    );
  }
}
