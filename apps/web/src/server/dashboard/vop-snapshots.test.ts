import assert from "node:assert/strict";
import test from "node:test";
import {
  isStablePosition,
  loadFundVopSummary,
  monthBounds,
  resolveVopFundKey,
  syncVopSnapshots,
  vopStockWhere,
  type NewVopSnapshot,
  type StockOperation,
  type VopSnapshotRepository,
} from "./vop-snapshots";

const apuamaDate = new Date("2026-09-21T00:00:00.000Z");
const now = new Date("2026-09-22T18:30:00.000Z");

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function completeSnapshot(input: {
  fundId: string;
  referenceDate: Date;
  amount: string;
}): NewVopSnapshot {
  return {
    ...input,
    operationCount: 1,
    termWeightedValue: "3000",
    termWeightAmount: input.amount,
    monthlyRateWeightedValue: "1",
    monthlyRateWeightAmount: input.amount,
    indicatorsLastAttemptedAt: now,
    indicatorsCalculatedAt: now,
  };
}

function operation(
  acquisitionValue: string,
  termDays = 30,
  annualAssignmentRate = "0.12682503013196977"
): StockOperation {
  return { acquisitionValue, termDays, annualAssignmentRate };
}

function fakeRepository(input?: {
  existing?: NewVopSnapshot[];
  latestByFund?: Record<string, Date | null>;
  positionsByFund?: Record<
    string,
    Array<{ referenceDate: Date; latestCreatedAt: Date }>
  >;
  operations?: Record<string, StockOperation[]>;
  latestCreatedAtByFundDate?: Record<string, Date | null>;
}) {
  const snapshots = [...(input?.existing ?? [])];
  const repository: VopSnapshotRepository = {
    listActiveFunds: async () => [
      { id: "apuama", name: "APUAMA LIBRA FIDC", shortName: "APUAMA" },
      { id: "bristol", name: "BRISTOL FIDC", shortName: "BRISTOL" },
      { id: "consignado", name: "CONSIGNADO", shortName: "CONSIGNADO" },
    ],
    findLatestStockReferenceDate: async (fundKey) =>
      input?.latestByFund?.[fundKey] ?? null,
    listStockPositions: async (fundKey) =>
      input?.positionsByFund?.[fundKey] ?? [],
    listExistingSnapshots: async (fundId, start, end) =>
      snapshots.filter(
        (snapshot) =>
          snapshot.fundId === fundId &&
          snapshot.referenceDate >= start &&
          snapshot.referenceDate <= end
      ),
    listPendingSnapshots: async (fundId, limit) =>
      snapshots
        .filter(
          (snapshot) =>
            snapshot.fundId === fundId &&
            snapshot.indicatorsCalculatedAt === null
        )
        .sort((left, right) => {
          const leftAttempt = left.indicatorsLastAttemptedAt?.getTime() ?? -1;
          const rightAttempt = right.indicatorsLastAttemptedAt?.getTime() ?? -1;
          return leftAttempt - rightAttempt || right.referenceDate.getTime() - left.referenceDate.getTime();
        })
        .slice(0, limit),
    findStockPositionLatestCreatedAt: async (fundKey, referenceDate) => {
      const key = `${fundKey}:${dateKey(referenceDate)}`;
      if (key in (input?.latestCreatedAtByFundDate ?? {})) {
        return input?.latestCreatedAtByFundDate?.[key] ?? null;
      }
      return new Date(referenceDate.getTime() + 15 * 60 * 60 * 1000);
    },
    loadStockOperations: async (fundKey, referenceDate) =>
      input?.operations?.[`${fundKey}:${dateKey(referenceDate)}`] ?? [],
    createSnapshots: async (rows) => {
      for (const row of rows) {
        const exists = snapshots.some(
          (snapshot) =>
            snapshot.fundId === row.fundId &&
            dateKey(snapshot.referenceDate) === dateKey(row.referenceDate)
        );
        if (!exists) snapshots.push(row);
      }
    },
    completeSnapshotIndicatorsOnce: async (fundId, referenceDate, values) => {
      const snapshot = snapshots.find(
        (row) =>
          row.fundId === fundId &&
          dateKey(row.referenceDate) === dateKey(referenceDate)
      );
      if (!snapshot || snapshot.indicatorsCalculatedAt !== null) return false;
      Object.assign(snapshot, values);
      return true;
    },
    markSnapshotIndicatorsAttempt: async (fundId, referenceDate, attemptedAt) => {
      const snapshot = snapshots.find(
        (row) => row.fundId === fundId && dateKey(row.referenceDate) === dateKey(referenceDate)
      );
      if (snapshot && snapshot.indicatorsCalculatedAt === null) {
        snapshot.indicatorsLastAttemptedAt = attemptedAt;
      }
    },
    findLatestSnapshot: async () => null,
    sumSnapshots: async () => "0",
  };

  return { repository, snapshots };
}

