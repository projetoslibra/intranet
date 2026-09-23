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
    indicatorsCalculatedAt: null,
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
    indicatorsCalculatedAt: null,
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

  assert.equal(snapshots[0]?.amount, "100");
  assert.equal(snapshots[0]?.indicatorsCalculatedAt, null);
  assert.deepEqual(result.funds[0]?.incompleteDates, ["2026-09-21"]);
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
