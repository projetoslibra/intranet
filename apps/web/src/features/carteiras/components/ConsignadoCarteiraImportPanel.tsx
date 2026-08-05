"use client";

import { FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import { useFormState, useFormStatus } from "react-dom";
import {
  importConsignadoCarteiraAction,
  type ImportConsignadoCarteiraState,
} from "@/app/dashboard/dre/actions";

const initialState: ImportConsignadoCarteiraState = {
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
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
      {pending ? "Importando..." : "Importar carteira"}
    </button>
  );
}

export function ConsignadoCarteiraImportPanel() {
  const [state, formAction] = useFormState(importConsignadoCarteiraAction, initialState);

  return (
    <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded bg-emerald-50 p-2 text-primary">
          <FileSpreadsheet className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-950">Importar carteira do Consignado</h2>
          <p className="mt-1 text-sm text-slate-500">
            Selecione o fechamento contábil CSV da Sinqia. O fundo e a data são identificados automaticamente.
          </p>
        </div>
      </div>

      <form action={formAction} className="grid gap-4 lg:grid-cols-[minmax(280px,1fr)_auto] lg:items-end">
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700" htmlFor="consignadoCarteiraFile">
            Arquivo CSV
          </label>
          <input
            accept=".csv,text/csv"
            className="block h-10 w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-primary"
            id="consignadoCarteiraFile"
            name="file"
            required
            type="file"
          />
          {state.fieldErrors?.file?.[0] ? (
            <p className="text-xs font-medium text-destructive">{state.fieldErrors.file[0]}</p>
          ) : null}
        </div>

        <ImportButton />
      </form>

      {state.message ? (
        <div
          className={`mt-4 rounded border px-3 py-2 text-sm ${
            state.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          <p className="font-medium">{state.message}</p>
          {state.result ? (
            <p className="mt-1 text-xs">
              PL subordinado: R$ {Number(state.result.netAssetValue).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              {" · "}Cota: R$ {Number(state.result.quotaValue).toLocaleString("pt-BR", { minimumFractionDigits: 6 })}
              {" · "}{state.result.importedRows} registros gravados
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

