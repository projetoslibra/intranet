import { NextResponse, type NextRequest } from "next/server";
import { FUND_RECONCILIATION_ENABLED } from "./lib/feature-flags";

const fundReconciliationPagePrefix = "/dashboard/operacional/financeiro/conciliacao";
const fundReconciliationApiPrefix = "/api/operacional/consignado";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!FUND_RECONCILIATION_ENABLED && (pathname === fundReconciliationPagePrefix || pathname.startsWith(`${fundReconciliationPagePrefix}/`))) {
    const financeUrl = request.nextUrl.clone();
    financeUrl.pathname = "/dashboard/operacional/financeiro";
    financeUrl.search = "";
    financeUrl.searchParams.set("module", "archived");
    return NextResponse.redirect(financeUrl);
  }

  if (!FUND_RECONCILIATION_ENABLED && (pathname === fundReconciliationApiPrefix || pathname.startsWith(`${fundReconciliationApiPrefix}/`))) {
    return NextResponse.json(
      { ok: false, message: "Módulo de Conciliação de Fundos arquivado temporariamente." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/operacional/financeiro/conciliacao/:path*",
    "/api/operacional/consignado/:path*",
  ],
};
