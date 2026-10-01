import { createReportExportHandler } from "@/server/reports/report-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = createReportExportHandler("open-movements");
