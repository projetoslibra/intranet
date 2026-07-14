"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Loader2, RefreshCw, UploadCloud } from "lucide-react";
import * as XLSX from "xlsx";

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
  detectStockMetadata?: boolean;
  dateField?: {
    name: string;
    label: string;
    defaultValue: string;
    required?: boolean;
  };
  submitLabel: string;
};

type DetectedMeta = {
  fundName: string | null;
  referenceDate: string | null;
  fileName: string | null;
  error: string | null;
};

function formatDetectedDate(value: string | null) {
  if (!value) {
    return null;
  }

  const [year, month, day] = value.split("-");
  if (!year || !month || !day) {
    return value;
  }

  return `${day}/${month}/${year}`;
}

function normalizeDateValue(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d))
        .toISOString()
        .slice(0, 10);
    }
  }

  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }

  const brMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brMatch) {
    return new Date(
      Date.UTC(Number(brMatch[3]), Number(brMatch[2]) - 1, Number(brMatch[1]))
    )
      .toISOString()
      .slice(0, 10);
  }

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

export function OperationalImportPanel({
  title,
  description,
  endpoint,
  fileField = true,
  detectStockMetadata = false,
  dateField,
  submitLabel,
}: OperationalImportPanelProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<ImportResponse | null>(null);
  const [detectedMeta, setDetectedMeta] = useState<DetectedMeta | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!detectStockMetadata) {
      return;
    }

    if (!file) {
      setDetectedMeta(null);
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { cellDates: true, type: "array" });
      const firstSheet = workbook.SheetNames[0];

      if (!firstSheet) {
        throw new Error("missing-sheet");
      }

      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets[firstSheet],
        { defval: null, raw: true }
      );
      const firstRow = rows.find((row) =>
        Object.values(row).some((value) => String(value ?? "").trim())
      );

      if (!firstRow) {
        throw new Error("empty-sheet");
      }

      setDetectedMeta({
        fileName: file.name,
        fundName: String(firstRow.NOME_FUNDO ?? "").trim() || null,
        referenceDate: normalizeDateValue(firstRow.DATA_REFERENCIA),
        error: null,
      });
    } catch {
      setDetectedMeta({
        fileName: file.name,
        fundName: null,
        referenceDate: null,
        error: "Não foi possível identificar fundo e data deste arquivo.",
      });
    }
  }

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
        setDetectedMeta(null);
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
              onChange={handleFileChange}
              required
              type="file"
            />
          </label>
        ) : null}

        {detectStockMetadata ? (
          <div className="rounded border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
            <p className="font-medium text-slate-800">
              O sistema identifica automaticamente o fundo e a data pelo arquivo.
            </p>
            {detectedMeta?.error ? (
              <p className="mt-2 text-red-700">{detectedMeta.error}</p>
            ) : detectedMeta ? (
              <div className="mt-2 space-y-1 text-slate-600">
                <p>
                  Arquivo: <span className="font-medium text-slate-900">{detectedMeta.fileName}</span>
                </p>
                <p>
                  Fundo detectado:{" "}
                  <span className="font-medium text-slate-900">
                    {detectedMeta.fundName ?? "Não identificado"}
                  </span>
                </p>
                <p>
                  Data detectada:{" "}
                  <span className="font-medium text-slate-900">
                    {formatDetectedDate(detectedMeta.referenceDate) ?? "Não identificada"}
                  </span>
                </p>
              </div>
            ) : (
              <p className="mt-2 text-slate-500">
                Selecione a planilha para visualizar o fundo e a data antes de importar.
              </p>
            )}
          </div>
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
