import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  DIFFERENCE_REPORT_CACHE_CONTROL,
  classifyDifferenceReportError,
  getDifferenceReport,
  parseDifferenceReportFilters,
  resolveDifferenceReportAccess,
} from "@/server/operational/consignado-difference-report";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await auth();
  const accessFailure = await resolveDifferenceReportAccess(session?.user?.id, "view", hasPermission);
  if (accessFailure) return NextResponse.json({ ok: false, message: accessFailure.message }, {
    status: accessFailure.status,
    headers: { "cache-control": DIFFERENCE_REPORT_CACHE_CONTROL },
  });
  try {
    const filters = parseDifferenceReportFilters(request.nextUrl.searchParams);
    return NextResponse.json({ ok: true, report: await getDifferenceReport(filters) }, {
      headers: { "cache-control": DIFFERENCE_REPORT_CACHE_CONTROL },
    });
  } catch (error) {
    const failure = classifyDifferenceReportError(error);
    if (failure.internal) console.error("[consignado-difference-report] Falha na consulta JSON.", error);
    return NextResponse.json({ ok: false, message: failure.message }, {
      status: failure.status,
      headers: { "cache-control": DIFFERENCE_REPORT_CACHE_CONTROL },
    });
  }
}
