import type { VopSyncResult } from "@/server/dashboard/vop-snapshots";

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
