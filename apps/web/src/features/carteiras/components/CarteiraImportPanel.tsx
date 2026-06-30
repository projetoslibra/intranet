"use client";

import { Loader2, UploadCloud } from "lucide-react";
import { useFormState, useFormStatus } from "react-dom";
import {
  importCarteirasAction,
  type ImportCarteirasState,
} from "@/app/dashboard/dre/actions";

const initialState: ImportCarteirasState = {
  ok: false,
  message: "",
};

function ImportButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="inline-flex h-10 items-center justify-center gap-2 rounded bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
      disabled={pending}
      type="submit"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <UploadCloud className="h-4 w-4" />
      )}
      {pending ? "Importando..." : "Importar"}
    </button>
  );
}

type CarteiraImportPanelProps = {
  defaultDate: string;
};

export function CarteiraImportPanel({ defaultDate }: CarteiraImportPanelProps) {
  const [state, formAction] = useFormState(importCarteirasAction, initialState);

  return (
    <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
      <form
        action={formAction}
        className="grid gap-4 lg:grid-cols-[220px_auto_1fr] lg:items-end"
      >
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700" htmlFor="dataAnalise">
            Data de análise
          </label>
          <input
            className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            defaultValue={defaultDate}
            id="dataAnalise"
            name="dataAnalise"
            type="date"
          />
          {state.fieldErrors?.dataAnalise?.[0] ? (
            <p className="text-xs font-medium text-destructive">
              {state.fieldErrors.dataAnalise[0]}
            </p>
          ) : null}
        </div>

        <ImportButton />

        {state.message ? (
          <div
            className={`rounded border px-3 py-2 text-sm ${
              state.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            <p className="font-medium">{state.message}</p>
            {state.result ? (
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {state.result.funds.map((fund) => (
                  <span key={fund.fundo}>
                    {fund.fundo}: {fund.upsertedRows} linhas
                    {fund.skippedRows ? `, ${fund.skippedRows} ignoradas` : ""}
                  </span>
                ))}
                {state.caixaResult ? (
                  <span>Caixa: {state.caixaResult.importedRows} linhas</span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </form>
    </section>
  );
}
