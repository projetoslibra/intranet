import { type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { buildExclusionWorkbook, getExclusionExportReport } from "@/server/operational/consignado-exclusion-report";
import {
  EXCLUSION_REPORT_CACHE_CONTROL,
  classifyExclusionReportError,
  parseExclusionReportRequest,
  resolveExclusionReportAccess,
} from "@/server/operational/consignado-exclusion-report-http";

export const runtime = "nodejs";

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET(request: NextRequest) {
  const session = await auth();
  const accessFailure = await resolveExclusionReportAccess(session?.user?.id, hasPermission);
  if (accessFailure) return new Response(accessFailure.message, {
    status: accessFailure.status,
    headers: { "cache-control": EXCLUSION_REPORT_CACHE_CONTROL },
  });
  try {
    const filters = parseExclusionReportRequest(request.nextUrl);
    const workbook = buildExclusionWorkbook(await getExclusionExportReport(filters));
    return new Response(new Uint8Array(workbook), {
      headers: {
        "cache-control": EXCLUSION_REPORT_CACHE_CONTROL,
        "content-disposition": `attachment; filename="titulos-fora-remessa-${todayInSaoPaulo()}.xlsx"`,
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  } catch (error) {
    const failure = classifyExclusionReportError(error);
    if (failure.internal) console.error("[consignado-exclusion-report] Falha na exportação XLSX.", error);
    return new Response(failure.message, {
      status: failure.status,
      headers: { "cache-control": EXCLUSION_REPORT_CACHE_CONTROL },
    });
  }
}
