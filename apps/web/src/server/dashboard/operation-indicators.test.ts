import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  calculateOperationIndicators,
  weightedAverageFromComponents,
} from "./operation-indicators";

const decimal = (value: string) => new Prisma.Decimal(value);

test("pondera prazo e converte cada taxa anual para mensal antes da média", () => {
  const result = calculateOperationIndicators([
    {
      acquisitionValue: decimal("100"),
      termDays: 30,
      annualAssignmentRate: decimal("0.12682503013196977"),
    },
    {
      acquisitionValue: decimal("300"),
      termDays: 90,
      annualAssignmentRate: decimal("0.2682417945625455"),
    },
  ]);

  assert.equal(result.status, "ready");
  assert.equal(result.amount.toFixed(2), "400.00");
  assert.equal(result.operationCount, 2);
  assert.equal(result.termWeightedValue?.toFixed(2), "30000.00");
  assert.equal(result.termWeightAmount?.toFixed(2), "400.00");
  assert.equal(result.monthlyRateWeightedValue?.toFixed(8), "7.00000000");
  assert.equal(result.monthlyRateWeightAmount?.toFixed(2), "400.00");
  assert.equal(
    result.monthlyRateWeightedValue
      ?.dividedBy(result.monthlyRateWeightAmount!)
      .toFixed(6),
    "0.017500"
  );
});

test("peso zero preserva o VOP zero e produz indicadores indisponíveis", () => {
  const result = calculateOperationIndicators([
    {
      acquisitionValue: decimal("0"),
      termDays: null,
      annualAssignmentRate: null,
    },
  ]);

  assert.equal(result.status, "empty");
  assert.equal(result.amount.toFixed(2), "0.00");
  assert.equal(result.operationCount, 1);
  assert.equal(result.termWeightedValue, null);
  assert.equal(result.monthlyRateWeightedValue, null);
});

test("recusa peso negativo em vez de distorcer as médias", () => {
  const result = calculateOperationIndicators([
    {
      acquisitionValue: decimal("-10"),
      termDays: 30,
      annualAssignmentRate: decimal("0.20"),
    },
  ]);

  assert.equal(result.status, "invalid");
  assert.match(result.issue ?? "", /valor de aquisição negativo/i);
});

test("recusa prazo ou taxa ausente quando existe peso positivo", () => {
  const missingTerm = calculateOperationIndicators([
    {
      acquisitionValue: decimal("100"),
      termDays: null,
      annualAssignmentRate: decimal("0.20"),
    },
  ]);
  const missingRate = calculateOperationIndicators([
    {
      acquisitionValue: decimal("100"),
      termDays: 30,
      annualAssignmentRate: null,
    },
  ]);

  assert.equal(missingTerm.status, "invalid");
  assert.match(missingTerm.issue ?? "", /prazo ausente/i);
  assert.equal(missingRate.status, "invalid");
  assert.match(missingRate.issue ?? "", /taxa de cessão ausente/i);
});

test("recusa taxa anual menor ou igual a menos cem por cento", () => {
  const result = calculateOperationIndicators([
    {
      acquisitionValue: decimal("100"),
      termDays: 30,
      annualAssignmentRate: decimal("-1"),
    },
  ]);

  assert.equal(result.status, "invalid");
  assert.match(result.issue ?? "", /taxa de cessão inválida/i);
});

test("recusa prazo negativo como erro de qualidade", () => {
  const result = calculateOperationIndicators([
    {
      acquisitionValue: decimal("100"),
      termDays: -1,
      annualAssignmentRate: decimal("0.20"),
    },
  ]);

  assert.equal(result.status, "invalid");
  assert.match(result.issue ?? "", /prazo inválido/i);
});

test("consolida snapshots somando componentes em vez de fazer média de médias", () => {
  const average = weightedAverageFromComponents([
    { weightedValue: decimal("3000"), weightAmount: decimal("100") },
    { weightedValue: decimal("18000"), weightAmount: decimal("200") },
  ]);

  assert.equal(average?.toFixed(2), "70.00");
});
