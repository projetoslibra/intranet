import { ConsignadoBankReconciliationPanel } from "@/features/operational/components/ConsignadoBankReconciliationPanel";
import { hasPermission } from "@/lib/permissions";
import { getBankReconciliationWorkspace } from "@/server/operational/consignado-bank-service";
import { loadBankReconciliationView } from "@/server/operational/consignado-bank-overview";
import { getOpenDifferenceOverview } from "@/server/operational/consignado-difference-report";
import { getUnsettledOverview } from "@/server/operational/consignado-bank-pendencies";

export const dynamic = "force-dynamic";

export default async function ConsignadoBankReconciliationPage() {
  if (!(await hasPermission("operational.view"))) return <section className="rounded border border-slate-200 bg-white p-6">Sem permissão para visualizar a conciliação.</section>;
  const [canManage, data] = await Promise.all([
    hasPermission("operational.finance.manage"),
    loadBankReconciliationView(
      getBankReconciliationWorkspace,
      getOpenDifferenceOverview,
      (error) => console.error("[consignado-bank-overview] Falha ao carregar badge inicial.", error),
      { load: getUnsettledOverview, onFailure: (error) => console.error("[consignado-bank-pendencies] Falha ao carregar o conciliado sem baixa inicial.", error) },
    ),
  ]);
  return <ConsignadoBankReconciliationPanel canManage={canManage} initialWorkspace={data.workspace} unsettled={data.unsettled} />;
}
