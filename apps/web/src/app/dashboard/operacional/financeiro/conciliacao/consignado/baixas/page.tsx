import { ConsignadoSettlementPanel } from "@/features/operational/components/ConsignadoSettlementPanel";
import { hasPermission } from "@/lib/permissions";
import { getSettlementWorkspace } from "@/server/operational/consignado-settlement-service";

export const dynamic = "force-dynamic";

export default async function ConsignadoSettlementsPage() {
  if (!(await hasPermission("operational.view"))) return <section className="rounded border border-slate-200 bg-white p-6">Sem permissão para visualizar baixas.</section>;
  const [canManage, workspace] = await Promise.all([hasPermission("operational.finance.manage"), getSettlementWorkspace()]);
  return <div className="space-y-6"><section className="rounded border border-slate-200 bg-white p-5 shadow-executive"><h1 className="text-lg font-semibold">Baixas e remessas do Consignado</h1><p className="mt-1 text-sm text-slate-500">Processamento diário BMP/UY3, matching, revisão e remessa Daycoval.</p></section><ConsignadoSettlementPanel canManage={canManage} initialWorkspace={workspace} /></div>;
}
