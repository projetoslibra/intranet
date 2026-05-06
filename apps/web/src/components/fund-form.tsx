"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { createFundAction, type CreateFundState } from "@/app/dashboard/fundos/novo/actions";

const initialState: CreateFundState = {
  message: "",
};

function formatCnpj(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="h-10 rounded bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
      disabled={pending}
      type="submit"
    >
      {pending ? "Salvando..." : "Salvar Fundo"}
    </button>
  );
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) {
    return null;
  }

  return <p className="text-xs font-medium text-destructive">{errors[0]}</p>;
}

export function FundForm() {
  const [state, formAction] = useFormState(createFundAction, initialState);

  return (
    <form action={formAction} className="space-y-6">
      {state.message ? (
        <p className="rounded border border-destructive/20 bg-red-50 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <label className="text-sm font-medium text-slate-700" htmlFor="name">
            Nome completo
          </label>
          <input
            className="h-10 w-full rounded border border-slate-200 px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            id="name"
            name="name"
            required
          />
          <FieldError errors={state.fieldErrors?.name} />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700" htmlFor="shortName">
            Nome curto
          </label>
          <input
            className="h-10 w-full rounded border border-slate-200 px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            id="shortName"
            name="shortName"
            required
          />
          <FieldError errors={state.fieldErrors?.shortName} />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700" htmlFor="cnpj">
            CNPJ
          </label>
          <input
            className="h-10 w-full rounded border border-slate-200 px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            id="cnpj"
            maxLength={18}
            name="cnpj"
            onChange={(event) => {
              event.currentTarget.value = formatCnpj(event.currentTarget.value);
            }}
            placeholder="00.000.000/0000-00"
            required
          />
          <FieldError errors={state.fieldErrors?.cnpj} />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700" htmlFor="fundType">
            Tipo do fundo
          </label>
          <select
            className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            id="fundType"
            name="fundType"
            required
          >
            <option value="FIDC">FIDC</option>
            <option value="FII">FII</option>
            <option value="FIM">FIM</option>
            <option value="FIA">FIA</option>
          </select>
          <FieldError errors={state.fieldErrors?.fundType} />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700" htmlFor="status">
            Status
          </label>
          <select
            className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            id="status"
            name="status"
            required
          >
            <option value="ACTIVE">Ativo</option>
            <option value="INACTIVE">Inativo</option>
          </select>
          <FieldError errors={state.fieldErrors?.status} />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700" htmlFor="startDate">
            Data de início
          </label>
          <input
            className="h-10 w-full rounded border border-slate-200 px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            id="startDate"
            name="startDate"
            required
            type="date"
          />
          <FieldError errors={state.fieldErrors?.startDate} />
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-5">
        <Link
          className="h-10 rounded border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          href="/dashboard/fundos"
        >
          Cancelar
        </Link>
        <SubmitButton />
      </div>
    </form>
  );
}
