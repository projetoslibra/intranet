import { NextResponse, type NextRequest } from "next/server";
import {
  syncVopSnapshots,
  type VopSyncResult,
} from "@/server/dashboard/vop-snapshots";

export const runtime = "nodejs";
export const maxDuration = 60;

function extractBearerToken(value: string | null) {
  if (!value) return null;
  return value.startsWith("Bearer ") ? value.slice("Bearer ".length) : value;
}

export function authorizeCronRequest(
  headers: Pick<Headers, "get">,
  expectedSecret: string | undefined
) {
  if (!expectedSecret) {
    return {
      ok: false as const,
      status: 500,
      message: "CRON_SECRET nao configurada no ambiente.",
    };
  }

  const received =
    headers.get("x-osher-api-key") ??
    extractBearerToken(headers.get("authorization"));

  if (received !== expectedSecret) {
    return {
      ok: false as const,
      status: 401,
      message: "Token invalido para gerar snapshots de VOP.",
    };
  }

  return { ok: true as const };
}

export function statusForVopSync(result: VopSyncResult) {
  return result.ok ? 200 : 207;
}

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
