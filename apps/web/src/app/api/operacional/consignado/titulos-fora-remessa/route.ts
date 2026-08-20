import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getExclusionReport, parseExclusionReportFilters } from "@/server/operational/consignado-exclusion-report";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, message: "Sessão expirada." }, { status: 401 });
  if (!(await hasPermission("operational.view"))) return NextResponse.json({ ok: false, message: "Sem permissão." }, { status: 403 });
  try {
    const filters = parseExclusionReportFilters(request.nextUrl.searchParams);
    return NextResponse.json({ ok: true, report: await getExclusionReport(filters) });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Erro ao consultar títulos fora da remessa." }, { status: 400 });
  }
}
