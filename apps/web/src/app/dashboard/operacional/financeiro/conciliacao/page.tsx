import Link from "next/link";
import { ArrowRight, Landmark } from "lucide-react";
import { hasPermission } from "@/lib/permissions";

const funds = [
  { name: "Consignado", description: "Operação diária, remessas e conciliações.", enabled: true },
  { name: "Antena", description: "Conciliação financeira do fundo.", enabled: false },
  { name: "Apuama", description: "Conciliação financeira do fundo.", enabled: false },
  { name: "Bristol", description: "Conciliação financeira do fundo.", enabled: false },
];

export default async function FundReconciliationPage() {
  if (!(await hasPermission("operational.view"))) {
    return <section className="rounded border border-slate-200 bg-white p-6">Sem permissão para visualizar o módulo operacional.</section>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
        <h2 className="text-base font-semibold text-slate-950">Conciliação de Fundos</h2>
        <p className="mt-1 text-sm text-slate-500">Acompanhe entradas, baixas e pendências operacionais por fundo.</p>
      </section>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {funds.map((fund) =>
          fund.enabled ? (
            <Link className="group rounded border border-slate-200 bg-white p-5 shadow-executive transition hover:border-primary/40" href="/dashboard/operacional/financeiro/conciliacao/consignado" key={fund.name}>
              <div className="flex items-center justify-between"><Landmark className="h-5 w-5 text-primary" /><ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-1" /></div>
              <h3 className="mt-4 font-semibold text-slate-950">{fund.name}</h3><p className="mt-1 text-sm text-slate-500">{fund.description}</p>
            </Link>
          ) : (
            <div className="rounded border border-slate-200 bg-white p-5 opacity-70 shadow-executive" key={fund.name}>
              <Landmark className="h-5 w-5 text-slate-400" /><h3 className="mt-4 font-semibold text-slate-950">{fund.name}</h3><p className="mt-1 text-sm text-slate-500">{fund.description}</p><span className="mt-4 inline-block rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">Em breve</span>
            </div>
          )
        )}
      </div>
    </div>
  );
}
