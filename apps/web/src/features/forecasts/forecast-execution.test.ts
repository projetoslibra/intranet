import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedOpenMovementSnapshot,
  forecastImpactDate,
  allocateReversalByNominal,
  resolveForecastItemStatus,
  suggestedForecastName,
  titleMatchesEvidence,
} from "./forecast-execution";

test("baixa D0 impacta o proprio dia da execucao", () => {
  assert.equal(forecastImpactDate("2026-09-30", "D0"), "2026-09-30");
});

test("baixa normal executada na sexta impacta a segunda-feira", () => {
  assert.equal(
    forecastImpactDate("2026-10-02", "NEXT_BUSINESS_DAY"),
    "2026-10-05"
  );
});

test("execucao antes das 13h espera movimentos da tarde do mesmo dia", () => {
  assert.deepEqual(
    expectedOpenMovementSnapshot(new Date("2026-09-30T15:59:00.000Z")),
    { referenceDate: "2026-09-30", period: "TARDE" }
  );
});

test("execucao depois das 13h espera movimentos da manha do proximo dia util", () => {
  assert.deepEqual(
    expectedOpenMovementSnapshot(new Date("2026-10-02T16:01:00.000Z")),
    { referenceDate: "2026-10-05", period: "MANHA" }
  );
});

test("identifica o mesmo titulo por numero, vencimento e valor nominal", () => {
  const planned = {
    documentNumber: " 00123-4 ",
    yourNumber: "ABC-99",
    dueDate: "2026-11-10",
    nominalValue: 1520.45,
  };

  assert.equal(
    titleMatchesEvidence(planned, {
      documentNumber: "001234",
      yourNumber: null,
      dueDate: "2026-11-10",
      nominalValue: 1520.45,
    }),
    true
  );
  assert.equal(
    titleMatchesEvidence(planned, {
      documentNumber: "001234",
      yourNumber: null,
      dueDate: "2026-11-10",
      nominalValue: 1520.46,
    }),
    false
  );
});

test("D0 executada aguarda estoque sem exigir movimento aberto", () => {
  assert.equal(
    resolveForecastItemStatus({
      executed: true,
      foundInOpenMovement: false,
      hasEligibleStockSnapshot: false,
      foundInStock: false,
      mode: "D0",
    }),
    "AWAITING_STOCK"
  );
});

test("baixa normal executada aguarda aparecer em movimentos abertos", () => {
  assert.equal(
    resolveForecastItemStatus({
      executed: true,
      foundInOpenMovement: false,
      hasEligibleStockSnapshot: false,
      foundInStock: false,
      mode: "NEXT_BUSINESS_DAY",
    }),
    "AWAITING_MOVEMENT"
  );
});

test("estoque da data de impacto confirma liquidacao quando titulo sumiu", () => {
  assert.equal(
    resolveForecastItemStatus({
      executed: true,
      foundInOpenMovement: false,
      hasEligibleStockSnapshot: true,
      foundInStock: false,
      mode: "D0",
    }),
    "STOCK_CONFIRMED"
  );
});

test("estoque da data de impacto sinaliza divergencia quando titulo permanece", () => {
  assert.equal(
    resolveForecastItemStatus({
      executed: true,
      foundInOpenMovement: true,
      hasEligibleStockSnapshot: true,
      foundInStock: true,
      mode: "NEXT_BUSINESS_DAY",
    }),
    "DIVERGENT"
  );
});

test("sugere nome em portugues com a proxima versao", () => {
  assert.equal(
    suggestedForecastName("2026-09-30", 2),
    "Fechamento Setembro/2026 — v2"
  );
});

test("distribui a reversao do lote pelo valor nominal dos titulos", () => {
  assert.deepEqual(
    allocateReversalByNominal(
      [
        { id: "a", nominalValue: 100 },
        { id: "b", nominalValue: 300 },
      ],
      80
    ),
    { a: 20, b: 60 }
  );
});