test("identifica somente os fundos VOP suportados", () => {
  assert.equal(resolveVopFundKey("Apuamá Libra FIDC", "APUAMA"), "APUAMA");
  assert.equal(resolveVopFundKey("Bristol Fundo", "BRISTOL FIDC"), "BRISTOL");
  assert.equal(resolveVopFundKey("Consignado", "CONSIGNADO"), null);
});

test("calcula os limites UTC do mês da posição", () => {
  assert.deepEqual(monthBounds(apuamaDate), {
    start: new Date("2026-09-01T00:00:00.000Z"),
    end: new Date("2026-09-30T23:59:59.999Z"),
  });
});

test("considera estável a posição sem inserções nos últimos dez minutos", () => {
  assert.equal(isStablePosition(new Date("2026-09-22T18:20:00.000Z"), now), true);
  assert.equal(isStablePosition(new Date("2026-09-22T18:20:00.001Z"), now), false);
});

test("a consulta exige aquisição e referência na mesma data", () => {
  assert.deepEqual(vopStockWhere("APUAMA", apuamaDate), {
    nomeFundo: { contains: "APUAMA", mode: "insensitive" },
    dataReferencia: apuamaDate,
    dataAquisicao: apuamaDate,
  });
});

test("cria snapshot novo com VOP e componentes ponderados", async () => {
  const { repository, snapshots } = fakeRepository({
    latestByFund: { APUAMA: apuamaDate },
    positionsByFund: {
      APUAMA: [{ referenceDate: apuamaDate, latestCreatedAt: new Date("2026-09-21T15:00:00.000Z") }],
    },
    operations: {
      "APUAMA:2026-09-21": [operation("100", 30), operation("300", 90)],
    },
  });

  const result = await syncVopSnapshots({ now, repository });

  assert.equal(result.ok, true);
  assert.equal(snapshots[0]?.amount, "400");
  assert.equal(snapshots[0]?.operationCount, 2);
  assert.equal(snapshots[0]?.termWeightedValue, "30000");
  assert.equal(snapshots[0]?.termWeightAmount, "400");
  assert.equal(snapshots[0]?.monthlyRateWeightAmount, "400");
  assert.equal(snapshots[0]?.indicatorsCalculatedAt, now);
});

test("completa snapshot antigo uma única vez sem alterar o VOP", async () => {
  const existing: NewVopSnapshot = {
    fundId: "apuama", referenceDate: apuamaDate, amount: "100",
    operationCount: null, termWeightedValue: null, termWeightAmount: null,
    monthlyRateWeightedValue: null, monthlyRateWeightAmount: null,
    indicatorsLastAttemptedAt: null, indicatorsCalculatedAt: null,
  };
  const { repository, snapshots } = fakeRepository({
    existing: [existing],
    latestByFund: { APUAMA: apuamaDate },
    positionsByFund: {
      APUAMA: [{ referenceDate: apuamaDate, latestCreatedAt: new Date("2026-09-21T15:00:00.000Z") }],
    },
    operations: { "APUAMA:2026-09-21": [operation("100", 60)] },
  });

  const first = await syncVopSnapshots({ now, repository });
  const frozen = { ...snapshots[0] };
  await syncVopSnapshots({ now: new Date("2026-09-23T18:30:00.000Z"), repository });

  assert.equal(snapshots[0]?.amount, "100");
  assert.equal(snapshots[0]?.termWeightedValue, "6000");
  assert.equal(snapshots[0]?.indicatorsCalculatedAt, now);
  assert.deepEqual(snapshots[0], frozen);
  assert.deepEqual(first.funds[0]?.completedDates, ["2026-09-21"]);
});

