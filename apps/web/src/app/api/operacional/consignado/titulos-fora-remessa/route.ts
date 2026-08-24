import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getExclusionReport } from "@/server/operational/consignado-exclusion-report";
import {
  EXCLUSION_REPORT_CACHE_CONTROL,
  classifyExclusionReportError,
  parseExclusionReportRequest,
  resolveExclusionReportAccess,
} from "@/server/operational/consignado-exclusion-report-http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await auth();
  const accessFailure = await resolveExclusionReportAccess(session?.user?.id, hasPermission);
  if (accessFailure) return NextResponse.json({ ok: false, message: accessFailure.message }, {
    status: accessFailure.status,
    headers: { "cache-control": EXCLUSION_REPORT_CACHE_CONTROL },
  });
  try {
    const filters = parseExclusionReportRequest(request.nextUrl);
    return NextResponse.json({ ok: true, report: await getExclusionReport(filters) }, {
      headers: { "cache-control": EXCLUSION_REPORT_CACHE_CONTROL },
    });
  } catch (error) {
    const failure = classifyExclusionReportError(error);
    if (failure.internal) console.error("[consignado-exclusion-report] Falha na consulta JSON.", error);
    return NextResponse.json({ ok: false, message: failure.message }, {
      status: failure.status,
      headers: { "cache-control": EXCLUSION_REPORT_CACHE_CONTROL },
    });
  }
}
