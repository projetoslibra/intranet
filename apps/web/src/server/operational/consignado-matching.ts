import type { OperationalFlowSource, Prisma } from "@prisma/client";
import type { ParsedSettlementItem } from "./consignado-parsers";

/**
 * Decisão de matching do estoque, isolada do acesso a banco para permitir teste
 * diferencial: o índice abaixo reduz o conjunto pontuado sem alterar a pontuação.
 */

export type MatchableStockCandidate = {
  id: string;
  yourNumber: string | null;
  documentNumber: string | null;
  debtorName: string;
  debtorDocument: string;
  cedentName: string;
  nominalValue: Prisma.Decimal | number | string;
  originalDueDate: Date | null;
  adjustedDueDate: Date | null;
};

export function digits(value: unknown) { return String(value ?? "").replace(/\D/g, ""); }
export function normalized(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase().replace(/\s+/g, " ");
}
export function sameMoney(left: unknown, right: unknown) { return Math.abs(Number(left) - Number(right)) < 0.01; }
export function dateKey(value: Date | null | undefined) { return value?.toISOString().slice(0, 10) ?? null; }

export function sourceMatches(source: OperationalFlowSource, candidate: Pick<MatchableStockCandidate, "cedentName">) {
  const cedent = normalized(candidate.cedentName);
  return source === "UY3" ? cedent.includes("UY3") : cedent.includes("BMP") || cedent.includes("MONEY PLUS");
}

export function chooseCandidate<T extends MatchableStockCandidate>(source: OperationalFlowSource, item: ParsedSettlementItem, candidates: T[]) {
  if (item.parseIssue) return { status: "DIVERGENT" as const, reason: item.parseIssue, candidate: null };
  const ranked = candidates
    .filter((candidate) => sourceMatches(source, candidate))
    .map((candidate) => {
      let score = 0;
      if (item.yourNumber && candidate.yourNumber === item.yourNumber) score += 120;
      if (item.documentNumber && candidate.documentNumber === item.documentNumber) score += 70;
      if (item.contractNumber && candidate.documentNumber === item.contractNumber) score += 60;
      if (item.debtorDocument && digits(candidate.debtorDocument) === digits(item.debtorDocument)) score += 25;
      if (item.debtorName && normalized(candidate.debtorName) === normalized(item.debtorName)) score += 15;
      if (sameMoney(candidate.nominalValue, item.titleAmount)) score += 15;
      if (item.dueDate && dateKey(candidate.adjustedDueDate ?? candidate.originalDueDate) === dateKey(item.dueDate)) score += 5;
      return { candidate, score };
    })
    .filter((entry) => entry.score >= 60)
    .sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id));
  if (!ranked.length) return { status: "NOT_FOUND" as const, reason: "Título não encontrado no estoque ativo.", candidate: null };
  const top = ranked[0];
  if (ranked[1]?.score === top.score) return { status: "AMBIGUOUS" as const, reason: `${ranked.filter((entry) => entry.score === top.score).length} candidatos equivalentes.`, candidate: null };

  const nominal = Number(top.candidate.nominalValue);
  const paid = Number(item.paidAmount);
  if (item.occurrence === "14") {
    if (!(paid > 0 && paid < nominal)) return { status: "DIVERGENT" as const, reason: "Ocorrência 14 exige valor pago positivo e menor que o valor de face do estoque.", candidate: top.candidate };
    return { status: "PARTIAL_MATCH" as const, reason: null, candidate: top.candidate };
  }
  if (item.occurrence !== "77") return { status: "DIVERGENT" as const, reason: "Ocorrência diferente de 14 ou 77.", candidate: top.candidate };
  if (!sameMoney(paid, nominal) && paid < nominal) return { status: "DIVERGENT" as const, reason: "Ocorrência 77 com valor pago inferior ao valor de face.", candidate: top.candidate };
  return { status: "FULL_MATCH" as const, reason: null, candidate: top.candidate };
}

/**
 * Índice do pool de candidatos.
 *
 * A pontuação acima só alcança o corte de 60 por quatro caminhos: `yourNumber` (120),
 * `documentNumber` (70), `contractNumber` contra `documentNumber` (60), ou os quatro
 * sinais fracos somados — documento (25) + nome (15) + valor (15) + vencimento (5).
 * Qualquer candidato capaz de passar no corte aparece, portanto, em pelo menos um dos
 * três baldes abaixo, e restringir a pontuação a essa união não altera o resultado.
 */
export type StockCandidateIndex<T> = {
  byYourNumber: Map<string, T[]>;
  byDocumentNumber: Map<string, T[]>;
  byDebtorDocument: Map<string, T[]>;
};

function push<T>(bucket: Map<string, T[]>, key: string, value: T) {
  const current = bucket.get(key);
  if (current) current.push(value);
  else bucket.set(key, [value]);
}

export function buildStockCandidateIndex<T extends MatchableStockCandidate>(candidates: T[]): StockCandidateIndex<T> {
  const index: StockCandidateIndex<T> = { byYourNumber: new Map(), byDocumentNumber: new Map(), byDebtorDocument: new Map() };
  candidates.forEach((candidate) => {
    if (candidate.yourNumber) push(index.byYourNumber, candidate.yourNumber, candidate);
    if (candidate.documentNumber) push(index.byDocumentNumber, candidate.documentNumber, candidate);
    // O documento entra sempre, inclusive com chave vazia: `digits` de um texto sem
    // dígitos resulta em "" dos dois lados, e a pontuação trata isso como igualdade.
    push(index.byDebtorDocument, digits(candidate.debtorDocument), candidate);
  });
  return index;
}

export function selectScorableCandidates<T extends MatchableStockCandidate>(
  index: StockCandidateIndex<T>,
  item: Pick<ParsedSettlementItem, "yourNumber" | "documentNumber" | "contractNumber" | "debtorDocument">,
): T[] {
  const seen = new Set<string>();
  const selected: T[] = [];
  const collect = (candidates: T[] | undefined) => {
    candidates?.forEach((candidate) => {
      if (seen.has(candidate.id)) return;
      seen.add(candidate.id);
      selected.push(candidate);
    });
  };
  if (item.yourNumber) collect(index.byYourNumber.get(item.yourNumber));
  if (item.documentNumber) collect(index.byDocumentNumber.get(item.documentNumber));
  if (item.contractNumber) collect(index.byDocumentNumber.get(item.contractNumber));
  if (item.debtorDocument) collect(index.byDebtorDocument.get(digits(item.debtorDocument)));
  return selected;
}
