import { FundForm } from "@/components/fund-form";
import { hasPermission } from "@/lib/permissions";

export default async function NewFundPage() {
  const canManage = await hasPermission("funds.manage");

  if (!canManage) {
    return (
      <section className="rounded border border-slate-200 bg-white p-6 shadow-executive">
        <h2 className="text-lg font-semibold text-slate-950">Novo Fundo</h2>
        <p className="mt-2 text-sm text-slate-500">
          Voce nao tem permissao para cadastrar fundos.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded border border-slate-200 bg-white shadow-executive">
      <div className="border-b border-slate-200 px-6 py-5">
        <h2 className="text-lg font-semibold text-slate-950">Novo Fundo</h2>
        <p className="mt-1 text-sm text-slate-500">
          Cadastre as informacoes cadastrais basicas do fundo.
        </p>
      </div>
      <div className="p-6">
        <FundForm />
      </div>
    </section>
  );
}
