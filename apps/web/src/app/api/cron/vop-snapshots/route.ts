import { NextResponse, type NextRequest } from "next/server";
import { syncVopSnapshots } from "@/server/dashboard/vop-snapshots";
import { authorizeCronRequest, statusForVopSync } from "./route-logic";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authorization = authorizeCronRequest(
    request.headers,
    process.env.CRON_SECRET
  );
  if (!authorization.ok) {
    return NextResponse.json(
      { ok: false, message: authorization.message },
      { status: authorization.status }
    );
  }

  try {
    const result = await syncVopSnapshots();
    return NextResponse.json(result, { status: statusForVopSync(result) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro desconhecido ao gerar VOP.";
    console.error(`[VOP Cron] Falha geral: ${message}`);
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
