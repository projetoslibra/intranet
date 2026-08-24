import {
  ExclusionReportInputError,
  ExclusionReportLimitError,
  parseExclusionReportFilters,
} from "./consignado-exclusion-report";

export const EXCLUSION_REPORT_CACHE_CONTROL = "private, no-store, max-age=0";

export function exclusionReportAccessFailure(userId: string | null | undefined, canView: boolean) {
  if (!userId) return { status: 401, message: "Sessão expirada." } as const;
  if (!canView) return { status: 403, message: "Sem permissão." } as const;
  return null;
}

export async function resolveExclusionReportAccess(
  userId: string | null | undefined,
  checkPermission: (permission: "operational.view") => Promise<boolean>,
) {
  if (!userId) return exclusionReportAccessFailure(userId, false);
  return exclusionReportAccessFailure(userId, await checkPermission("operational.view"));
}

export function classifyExclusionReportError(error: unknown) {
  if (error instanceof ExclusionReportInputError) return { status: 400, message: error.message, internal: false } as const;
  if (error instanceof ExclusionReportLimitError) return { status: 422, message: error.message, internal: false } as const;
  return { status: 500, message: "Erro interno ao processar títulos fora da remessa.", internal: true } as const;
}

export function parseExclusionReportRequest(url: Pick<URL, "searchParams">) {
  return parseExclusionReportFilters(url.searchParams);
}
