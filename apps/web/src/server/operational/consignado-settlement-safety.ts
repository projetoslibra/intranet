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

export type IncomingTitle = {
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

/**
 * Índice do histórico de remessas.
 *
 * `findPreviouslyRemittedTitle` devolve o primeiro item do array que satisfaz o
 * predicado, e o array chega ordenado da remessa mais recente para a mais antiga.
 * Todo candidato capaz de satisfazer o predicado casa por `yourNumber`,
 * `documentNumber` ou pela trinca contrato/parcela/documento — logo aparece em pelo
 * menos um dos baldes. A seleção devolve esse subconjunto na ordem original do array,
 * de modo que rodar o mesmo predicado sobre ele encontra exatamente o mesmo item.
 */
type IndexedPreviousTitle = { position: number; title: PreviousRemittanceTitle };

export type PreviousRemittanceIndex = {
  byYourNumber: Map<string, IndexedPreviousTitle[]>;
  byDocumentNumber: Map<string, IndexedPreviousTitle[]>;
  byContractTriple: Map<string, IndexedPreviousTitle[]>;
};

function pushIndexed(bucket: Map<string, IndexedPreviousTitle[]>, key: string, value: IndexedPreviousTitle) {
  const current = bucket.get(key);
  if (current) current.push(value);
  else bucket.set(key, [value]);
}

function contractTripleKey(contractNumber: string | null, installmentNumber: string | null, debtorDocument: string | null) {
  const contract = clean(contractNumber);
  const installment = clean(installmentNumber);
  const document = clean(debtorDocument);
  return contract && installment && document ? `${contract}|${installment}|${document}` : null;
}

export function buildPreviousRemittanceIndex(history: PreviousRemittanceTitle[]): PreviousRemittanceIndex {
  const index: PreviousRemittanceIndex = { byYourNumber: new Map(), byDocumentNumber: new Map(), byContractTriple: new Map() };
  history.forEach((title, position) => {
    const entry = { position, title };
    const yourNumber = clean(title.yourNumber);
    if (yourNumber) pushIndexed(index.byYourNumber, yourNumber, entry);
    const documentNumber = clean(title.documentNumber);
    if (documentNumber) pushIndexed(index.byDocumentNumber, documentNumber, entry);
    const triple = contractTripleKey(title.contractNumber, title.installmentNumber, title.debtorDocument);
    if (triple) pushIndexed(index.byContractTriple, triple, entry);
  });
  return index;
}

export function selectPreviousRemittanceCandidates(index: PreviousRemittanceIndex, incoming: IncomingTitle): PreviousRemittanceTitle[] {
  const seen = new Set<number>();
  const entries: IndexedPreviousTitle[] = [];
  const collect = (candidates: IndexedPreviousTitle[] | undefined) => {
    candidates?.forEach((entry) => {
      if (seen.has(entry.position)) return;
      seen.add(entry.position);
      entries.push(entry);
    });
  };
  const yourNumber = clean(incoming.yourNumber);
  if (yourNumber) collect(index.byYourNumber.get(yourNumber));
  const documentNumber = clean(incoming.documentNumber);
  if (documentNumber) collect(index.byDocumentNumber.get(documentNumber));
  const triple = contractTripleKey(incoming.contractNumber, incoming.installmentNumber, incoming.debtorDocument);
  if (triple) collect(index.byContractTriple.get(triple));
  return entries.sort((left, right) => left.position - right.position).map((entry) => entry.title);
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

export function assertRemittanceCancellationAllowed(input: { status: string; activeReconciliations: number }) {
  if (input.status === "CANCELLED") throw new Error("Esta remessa já foi cancelada.");
  if (input.activeReconciliations > 0 || input.status === "RECONCILED") throw new Error("Esta remessa possui conciliação ativa. Desfaça a conciliação antes de cancelar.");
}
