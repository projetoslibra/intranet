"use client";

import { useRef, useState, type FormEvent } from "react";
import { Loader2, RefreshCw, UploadCloud } from "lucide-react";

type ImportResponse = {
  ok: boolean;
  message: string;
  result?: {
    importedRows: number;
    totalRows: number;
    errorRows: number;
    unmatchedRows?: number;
    referenceDate?: string;
    fundName?: string;
  };
};

type OperationalImportPanelProps = {
  title: string;
  description: string;
  endpoint: string;
  fileField?: boolean;
  dateField?: {
    name: string;
    label: string;
    defaultValue: string;
    required?: boolean;
  };
  submitLabel: string;
};

export function OperationalImportPanel({
  title,
  description,
  endpoint,
  fileField = true,
  dateField,
  submitLabel,
}: OperationalImportPanelProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<ImportResponse | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setState(null);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: new FormData(event.currentTarget),
      });
      const payload = (await response.json()) as ImportResponse;
      setState(payload);

      if (payload.ok) {
        formRef.current?.reset();
      }
    } catch {
      setState({ ok: false, message: "Não foi possível importar o arquivo." });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
      <div>
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>

      <form className="mt-5 grid gap-4" onSubmit={submit} ref={formRef}>
        {dateField ? (
          <label className="space-y-2 text-sm font-medium text-slate-700">
            <span>{dateField.label}</span>
            <input
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              defaultValue={dateField.defaultValue}
              name={dateField.name}
              required={dateField.required}
              type="date"
            />
          </label>
        ) : null}

        {fileField ? (
          <label className="space-y-2 text-sm font-medium text-slate-700">
            <span>Arquivo</span>
            <input
              accept=".xlsx"
              className="block w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm file:mr-4 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
              name="file"
              required
              type="file"
            />
          </label>
        ) : null}

        <button
          className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
          disabled={pending}
          type="submit"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : fileField ? (
            <UploadCloud className="h-4 w-4" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {pending ? "Importando..." : submitLabel}
        </button>

        {state ? (
          <div
            className={`rounded border px-3 py-2 text-sm ${
              state.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            <p className="font-medium">{state.message}</p>
            {state.result ? (
              <p className="mt-1 text-xs">
                {state.result.importedRows} de {state.result.totalRows} linhas importadas
                {state.result.errorRows ? ` · ${state.result.errorRows} pendências` : ""}
                {state.result.fundName ? ` · ${state.result.fundName}` : ""}
                {state.result.referenceDate ? ` · ${state.result.referenceDate}` : ""}
              </p>
            ) : null}
          </div>
        ) : null}
      </form>
    </section>
  );
}
