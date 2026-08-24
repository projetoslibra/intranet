import { type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  DIFFERENCE_REPORT_CACHE_CONTROL,
  buildDifferenceWorkbook,
  classifyDifferenceReportError,
  getDifferenceExportReport,
  parseDifferenceReportFilters,
  resolveDifferenceReportAccess,
} from "@/server/operational/consignado-difference-report";

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
  const accessFailure = await resolveDifferenceReportAccess(session?.user?.id, "view", hasPermission);
  if (accessFailure) return new Response(accessFailure.message, {
    status: accessFailure.status,
    headers: { "cache-control": DIFFERENCE_REPORT_CACHE_CONTROL },
  });
  try {
    const filters = parseDifferenceReportFilters(request.nextUrl.searchParams);
    const workbook = buildDifferenceWorkbook(await getDifferenceExportReport(filters));
    return new Response(new Uint8Array(workbook), {
      headers: {
        "cache-control": DIFFERENCE_REPORT_CACHE_CONTROL,
        "content-disposition": `attachment; filename="diferencas-bancarias-${todayInSaoPaulo()}.xlsx"`,
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  } catch (error) {
    const failure = classifyDifferenceReportError(error);
    if (failure.internal) console.error("[consignado-difference-report] Falha na exportação XLSX.", error);
    return new Response(failure.message, {
      status: failure.status,
      headers: { "cache-control": DIFFERENCE_REPORT_CACHE_CONTROL },
    });
  }
}
