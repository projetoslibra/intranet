import { ConsignadoBankReconciliationPanel } from "@/features/operational/components/ConsignadoBankReconciliationPanel";
import { hasPermission } from "@/lib/permissions";
import { getBankReconciliationWorkspace } from "@/server/operational/consignado-bank-service";
import { loadBankReconciliationView } from "@/server/operational/consignado-bank-overview";
import { getOpenDifferenceOverview } from "@/server/operational/consignado-difference-report";

export const dynamic = "force-dynamic";

export default async function ConsignadoBankReconciliationPage() {
  if (!(await hasPermission("operational.view"))) return <section className="rounded border border-slate-200 bg-white p-6">Sem permissão para visualizar a conciliação.</section>;
  const [canManage, data] = await Promise.all([
    hasPermission("operational.finance.manage"),
    loadBankReconciliationView(
      getBankReconciliationWorkspace,
      getOpenDifferenceOverview,
      (error) => console.error("[consignado-bank-overview] Falha ao carregar badge inicial.", error),
    ),
  ]);
  return <div className="space-y-6"><section className="rounded border border-slate-200 bg-white p-5 shadow-executive"><h1 className="text-lg font-semibold">Conciliação bancária do Consignado</h1><p className="mt-1 text-sm text-slate-500">Entradas Bradesco e remessas relacionadas em qualquer combinação.</p></section><ConsignadoBankReconciliationPanel canManage={canManage} initialWorkspace={data.workspace} openDifferences={data.openDifferences} /></div>;
}