test("não completa snapshot quando o VOP histórico diverge da origem", async () => {
  const existing: NewVopSnapshot = {
    fundId: "apuama", referenceDate: apuamaDate, amount: "100",
    operationCount: null, termWeightedValue: null, termWeightAmount: null,
    monthlyRateWeightedValue: null, monthlyRateWeightAmount: null,
    indicatorsLastAttemptedAt: null, indicatorsCalculatedAt: null,
  };
  const { repository, snapshots } = fakeRepository({
    existing: [existing], latestByFund: { APUAMA: apuamaDate },
    positionsByFund: {
      APUAMA: [{ referenceDate: apuamaDate, latestCreatedAt: new Date("2026-09-21T15:00:00.000Z") }],
    },
    operations: { "APUAMA:2026-09-21": [operation("999")] },
  });

  const result = await syncVopSnapshots({ now, repository });

  assert.equal(snapshots[0]?.amount, "100");
  assert.equal(snapshots[0]?.indicatorsCalculatedAt, null);
  assert.deepEqual(result.funds[0]?.incompleteDates, ["2026-09-21"]);
});

test("mantém indicadores pendentes quando a operação tem dados inválidos", async () => {
  const { repository, snapshots } = fakeRepository({
    latestByFund: { APUAMA: apuamaDate },
    positionsByFund: {
      APUAMA: [{ referenceDate: apuamaDate, latestCreatedAt: new Date("2026-09-21T15:00:00.000Z") }],
    },
    operations: {
      "APUAMA:2026-09-21": [{ acquisitionValue: "100", termDays: null, annualAssignmentRate: "0.2" }],
    },
  });

  const result = await syncVopSnapshots({ now, repository });

  assert.deepEqual(snapshots, []);
  assert.deepEqual(result.funds[0]?.incompleteDates, ["2026-09-21"]);
});

test("completa snapshot pendente de mês anterior ao da última posição", async () => {
  const septemberDate = new Date("2026-09-30T00:00:00.000Z");
  const octoberDate = new Date("2026-10-01T00:00:00.000Z");
  const existing: NewVopSnapshot = {
    fundId: "apuama", referenceDate: septemberDate, amount: "100",
    operationCount: null, termWeightedValue: null, termWeightAmount: null,
    monthlyRateWeightedValue: null, monthlyRateWeightAmount: null,
    indicatorsLastAttemptedAt: null, indicatorsCalculatedAt: null,
  };
  const { repository, snapshots } = fakeRepository({
    existing: [existing],
    latestByFund: { APUAMA: octoberDate },
    positionsByFund: { APUAMA: [] },
    operations: { "APUAMA:2026-09-30": [operation("100", 45)] },
  });

  const result = await syncVopSnapshots({ now: new Date("2026-10-02T18:30:00.000Z"), repository });

  assert.equal(snapshots[0]?.termWeightedValue, "4500");
  assert.deepEqual(result.funds[0]?.completedDates, ["2026-09-30"]);
});

test("duas sincronizações concorrentes congelam o backfill somente uma vez", async () => {
  const existing: NewVopSnapshot = {
    fundId: "apuama", referenceDate: apuamaDate, amount: "100",
    operationCount: null, termWeightedValue: null, termWeightAmount: null,
    monthlyRateWeightedValue: null, monthlyRateWeightAmount: null,
    indicatorsLastAttemptedAt: null, indicatorsCalculatedAt: null,
  };
  const { repository } = fakeRepository({
    existing: [existing], latestByFund: { APUAMA: apuamaDate },
    positionsByFund: { APUAMA: [] },
    operations: { "APUAMA:2026-09-21": [operation("100", 30)] },
  });

  const results = await Promise.all([
    syncVopSnapshots({ now, repository }),
    syncVopSnapshots({ now, repository }),
  ]);
  const completions = results.flatMap((result) => result.funds[0]?.completedDates ?? []);

  assert.deepEqual(completions, ["2026-09-21"]);
});

