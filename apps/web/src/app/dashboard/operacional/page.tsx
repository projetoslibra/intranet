import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, Landmark } from "lucide-react";
import { hasPermission } from "@/lib/permissions";

export default async function OperacionalPage() {
  const canView = await hasPermission("operational.view");

  if (!canView) {
    return (
      <section className="rounded border border-slate-200 bg-white p-6 shadow-executive">
        <h2 className="text-lg font-semibold text-slate-950">Operacional</h2>
        <p className="mt-2 text-sm text-slate-500">
          Você não tem permissão para visualizar o módulo operacional.
        </p>
      </section>
    );
  }

  const links = [
    {
      title: "Financeiro",
      description: "Lançamento de caixa, upload de estoque e atualização da DIM cedentes.",
      href: "/dashboard/operacional/financeiro",
      icon: Landmark,
    },
    {
      title: "Mesa de Operações",
      description: "Caixa dos fundos, enquadramento por estoque e visão de risco.",
      href: "/dashboard/operacional/mesa",
      icon: BriefcaseBusiness,
    },
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {links.map((item) => {
        const Icon = item.icon;

        return (
          <Link
            className="group rounded border border-slate-200 bg-white p-6 shadow-executive transition hover:border-primary/40 hover:shadow-lg"
            href={item.href}
            key={item.href}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded bg-slate-100 text-slate-700">
                <Icon className="h-5 w-5" />
              </div>
              <ArrowRight className="h-5 w-5 text-slate-400 transition group-hover:translate-x-1 group-hover:text-primary" />
            </div>
            <h2 className="mt-5 text-lg font-semibold text-slate-950">{item.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">{item.description}</p>
          </Link>
        );
      })}
    </div>
  );
}
