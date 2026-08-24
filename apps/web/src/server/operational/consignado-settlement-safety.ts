type ExistingFile = { batchId: string; fileName: string; processedAt: Date };

export class DuplicateSettlementFileError extends Error {
  readonly code = "DUPLICATE_SETTLEMENT_FILE";
  readonly existing: ExistingFile;

  constructor(existing: ExistingFile) {
    const processedAt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(existing.processedAt);
    super(`Este arquivo já foi processado pelo OSHER em ${processedAt} como ${existing.fileName}. O reprocessamento foi bloqueado para evitar baixa em duplicidade.`);
    this.name = "DuplicateSettlementFileError";
    this.existing = existing;
  }
}

type IncomingTitle = {
  source: string; originatorCode: string | null; yourNumber: string | null; documentNumber: string | null;
  contractNumber: string | null; installmentNumber: string | null; debtorDocument: string | null; paidAmount: number;
};

export type PreviousRemittanceTitle = {
  id: string; source: string; originatorCode: string | null; yourNumber: string | null; documentNumber: string | null;
  contractNumber: string | null; installmentNumber: string | null; debtorDocument: string | null; amount: number;
  remittanceId: string; remittanceFileName: string; remittanceStatus: string; generatedAt: Date;
};

function clean(value: string | null) { return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function moneyEqual(left: number, right: number) { return Math.abs(left - right) < 0.01; }

export function findPreviouslyRemittedTitle(incoming: IncomingTitle, history: PreviousRemittanceTitle[]) {
  return history.find((candidate) => {
    if (candidate.remittanceStatus === "CANCELLED" || candidate.source !== incoming.source || candidate.originatorCode !== incoming.originatorCode || !moneyEqual(candidate.amount, incoming.paidAmount)) return false;
    if (clean(incoming.yourNumber) && clean(candidate.yourNumber) === clean(incoming.yourNumber)) return true;
    if (clean(incoming.documentNumber) && clean(candidate.documentNumber) === clean(incoming.documentNumber)) return true;
    return Boolean(clean(incoming.contractNumber) && clean(candidate.contractNumber) === clean(incoming.contractNumber)
      && clean(incoming.installmentNumber) && clean(candidate.installmentNumber) === clean(incoming.installmentNumber)
      && clean(incoming.debtorDocument) && clean(candidate.debtorDocument) === clean(incoming.debtorDocument));
  }) ?? null;
}

export class RemittanceDownloadBlockedError extends Error {
  readonly code = "REMITTANCE_DOWNLOAD_BLOCKED";
  constructor(message = "Aguardando conciliação bancária.") { super(message); this.name = "RemittanceDownloadBlockedError"; }
}

export function remittanceDownloadEligibility(input: { status: string; totalAmount: number; allocatedAmount: number; adjustedAmount: number; activeReconciliations: number }) {
  const settled = input.allocatedAmount + input.adjustedAmount;
  const allowed = input.status === "RECONCILED" && input.activeReconciliations > 0 && settled + 0.005 >= input.totalAmount;
  return { allowed, reason: allowed ? null : "Aguardando conciliação bancária." };
}