test("adia backfill enquanto a posição histórica ainda recebe linhas", async () => {
  const existing: NewVopSnapshot = {
    fundId: "apuama", referenceDate: apuamaDate, amount: "100",
    operationCount: null, termWeightedValue: null, termWeightAmount: null,
    monthlyRateWeightedValue: null, monthlyRateWeightAmount: null,
    indicatorsCalculatedAt: null, indicatorsLastAttemptedAt: null,
  };
  const { repository, snapshots } = fakeRepository({
    existing: [existing], latestByFund: { APUAMA: apuamaDate },
    positionsByFund: { APUAMA: [] },
    operations: { "APUAMA:2026-09-21": [operation("100")] },
    latestCreatedAtByFundDate: {
      "APUAMA:2026-09-21": new Date("2026-09-22T18:25:00.000Z"),
    },
  });

  const waiting = await syncVopSnapshots({ now, repository });
  const completed = await syncVopSnapshots({ now: new Date("2026-09-22T18:40:00.000Z"), repository });

  assert.deepEqual(waiting.funds[0]?.waitingDates, ["2026-09-21"]);
  assert.equal(
    snapshots[0]?.indicatorsCalculatedAt?.getTime(),
    new Date("2026-09-22T18:40:00.000Z").getTime()
  );
  assert.deepEqual(completed.funds[0]?.completedDates, ["2026-09-21"]);
});

test("rotaciona pendências inválidas para não bloquear snapshots além do limite", async () => {
  const dates = Array.from({ length: 101 }, (_, index) =>
    new Date(Date.UTC(2026, 0, index + 1))
  );
  const existing: NewVopSnapshot[] = dates.map((referenceDate) => ({
    fundId: "apuama", referenceDate, amount: "100",
    operationCount: null, termWeightedValue: null, termWeightAmount: null,
    monthlyRateWeightedValue: null, monthlyRateWeightAmount: null,
    indicatorsCalculatedAt: null, indicatorsLastAttemptedAt: null,
  }));
  const operations = Object.fromEntries(
    dates.map((referenceDate, index) => [
      `APUAMA:${dateKey(referenceDate)}`,
      index === 0
        ? [operation("100", 30)]
        : [{ acquisitionValue: "100", termDays: null, annualAssignmentRate: "0.2" }],
    ])
  );
  const { repository, snapshots } = fakeRepository({
    existing,
    latestByFund: { APUAMA: dates[100] },
    positionsByFund: { APUAMA: [] },
    operations,
  });

  await syncVopSnapshots({ now, repository });
  const second = await syncVopSnapshots({ now: new Date(now.getTime() + 60_000), repository });

  assert.equal(snapshots[0]?.indicatorsCalculatedAt?.getTime(), now.getTime() + 60_000);
  assert.ok(second.funds[0]?.completedDates.includes(dateKey(dates[0])));
});

test("isola as operações e os componentes de APUAMA e BRISTOL", async () => {
  const bristolDate = new Date("2026-09-20T00:00:00.000Z");
  const { repository, snapshots } = fakeRepository({
    latestByFund: { APUAMA: apuamaDate, BRISTOL: bristolDate },
    positionsByFund: {
      APUAMA: [{ referenceDate: apuamaDate, latestCreatedAt: new Date("2026-09-21T15:00:00.000Z") }],
      BRISTOL: [{ referenceDate: bristolDate, latestCreatedAt: new Date("2026-09-20T15:00:00.000Z") }],
    },
    operations: {
      "APUAMA:2026-09-21": [operation("100", 30)],
      "BRISTOL:2026-09-20": [operation("200", 90)],
    },
  });

  await syncVopSnapshots({ now, repository });

  assert.deepEqual(
    snapshots.map((snapshot) => [snapshot.fundId, snapshot.amount, snapshot.termWeightedValue]),
    [["apuama", "100", "3000"], ["bristol", "200", "18000"]]
  );
});

