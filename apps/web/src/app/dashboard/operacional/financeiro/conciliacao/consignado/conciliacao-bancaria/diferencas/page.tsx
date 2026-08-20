import { ConsignadoDifferencesPanel } from "@/features/operational/components/ConsignadoDifferencesPanel";
import { hasPermission } from "@/lib/permissions";
import {
  getDifferenceReport,
  loadInitialDifferenceReport,
} from "@/server/operational/consignado-difference-report";

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

export default async function ConsignadoDifferencesPage({ searchParams }: PageProps) {
  if (!(await hasPermission("operational.view"))) return <section className="rounded border border-slate-200 bg-white p-6">Sem permissão para visualizar diferenças bancárias.</section>;
  const [canManage, initialState] = await Promise.all([
    hasPermission("operational.manage"),
    loadInitialDifferenceReport(queryFrom(searchParams), getDifferenceReport),
  ]);
  return <div className="space-y-6">
    <section className="rounded border border-slate-200 bg-white p-5 shadow-executive"><div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-lg font-semibold">Diferenças e ajustes bancários</h1><p className="mt-1 text-sm text-slate-500">Pendências “Outro” da conciliação do Consignado, com histórico e resolução auditável.</p></div><a className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700" href="/dashboard/operacional/financeiro/conciliacao/consignado/conciliacao-bancaria">Voltar para conciliação</a></div></section>
    <ConsignadoDifferencesPanel canManage={canManage} initialState={initialState} />
  </div>;
}
