import { type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { buildExclusionWorkbook, getExclusionReport, parseExclusionReportFilters } from "@/server/operational/consignado-exclusion-report";

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
  if (!session?.user?.id) return new Response("Sessão expirada.", { status: 401 });
  if (!(await hasPermission("operational.view"))) return new Response("Sem permissão.", { status: 403 });
  try {
    const filters = parseExclusionReportFilters(request.nextUrl.searchParams);
    const workbook = buildExclusionWorkbook(await getExclusionReport(filters));
    return new Response(new Uint8Array(workbook), {
      headers: {
        "content-disposition": `attachment; filename="titulos-fora-remessa-${todayInSaoPaulo()}.xlsx"`,
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Erro ao exportar títulos fora da remessa.", { status: 400 });
  }
}