test("adia posição instável sem gravar snapshot parcial", async () => {
  const { repository, snapshots } = fakeRepository({
    latestByFund: { APUAMA: apuamaDate },
    positionsByFund: {
      APUAMA: [{ referenceDate: apuamaDate, latestCreatedAt: new Date("2026-09-22T18:25:00.000Z") }],
    },
  });

  const result = await syncVopSnapshots({ now, repository });

  assert.deepEqual(snapshots, []);
  assert.deepEqual(result.funds[0]?.waitingDates, ["2026-09-21"]);
});

test("grava snapshot legítimo de valor zero como indicadores processados", async () => {
  const { repository, snapshots } = fakeRepository({
    latestByFund: { APUAMA: apuamaDate },
    positionsByFund: {
      APUAMA: [{ referenceDate: apuamaDate, latestCreatedAt: new Date("2026-09-21T15:00:00.000Z") }],
    },
  });

  await syncVopSnapshots({ now, repository });

  assert.equal(snapshots[0]?.amount, "0");
  assert.equal(snapshots[0]?.indicatorsCalculatedAt, now);
  assert.equal(snapshots[0]?.termWeightedValue, null);
});

test("mantém imutável um snapshot completo quando a origem muda", async () => {
  const existing = completeSnapshot({ fundId: "apuama", referenceDate: apuamaDate, amount: "100" });
  const { repository, snapshots } = fakeRepository({
    existing: [existing], latestByFund: { APUAMA: apuamaDate },
    positionsByFund: {
      APUAMA: [{ referenceDate: apuamaDate, latestCreatedAt: new Date("2026-09-21T15:00:00.000Z") }],
    },
    operations: { "APUAMA:2026-09-21": [operation("999")] },
  });

  await syncVopSnapshots({ now, repository });

  assert.deepEqual(snapshots, [existing]);
});

test("resume o último VOP, componentes e acumulado do mês", async () => {
  const repository = fakeRepository().repository;
  repository.findLatestSnapshot = async () => ({
    fundId: "apuama", referenceDate: apuamaDate, amount: "200.75",
    operationCount: 2, termWeightedValue: "12045", termWeightAmount: "200.75",
    monthlyRateWeightedValue: "6.583", monthlyRateWeightAmount: "200.75",
    indicatorsLastAttemptedAt: now,
    indicatorsCalculatedAt: now,
  });
  repository.sumSnapshots = async (fundId, start, end) => {
    assert.equal(fundId, "apuama");
    assert.equal(dateKey(start), "2026-09-01");
    assert.equal(dateKey(end), "2026-09-21");
    return "301.00";
  };

  assert.deepEqual(await loadFundVopSummary("apuama", repository), {
    referenceDate: apuamaDate,
    dailyAmount: 200.75,
    monthlyAmount: 301,
    weightedAverageTermDays: 60,
    weightedAverageMonthlyRate: 6.583 / 200.75,
  });
});

test("não inventa VOP zero quando ainda não existe snapshot", async () => {
  const repository = fakeRepository().repository;
  assert.equal(await loadFundVopSummary("apuama", repository), null);
});

test("mantém médias indisponíveis enquanto o snapshot não estiver concluído", async () => {
  const repository = fakeRepository().repository;
  repository.findLatestSnapshot = async () => ({
    fundId: "apuama", referenceDate: apuamaDate, amount: "100",
    operationCount: 1, termWeightedValue: "3000", termWeightAmount: "100",
    monthlyRateWeightedValue: "1", monthlyRateWeightAmount: "100",
    indicatorsLastAttemptedAt: now,
    indicatorsCalculatedAt: null,
  });

  const summary = await loadFundVopSummary("apuama", repository);

  assert.equal(summary?.weightedAverageTermDays, null);
  assert.equal(summary?.weightedAverageMonthlyRate, null);
});
