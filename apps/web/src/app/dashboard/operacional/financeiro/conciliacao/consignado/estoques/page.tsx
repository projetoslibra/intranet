import { ConsignadoStockPanel } from "@/features/operational/components/ConsignadoStockPanel";
import { hasPermission } from "@/lib/permissions";
import { getConsignadoStockHistory } from "@/server/operational/consignado-stock-service";

export const dynamic = "force-dynamic";

export default async function ConsignadoStocksPage() {
  const canView = await hasPermission("operational.view");
  if (!canView) {
    return <section className="rounded border border-slate-200 bg-white p-6">Sem permissão para visualizar os estoques.</section>;
  }
  const [canManage, batches] = await Promise.all([
    hasPermission("operational.stock.import"),
    getConsignadoStockHistory(),
  ]);
  return (
    <div className="space-y-6">
      <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
        <h1 className="text-lg font-semibold text-slate-950">Estoques do Consignado</h1>
        <p className="mt-1 text-sm text-slate-500">Importe o estoque diário e acompanhe todas as versões históricas.</p>
      </section>
      <ConsignadoStockPanel canManage={canManage} initialBatches={batches} />
    </div>
  );
}
