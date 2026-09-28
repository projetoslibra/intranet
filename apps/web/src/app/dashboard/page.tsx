import { DashboardKpis } from "@/features/dashboard/components/DashboardKpis";
import { FundOverviewTable } from "@/features/dashboard/components/FundOverviewTable";
import { hasPermission } from "@/lib/permissions";
import { loadDashboardOverview } from "@/server/dashboard/dashboard-data";

export default async function DashboardPage() {
  const canView = await hasPermission("dashboard.view");

  if (!canView) {
    return (
      <section className="rounded border border-slate-200 bg-white p-6 shadow-executive">
        <h2 className="text-lg font-semibold text-slate-950">Dashboard</h2>
        <p className="mt-2 text-sm text-slate-500">
          Você não tem permissão para visualizar o dashboard.
        </p>
      </section>
    );
  }

  const overview = await loadDashboardOverview();

  if (overview.activeFundCount === 0) {
    return (
      <section className="rounded border border-slate-200 bg-white p-6 shadow-executive">
        <h2 className="text-lg font-semibold text-slate-950">Dashboard</h2>
        <p className="mt-2 text-sm text-slate-500">
          Nenhum fundo está habilitado para exibir o dashboard.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <DashboardKpis overview={overview} />
      <FundOverviewTable funds={overview.funds} />
    </div>
  );
}
