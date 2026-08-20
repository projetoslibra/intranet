import { ConsignadoExcludedTitlesPanel } from "@/features/operational/components/ConsignadoExcludedTitlesPanel";
import { hasPermission } from "@/lib/permissions";
import { getExclusionReport, parseExclusionReportFilters } from "@/server/operational/consignado-exclusion-report";

export const dynamic = "force-dynamic";

type PageProps = { searchParams?: Record<string, string | string[] | undefined> };

function queryFrom(searchParams: PageProps["searchParams"]) {
  const params = new URLSearchParams();
  Object.entries(searchParams ?? {}).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else if (value) params.set(key, value);
  });
  return params;
}

export default async function ConsignadoExcludedTitlesPage({ searchParams }: PageProps) {
  if (!(await hasPermission("operational.view"))) return <section className="rounded border border-slate-200 bg-white p-6">Sem permissão para visualizar títulos fora da remessa.</section>;
  const report = await getExclusionReport(parseExclusionReportFilters(queryFrom(searchParams)));
  return <div className="space-y-6">
    <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-lg font-semibold">Títulos fora da remessa</h1><p className="mt-1 text-sm text-slate-500">Consulta auditável dos títulos não enviados e de seu uso na conciliação bancária.</p></div>
        <a className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700" href="/dashboard/operacional/financeiro/conciliacao/consignado/baixas">Voltar para baixas</a>
      </div>
    </section>
    <ConsignadoExcludedTitlesPanel initialReport={report} />
  </div>;
}
