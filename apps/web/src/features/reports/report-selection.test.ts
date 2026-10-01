import assert from "node:assert/strict";
import test from "node:test";
import type { ReportFundAvailability } from "@/server/reports/report-data";
import {
  availableDates,
  availablePeriods,
  reportExportHref,
} from "./report-selection";

const availability: ReportFundAvailability[] = [
  {
    fund: "APUAMA LIBRA FIDC",
    dates: [
      { date: "2026-09-30", periods: ["MANHA", "TARDE"] },
      { date: "2026-09-29", periods: ["MANHA"] },
    ],
  },
  { fund: "BRISTOL FIDC MULTISSETORIAL", dates: [{ date: "2026-09-28", periods: [] }] },
];

test("datas dependem do fundo e períodos dependem também da data", () => {
  assert.deepEqual(availableDates(availability, "APUAMA LIBRA FIDC"), ["2026-09-30", "2026-09-29"]);
  assert.deepEqual(availableDates(availability, "INEXISTENTE"), []);
  assert.deepEqual(availablePeriods(availability, "APUAMA LIBRA FIDC", "2026-09-30"), ["MANHA", "TARDE"]);
  assert.deepEqual(availablePeriods(availability, "APUAMA LIBRA FIDC", "2026-09-29"), ["MANHA"]);
});

test("link de exportação só existe quando todos os filtros obrigatórios foram escolhidos", () => {
  assert.equal(reportExportHref("stock", "APUAMA LIBRA FIDC", ""), null);
  assert.equal(reportExportHref("open-movements", "APUAMA LIBRA FIDC", "2026-09-30"), null);
  assert.equal(
    reportExportHref("settled", "BRISTOL FIDC MULTISSETORIAL", "2026-09-30"),
    "/api/relatorios/liquidados/export?fund=BRISTOL+FIDC+MULTISSETORIAL&date=2026-09-30",
  );
  assert.equal(
    reportExportHref("open-movements", "APUAMA LIBRA FIDC", "2026-09-30", "TARDE"),
    "/api/relatorios/movimentos-em-aberto/export?fund=APUAMA+LIBRA+FIDC&date=2026-09-30&period=TARDE",
  );
});
