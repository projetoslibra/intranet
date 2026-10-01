import type { NextRequest } from "next/server";
import {
  buildReportWorkbook,
  classifyReportExportError,
  parseReportExportFilters,
  resolveReportExportAccess,
  type ReportExportFilters,
  type ReportType,
} from "./report-export";
import { getReportRows } from "./report-data";

export const REPORT_EXPORT_CACHE_CONTROL = "private, no-store, max-age=0";
const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type ExportSession = { user?: { id?: string | null } } | null;
type ExportRows = Array<Record<string, unknown>>;

type ReportExportDependencies = {
  authenticate: () => Promise<ExportSession>;
  checkPermission: (permission: "reports.export") => Promise<boolean>;
  loadRows: (type: ReportType, filters: ReportExportFilters) => Promise<ExportRows>;
  buildWorkbook: (type: ReportType, rows: ExportRows) => Buffer;
  logError: (error: unknown) => void;
};

async function defaultAuthenticate() {
  const { auth } = await import("@/lib/auth");
  return auth();
}

async function defaultCheckPermission(permission: "reports.export") {
  const { hasPermission } = await import("@/lib/permissions");
  return hasPermission(permission);
}

const defaultDependencies: ReportExportDependencies = {
  authenticate: defaultAuthenticate,
  checkPermission: defaultCheckPermission,
  loadRows: getReportRows,
  buildWorkbook: buildReportWorkbook,
  logError: (error) => console.error("[reports-export] Falha ao gerar XLSX.", error),
};

function slug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function fileName(type: ReportType, filters: ReportExportFilters) {
  const report = type === "stock" ? "estoque" : type === "settled" ? "liquidados" : "movimentos-em-aberto";
  const period = filters.period ? `-${filters.period.toLowerCase()}` : "";
  return `${report}-${slug(filters.fund)}-${filters.date}${period}.xlsx`;
}

function textResponse(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { "cache-control": REPORT_EXPORT_CACHE_CONTROL },
  });
}

export function createReportExportHandler(
  type: ReportType,
  dependencies: Partial<ReportExportDependencies> = {},
) {
  const deps = { ...defaultDependencies, ...dependencies };

  return async function GET(request: NextRequest) {
    try {
      const session = await deps.authenticate();
      const accessFailure = await resolveReportExportAccess(
        session?.user?.id,
        deps.checkPermission,
      );
      if (accessFailure) return textResponse(accessFailure.message, accessFailure.status);

      const filters = parseReportExportFilters(type, request.nextUrl.searchParams);
      const rows = await deps.loadRows(type, filters);
      const workbook = deps.buildWorkbook(type, rows);
      return new Response(new Uint8Array(workbook), {
        headers: {
          "cache-control": REPORT_EXPORT_CACHE_CONTROL,
          "content-disposition": `attachment; filename="${fileName(type, filters)}"`,
          "content-type": XLSX_CONTENT_TYPE,
        },
      });
    } catch (error) {
      const failure = classifyReportExportError(error);
      if (failure.internal) deps.logError(error);
      return textResponse(failure.message, failure.status);
    }
  };
}
