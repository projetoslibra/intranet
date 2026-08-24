import {
  ExclusionReportInputError,
  ExclusionReportLimitError,
  parseExclusionReportFilters,
  type ExclusionReport,
  type ExclusionReportFilters,
} from "./consignado-exclusion-report";

export type InitialExclusionReportState =
  | { kind: "ready"; report: ExclusionReport; filters: ExclusionReportFilters; message: null }
  | { kind: "recoverable"; report: null; filters: ExclusionReportFilters; message: string };

type ReportLoader = (filters: ExclusionReportFilters) => Promise<ExclusionReport>;

const defaultFilters = () => parseExclusionReportFilters(new URLSearchParams());
const withoutCursor = (filters: ExclusionReportFilters): ExclusionReportFilters => {
  const { cursor: _cursor, ...safeFilters } = filters;
  return safeFilters;
};

export async function loadInitialExclusionReport(
  params: URLSearchParams,
  loadReport: ReportLoader,
): Promise<InitialExclusionReportState> {
  let filters: ExclusionReportFilters;

  try {
    filters = parseExclusionReportFilters(params);
  } catch (error) {
    if (error instanceof ExclusionReportInputError) {
      return { kind: "recoverable", report: null, filters: defaultFilters(), message: error.message };
    }
    throw error;
  }

  try {
    const report = await loadReport(filters);
    return { kind: "ready", report, filters: report.filters, message: null };
  } catch (error) {
    if (error instanceof ExclusionReportInputError || error instanceof ExclusionReportLimitError) {
      return { kind: "recoverable", report: null, filters: withoutCursor(filters), message: error.message };
    }
    throw error;
  }
}
