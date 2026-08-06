"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { upload } from "@vercel/blob/client";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Loader2,
  RefreshCw,
  UploadCloud,
} from "lucide-react";
import type { ConsignadoStockBatchView } from "@/server/operational/consignado-stock-service";

type Props = {
  canManage: boolean;
  initialBatches: ConsignadoStockBatchView[];
};

type Feedback = { kind: "success" | "error" | "info"; message: string } | null;

const statusLabels: Record<ConsignadoStockBatchView["status"], string> = {
  PENDING: "Na fila",
  PROCESSING: "Processando",
  COMPLETED: "Concluído",
  FAILED: "Falhou",
};

function formatDate(value: string | null) {
  if (!value) return "A identificar";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatCurrency(value: string | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(value ?? 0)
  );
}

function formatFileSize(value: number | null) {
  if (!value) return "—";
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function safeFileName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "-");
}

export function ConsignadoStockPanel({ canManage, initialBatches }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [batches, setBatches] = useState(initialBatches);
  const [pending, setPending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [now, setNow] = useState(0);

  const hasRunningBatch = batches.some((batch) =>
    ["PENDING", "PROCESSING"].includes(batch.status)
  );
  const activeBatch = useMemo(
    () => batches.find((batch) => batch.isActive && batch.status === "COMPLETED") ?? null,
    [batches]
  );

  async function refreshHistory() {
    const response = await fetch("/api/operacional/consignado/estoques", { cache: "no-store" });
    const payload = (await response.json()) as {
      ok: boolean;
      message?: string;
      batches?: ConsignadoStockBatchView[];
    };
    if (payload.ok && payload.batches) {
      setBatches(payload.batches);
      return;
    }
    throw new Error(payload.message ?? "Não foi possível atualizar o histórico.");
  }

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!hasRunningBatch) return;
    const timer = window.setInterval(() => void refreshHistory().catch(() => undefined), 3_000);
    return () => window.clearInterval(timer);
  }, [hasRunningBatch]);

  async function startProcessing(batchId: string) {
    setBatches((current) =>
      current.map((batch) =>
        batch.id === batchId
          ? { ...batch, status: "PROCESSING", progressRows: 0, errorMessage: null }
          : batch
      )
    );
    void fetch(`/api/operacional/consignado/estoques/${batchId}/process`, {
      method: "POST",
    }).finally(() => void refreshHistory().catch(() => undefined));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setFeedback({ kind: "error", message: "Selecione um arquivo .xlsx." });
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setFeedback({ kind: "error", message: "O arquivo deve possuir no máximo 50 MB." });
      return;
    }

    setPending(true);
    setFeedback(null);
    setUploadProgress(0);
    try {
      setStage("Calculando identificação segura do arquivo...");
      const fileHash = await sha256(file);
      setStage("Enviando para o armazenamento privado...");
      const pathname = `operacional/consignado/estoques/${Date.now()}-${safeFileName(file.name)}`;
      const blob = await upload(pathname, file, {
        access: "private",
        handleUploadUrl: "/api/operacional/consignado/estoques/upload",
        onUploadProgress: ({ percentage }) => setUploadProgress(Math.round(percentage)),
      });

      setStage("Registrando lote no OSHER...");
      const response = await fetch("/api/operacional/consignado/estoques", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          fileHash,
          fileSize: file.size,
          storageKey: blob.pathname,
        }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        message: string;
        result?: { batchId: string; duplicate: boolean };
      };
      if (!payload.ok || !payload.result) {
        throw new Error(payload.message);
      }

      await refreshHistory();
      if (payload.result.duplicate) {
        setFeedback({ kind: "info", message: payload.message });
      } else {
        setFeedback({
          kind: "success",
          message: "Upload concluído. O estoque está sendo processado em segundo plano.",
        });
        await startProcessing(payload.result.batchId);
      }
      inputRef.current.value = "";
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Não foi possível enviar o estoque.",
      });
    } finally {
      setPending(false);
      setStage("");
    }
  }

  async function activate(batchId: string) {
    if (!window.confirm("Ativar esta versão para a data e substituir a versão atualmente ativa?")) {
      return;
    }
    const response = await fetch(`/api/operacional/consignado/estoques/${batchId}/activate`, {
      method: "POST",
    });
    const payload = (await response.json()) as { ok: boolean; message: string };
    setFeedback({ kind: payload.ok ? "success" : "error", message: payload.message });
    await refreshHistory();
  }

  return (
    <div className="space-y-6">
      <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Estoque vigente</h2>
            <p className="mt-1 text-sm text-slate-500">
              Snapshot utilizado nos próximos processamentos de baixa do Consignado.
            </p>
          </div>
          {activeBatch ? (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              Ativo em {formatDate(activeBatch.referenceDate)}
            </span>
          ) : null}
        </div>

        {activeBatch ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Posições</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">
                {activeBatch.importedRows.toLocaleString("pt-BR")}
              </p>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Valor nominal</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">
                {formatCurrency(activeBatch.summary?.totalNominalValue)}
              </p>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Valor presente</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">
                {formatCurrency(activeBatch.summary?.totalPresentValue)}
              </p>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Versão</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">v{activeBatch.version}</p>
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
            Nenhum estoque manual do Consignado foi ativado ainda.
          </div>
        )}
      </section>

      {canManage ? (
        <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
          <h2 className="text-base font-semibold text-slate-950">Importar novo estoque</h2>
          <p className="mt-1 text-sm text-slate-500">
            O fundo e a data serão identificados durante o processamento. O arquivo original fica privado.
          </p>
          <form className="mt-5 space-y-4" onSubmit={submit}>
            <input
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="block w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm file:mr-4 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold"
              disabled={pending}
              ref={inputRef}
              required
              type="file"
            />
            {pending ? (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-slate-600">
                  <span>{stage}</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            ) : null}
            <button
              className="inline-flex h-10 items-center gap-2 rounded bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              disabled={pending}
              type="submit"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              {pending ? "Enviando..." : "Importar estoque"}
            </button>
          </form>
          {feedback ? (
            <div
              className={`mt-4 rounded border px-3 py-2 text-sm ${
                feedback.kind === "error"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : feedback.kind === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-blue-200 bg-blue-50 text-blue-800"
              }`}
            >
              {feedback.message}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="overflow-hidden rounded border border-slate-200 bg-white shadow-executive">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Histórico de estoques</h2>
            <p className="mt-1 text-sm text-slate-500">Versões, processamento e composição por cedente.</p>
          </div>
          <button
            className="inline-flex h-9 items-center gap-2 rounded border border-slate-200 px-3 text-sm font-medium text-slate-700"
            onClick={() => void refreshHistory()}
            type="button"
          >
            <RefreshCw className="h-4 w-4" /> Atualizar
          </button>
        </div>

        {batches.length ? (
          <div className="divide-y divide-slate-200">
            {batches.map((batch) => {
              const progress = batch.totalRows
                ? Math.min(100, Math.round((batch.progressRows / batch.totalRows) * 100))
                : 0;
              return (
                <details className="group p-5" key={batch.id}>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-slate-100">
                        {batch.status === "COMPLETED" ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : batch.status === "FAILED" ? (
                          <AlertTriangle className="h-4 w-4 text-red-600" />
                        ) : batch.status === "PROCESSING" ? (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        ) : (
                          <Database className="h-4 w-4 text-slate-500" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-950">{batch.fileName}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatDate(batch.referenceDate)} · v{batch.version} · {formatFileSize(batch.fileSize)} · {batch.importedBy}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {batch.isActive ? (
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Ativo</span>
                      ) : null}
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                        {statusLabels[batch.status]}
                      </span>
                    </div>
                  </summary>

                  <div className="mt-4 space-y-4 pl-12">
                    {batch.status === "PROCESSING" || batch.status === "PENDING" ? (
                      <div>
                        <div className="mb-1 flex justify-between text-xs text-slate-500">
                          <span>{batch.progressRows.toLocaleString("pt-BR")} de {batch.totalRows.toLocaleString("pt-BR")} linhas</span>
                          <span>{progress}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    ) : null}

                    <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <div><span className="text-slate-500">Linhas:</span> <strong>{batch.importedRows.toLocaleString("pt-BR")}</strong></div>
                      <div><span className="text-slate-500">Enviado:</span> <strong>{formatDateTime(batch.createdAt)}</strong></div>
                      <div><span className="text-slate-500">Valor nominal:</span> <strong>{formatCurrency(batch.summary?.totalNominalValue)}</strong></div>
                      <div><span className="text-slate-500">Alertas:</span> <strong>{batch.warningRows.toLocaleString("pt-BR")}</strong></div>
                    </div>

                    {batch.errorMessage ? (
                      <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{batch.errorMessage}</p>
                    ) : null}

                    {batch.summary?.cedents?.length ? (
                      <div className="overflow-x-auto rounded border border-slate-200">
                        <table className="min-w-full text-left text-xs">
                          <thead className="bg-slate-50 text-slate-500">
                            <tr><th className="px-3 py-2">Cedente</th><th className="px-3 py-2 text-right">Títulos</th><th className="px-3 py-2 text-right">Valor nominal</th></tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {batch.summary.cedents.map((cedent) => (
                              <tr key={cedent.name}><td className="px-3 py-2">{cedent.name}</td><td className="px-3 py-2 text-right">{cedent.count.toLocaleString("pt-BR")}</td><td className="px-3 py-2 text-right">{formatCurrency(cedent.nominalValue)}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}

                    {canManage && batch.status === "FAILED" ? (
                      <button className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold" onClick={() => void startProcessing(batch.id)} type="button">Tentar novamente</button>
                    ) : null}
                    {canManage && batch.status === "PENDING" ? (
                      <button className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold" onClick={() => void startProcessing(batch.id)} type="button">Iniciar processamento</button>
                    ) : null}
                    {canManage &&
                    batch.status === "PROCESSING" &&
                    batch.startedAt &&
                    now > 0 &&
                    now - new Date(batch.startedAt).getTime() > 6 * 60 * 1_000 ? (
                      <button className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800" onClick={() => void startProcessing(batch.id)} type="button">Retomar processamento</button>
                    ) : null}
                    {canManage && batch.status === "COMPLETED" && !batch.isActive ? (
                      <button className="rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground" onClick={() => void activate(batch.id)} type="button">Ativar esta versão</button>
                    ) : null}
                  </div>
                </details>
              );
            })}
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-slate-500">Nenhum estoque importado.</div>
        )}
      </section>
    </div>
  );
}
