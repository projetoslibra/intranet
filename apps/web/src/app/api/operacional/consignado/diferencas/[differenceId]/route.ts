import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  DIFFERENCE_REPORT_CACHE_CONTROL,
  classifyDifferenceReportError,
  differenceResolutionSchema,
  resolveDifferenceReportAccess,
  resolveOtherDifference,
} from "@/server/operational/consignado-difference-report";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: { differenceId: string } }) {
  const session = await auth();
  const accessFailure = await resolveDifferenceReportAccess(session?.user?.id, "manage", hasPermission);
  if (accessFailure) return NextResponse.json({ ok: false, message: accessFailure.message }, {
    status: accessFailure.status,
    headers: { "cache-control": DIFFERENCE_REPORT_CACHE_CONTROL },
  });
  try {
    const input = differenceResolutionSchema.parse(await request.json());
    const result = await resolveOtherDifference(params.differenceId, session!.user!.id!, input.resolutionNote);
    return NextResponse.json({ ok: true, result, message: "Diferença resolvida e auditada." }, {
      headers: { "cache-control": DIFFERENCE_REPORT_CACHE_CONTROL },
    });
  } catch (error) {
    const failure = classifyDifferenceReportError(error);
    if (failure.internal) console.error("[consignado-difference-report] Falha ao resolver pendência.", error);
    return NextResponse.json({ ok: false, message: failure.message }, {
      status: failure.status,
      headers: { "cache-control": DIFFERENCE_REPORT_CACHE_CONTROL },
    });
  }
}
