import { hasPermission } from "@/lib/permissions";

export default async function ReportsPage() {
  const canView = await hasPermission("reports.view");

  if (!canView) {
    return (
      <section className="rounded border border-slate-200 bg-white p-6 shadow-executive">
        <h2 className="text-lg font-semibold text-slate-950">Relatorios</h2>
        <p className="mt-2 text-sm text-slate-500">
          Voce nao tem permissao para visualizar relatorios.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded border border-slate-200 bg-white p-6 shadow-executive">
      <h2 className="text-lg font-semibold text-slate-950">Relatorios</h2>
    </section>
  );
}
