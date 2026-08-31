import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStockCandidateIndex,
  chooseCandidate,
  selectScorableCandidates,
  type MatchableStockCandidate,
} from "./consignado-matching";
import {
  buildPreviousRemittanceIndex,
  findPreviouslyRemittedTitle,
  selectPreviousRemittanceCandidates,
  type IncomingTitle,
  type PreviousRemittanceTitle,
} from "./consignado-settlement-safety";
import type { ParsedSettlementItem } from "./consignado-parsers";

/**
 * Estes testes comparam a busca sobre o pool inteiro com a busca sobre o subconjunto
 * indexado. A função de decisão é a mesma nos dois lados: o que se afirma é que
 * restringir a entrada não altera a saída.
 */

/** Gerador determinístico, para que uma falha seja sempre reproduzível. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const CEDENTS = ["BMP SOCIEDADE DE CREDITO DIRETO S.A", "UY3 SOCIEDADE DE CREDITO DIRETO S.A", "MONEY PLUS SCMEPP LTDA", "OUTRO CEDENTE"];
const NAMES = ["MARIANA ALVES SILVA SIMOES", "JOÃO  DA SILVA", "JOAO DA SILVA", "LIANE DA SILVA CHAGAS", ""];
const DOCUMENTS = ["373.359.578-50", "37335957850", "999.888.777-66", "", "SEM DOCUMENTO"];
const NOMINALS = [41.73, 41.735, 18.56, 99, 0];
const AMOUNTS = ["41.73", "41.735", "18.56", "99", "0"];
const DATES = [new Date("2026-08-23T00:00:00.000Z"), new Date("2026-09-23T00:00:00.000Z"), null];
const NUMBERS = ["463283", "463284", "97031061001", "", null];

function pick<T>(random: () => number, values: T[]): T {
  return values[Math.floor(random() * values.length)];
}

function makeCandidate(random: () => number, id: number): MatchableStockCandidate {
  return {
    id: `pos-${String(id).padStart(4, "0")}`,
    yourNumber: pick(random, NUMBERS),
    documentNumber: pick(random, NUMBERS),
    debtorName: pick(random, NAMES),
    debtorDocument: pick(random, DOCUMENTS),
    cedentName: pick(random, CEDENTS),
    nominalValue: pick(random, NOMINALS),
    originalDueDate: pick(random, DATES),
    adjustedDueDate: pick(random, DATES),
  };
}

function makeItem(random: () => number, row: number): ParsedSettlementItem {
  return {
    sourceRow: row,
    sourceRaw: `linha-${row}`,
    occurrence: pick(random, ["77", "14", "02", ""]),
    contractNumber: pick(random, NUMBERS),
    installmentNumber: pick(random, NUMBERS),
    yourNumber: pick(random, NUMBERS),
    documentNumber: pick(random, NUMBERS),
    debtorName: pick(random, NAMES),
    debtorDocument: pick(random, DOCUMENTS),
    dueDate: pick(random, DATES),
    titleAmount: pick(random, AMOUNTS),
    paidAmount: pick(random, AMOUNTS),
    parseIssue: random() < 0.1 ? "Ocorrência não suportada" : null,
  };
}

test("indice do estoque devolve a mesma decisao que varrer o pool inteiro", () => {
  let compared = 0;
  let decided = 0;
  for (let seed = 1; seed <= 60; seed += 1) {
    const random = makeRandom(seed);
    const candidates = Array.from({ length: 120 }, (_unused, id) => makeCandidate(random, id));
    const items = Array.from({ length: 60 }, (_unused, row) => makeItem(random, row + 1));
    const index = buildStockCandidateIndex(candidates);
    for (const source of ["BMP", "UY3"] as const) {
      items.forEach((item) => {
        const full = chooseCandidate(source, item, candidates);
        const indexed = chooseCandidate(source, item, selectScorableCandidates(index, item));
        assert.deepEqual(indexed, full, `divergencia na seed ${seed}, linha ${item.sourceRow}, fluxo ${source}`);
        compared += 1;
        if (full.candidate) decided += 1;
      });
    }
  }
  assert.ok(compared >= 7000, `poucas comparacoes: ${compared}`);
  assert.ok(decided > 0, "o gerador nunca produziu um casamento; o teste nao estaria exercitando nada");
});

test("indice do estoque preserva NOT_FOUND, AMBIGUOUS e casamento por sinais fracos", () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 60; seed += 1) {
    const random = makeRandom(seed);
    const candidates = Array.from({ length: 120 }, (_unused, id) => makeCandidate(random, id));
    const items = Array.from({ length: 60 }, (_unused, row) => makeItem(random, row + 1));
    const index = buildStockCandidateIndex(candidates);
    items.forEach((item) => {
      const full = chooseCandidate("BMP", item, candidates);
      seen.add(full.status);
      assert.deepEqual(chooseCandidate("BMP", item, selectScorableCandidates(index, item)), full);
    });
  }
  ["NOT_FOUND", "AMBIGUOUS", "FULL_MATCH", "DIVERGENT"].forEach((status) => {
    assert.ok(seen.has(status), `o gerador nunca produziu o status ${status}`);
  });
});

test("casamento apenas pelos quatro sinais fracos continua sendo encontrado pelo indice", () => {
  const item: ParsedSettlementItem = {
    sourceRow: 1, sourceRaw: "linha", occurrence: "77",
    contractNumber: "CONTRATO-SEM-PAR", installmentNumber: null,
    yourNumber: "SEU-NUMERO-SEM-PAR", documentNumber: "DOC-SEM-PAR",
    debtorName: "MARIANA ALVES SILVA SIMOES", debtorDocument: "37335957850",
    dueDate: new Date("2026-08-23T00:00:00.000Z"), titleAmount: "41.73", paidAmount: "41.73", parseIssue: null,
  };
  // Nenhuma chave forte casa: os 60 pontos vêm de documento + nome + valor + vencimento.
  const candidates: MatchableStockCandidate[] = [{
    id: "pos-fraco", yourNumber: "OUTRO", documentNumber: "OUTRO",
    debtorName: "mariana alves silva simoes", debtorDocument: "373.359.578-50",
    cedentName: "BMP SOCIEDADE DE CREDITO DIRETO S.A", nominalValue: 41.73,
    originalDueDate: new Date("2026-08-23T00:00:00.000Z"), adjustedDueDate: null,
  }];
  const full = chooseCandidate("BMP", item, candidates);
  assert.equal(full.status, "FULL_MATCH");
  assert.equal(full.candidate?.id, "pos-fraco");
  const index = buildStockCandidateIndex(candidates);
  assert.deepEqual(chooseCandidate("BMP", item, selectScorableCandidates(index, item)), full);
});

const SOURCES = ["BMP", "UY3"];
const ORIGINATORS = ["GIBB", "JUCA", "BANKERIZE", null];
const STATUSES = ["GENERATED", "RECONCILED", "CANCELLED"];

function makePreviousTitle(random: () => number, id: number): PreviousRemittanceTitle {
  return {
    id: `rem-${id}`,
    source: pick(random, SOURCES),
    originatorCode: pick(random, ORIGINATORS),
    yourNumber: pick(random, NUMBERS),
    documentNumber: pick(random, NUMBERS),
    contractNumber: pick(random, NUMBERS),
    installmentNumber: pick(random, ["001", "002", "", null]),
    debtorDocument: pick(random, DOCUMENTS),
    amount: pick(random, NOMINALS),
    remittanceId: `remessa-${id % 5}`,
    remittanceFileName: `arquivo-${id % 5}.REM`,
    remittanceStatus: pick(random, STATUSES),
    generatedAt: new Date(2026, 0, 1 + (id % 200)),
  };
}

function makeIncoming(random: () => number): IncomingTitle {
  return {
    source: pick(random, SOURCES),
    originatorCode: pick(random, ORIGINATORS),
    yourNumber: pick(random, NUMBERS),
    documentNumber: pick(random, NUMBERS),
    contractNumber: pick(random, NUMBERS),
    installmentNumber: pick(random, ["001", "002", "", null]),
    debtorDocument: pick(random, DOCUMENTS),
    paidAmount: pick(random, NOMINALS),
  };
}

test("indice do historico devolve o mesmo titulo que varrer a lista inteira", () => {
  let compared = 0;
  let found = 0;
  for (let seed = 1; seed <= 60; seed += 1) {
    const random = makeRandom(seed);
    const history = Array.from({ length: 150 }, (_unused, id) => makePreviousTitle(random, id))
      .sort((left, right) => right.generatedAt.getTime() - left.generatedAt.getTime());
    const index = buildPreviousRemittanceIndex(history);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const incoming = makeIncoming(random);
      const full = findPreviouslyRemittedTitle(incoming, history);
      const indexed = findPreviouslyRemittedTitle(incoming, selectPreviousRemittanceCandidates(index, incoming));
      assert.deepEqual(indexed, full, `divergencia na seed ${seed}, tentativa ${attempt}`);
      compared += 1;
      if (full) found += 1;
    }
  }
  assert.ok(compared >= 3500, `poucas comparacoes: ${compared}`);
  assert.ok(found > 0, "o gerador nunca encontrou um titulo ja remetido; o teste nao estaria exercitando nada");
});

test("indice do historico respeita a precedencia por recencia", () => {
  const base = {
    source: "BMP", originatorCode: "GIBB", documentNumber: null, contractNumber: null,
    installmentNumber: null, debtorDocument: null, amount: 100,
    remittanceId: "r", remittanceFileName: "a.REM", remittanceStatus: "GENERATED",
  };
  const history: PreviousRemittanceTitle[] = [
    { ...base, id: "novo", yourNumber: "123", generatedAt: new Date("2026-08-20T00:00:00.000Z") },
    { ...base, id: "antigo", yourNumber: "123", generatedAt: new Date("2026-01-10T00:00:00.000Z") },
  ];
  const incoming: IncomingTitle = {
    source: "BMP", originatorCode: "GIBB", yourNumber: "123", documentNumber: null,
    contractNumber: null, installmentNumber: null, debtorDocument: null, paidAmount: 100,
  };
  const index = buildPreviousRemittanceIndex(history);
  assert.equal(findPreviouslyRemittedTitle(incoming, history)?.id, "novo");
  assert.equal(findPreviouslyRemittedTitle(incoming, selectPreviousRemittanceCandidates(index, incoming))?.id, "novo");
});
