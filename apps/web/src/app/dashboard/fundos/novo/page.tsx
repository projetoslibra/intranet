import { FundForm } from "@/components/fund-form";

export default function NewFundPage() {
  return (
    <section className="rounded border border-slate-200 bg-white shadow-executive">
      <div className="border-b border-slate-200 px-6 py-5">
        <h2 className="text-lg font-semibold text-slate-950">Novo Fundo</h2>
        <p className="mt-1 text-sm text-slate-500">
          Cadastre as informações cadastrais básicas do fundo.
        </p>
      </div>
      <div className="p-6">
        <FundForm />
      </div>
    </section>
  );
}
