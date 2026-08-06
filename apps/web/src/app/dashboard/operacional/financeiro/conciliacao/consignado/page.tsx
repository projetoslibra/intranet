import Link from "next/link";
import { ArrowRight, Database, FileCheck2, Landmark } from "lucide-react";
import { hasPermission } from "@/lib/permissions";

export default async function ConsignadoOperationPage() {
  if (!(await hasPermission("operational.view"))) {
    return <section className="rounded border border-slate-200 bg-white p-6">Sem permissão para visualizar o módulo operacional.</section>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
        <h2 className="text-base font-semibold text-slate-950">Operação do Consignado</h2>
        <p className="mt-1 text-sm text-slate-500">Base operacional para estoques, baixas e conciliações do fundo.</p>
      </section>
      <div className="grid gap-4 md:grid-cols-3">
        <Link className="group rounded border border-slate-200 bg-white p-5 shadow-executive transition hover:border-primary/40" href="/dashboard/operacional/financeiro/conciliacao/consignado/estoques">
          <div className="flex justify-between"><Database className="h-5 w-5 text-primary" /><ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-1" /></div><h3 className="mt-4 font-semibold">Estoques</h3><p className="mt-1 text-sm text-slate-500">Importação manual, versões e histórico.</p>
        </Link>
        <div className="rounded border border-slate-200 bg-white p-5 opacity-70 shadow-executive"><FileCheck2 className="h-5 w-5 text-slate-400" /><h3 className="mt-4 font-semibold">Baixas e remessas</h3><p className="mt-1 text-sm text-slate-500">Próxima etapa do desenvolvimento.</p></div>
        <div className="rounded border border-slate-200 bg-white p-5 opacity-70 shadow-executive"><Landmark className="h-5 w-5 text-slate-400" /><h3 className="mt-4 font-semibold">Conciliação bancária</h3><p className="mt-1 text-sm text-slate-500">Próxima etapa do desenvolvimento.</p></div>
      </div>
    </div>
  );
}
