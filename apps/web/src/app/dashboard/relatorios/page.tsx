import { ReportsPanel } from "@/features/reports/components/ReportsPanel";
import { getCurrentUserPermissions } from "@/lib/permissions";
import { getReportAvailability } from "@/server/reports/report-data";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const permissions = await getCurrentUserPermissions();
  const canView = permissions.has("reports.view");

  if (!canView) {
    return (
      <section className="rounded border border-slate-200 bg-white p-6 shadow-executive">
        <h1 className="text-lg font-semibold text-slate-950">Relatórios</h1>
        <p className="mt-2 text-sm text-slate-500">
          Você não tem permissão para visualizar relatórios.
        </p>
      </section>
    );
  }

  const availability = await getReportAvailability();

  return (
    <div className="space-y-5">
      <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
        <h1 className="text-lg font-semibold text-slate-950">Relatórios</h1>
        <p className="mt-1 text-sm text-slate-500">
          Selecione uma combinação disponível de fundo e data para gerar uma planilha com os dados da base.
        </p>
      </section>
      <ReportsPanel availability={availability} canExport={permissions.has("reports.export")} />
    </div>
  );
}
