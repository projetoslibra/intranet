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
  type VopSnapshotRepository,
} from "./vop-snapshots";

const apuamaDate = new Date("2026-09-21T00:00:00.000Z");
const now = new Date("2026-09-22T18:30:00.000Z");

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function fakeRepository(input?: {
  existing?: NewVopSnapshot[];
  latestByFund?: Record<string, Date | null>;
  positionsByFund?: Record<string, Array<{ referenceDate: Date; latestCreatedAt: Date }>>;
  amounts?: Record<string, string>;
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
    listStockPositions: async (fundKey) => input?.positionsByFund?.[fundKey] ?? [],
    listExistingSnapshotDates: async (fundId, start, end) =>
      snapshots
        .filter(
          (snapshot) =>
            snapshot.fundId === fundId &&
            snapshot.referenceDate >= start &&
            snapshot.referenceDate <= end
        )
        .map((snapshot) => snapshot.referenceDate),
    sumAcquisitionValue: async (fundKey, referenceDate) =>
      input?.amounts?.[`${fundKey}:${dateKey(referenceDate)}`] ?? "0",
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
  assert.deepEqual(monthBounds(new Date("2026-09-21T00:00:00.000Z")), {
    start: new Date("2026-09-01T00:00:00.000Z"),
    end: new Date("2026-09-30T23:59:59.999Z"),
  });
});

test("considera estável a posição sem inserções nos últimos dez minutos", () => {
  assert.equal(
    isStablePosition(new Date("2026-09-22T18:20:00.000Z"), now),
    true
  );
  assert.equal(
    isStablePosition(new Date("2026-09-22T18:20:00.001Z"), now),
    false
  );
});

test("a consulta de VOP exige aquisição e referência na mesma data", () => {
  assert.deepEqual(vopStockWhere("APUAMA", apuamaDate), {
    nomeFundo: { contains: "APUAMA", mode: "insensitive" },
    dataReferencia: apuamaDate,
    dataAquisicao: apuamaDate,
  });
});

test("faz backfill das datas ausentes do mês mais recente e ignora outros fundos", async () => {
  const bristolDate = new Date("2026-09-20T00:00:00.000Z");
  const { repository, snapshots } = fakeRepository({
    latestByFund: { APUAMA: apuamaDate, BRISTOL: bristolDate },
    positionsByFund: {
      APUAMA: [
        { referenceDate: new Date("2026-09-19T00:00:00.000Z"), latestCreatedAt: new Date("2026-09-19T15:00:00.000Z") },
        { referenceDate: apuamaDate, latestCreatedAt: new Date("2026-09-21T15:00:00.000Z") },
      ],
      BRISTOL: [
        { referenceDate: bristolDate, latestCreatedAt: new Date("2026-09-20T15:00:00.000Z") },
      ],
    },
    amounts: {
      "APUAMA:2026-09-19": "100.25",
      "APUAMA:2026-09-21": "200.75",
      "BRISTOL:2026-09-20": "50.00",
    },
  });

  const result = await syncVopSnapshots({ now, repository });

  assert.equal(result.ok, true);
  assert.deepEqual(
    snapshots.map((snapshot) => [snapshot.fundId, dateKey(snapshot.referenceDate), snapshot.amount]),
    [
      ["apuama", "2026-09-19", "100.25"],
      ["apuama", "2026-09-21", "200.75"],
      ["bristol", "2026-09-20", "50.00"],
    ]
  );
});

test("adia posição instável sem gravar snapshot parcial", async () => {
  const { repository, snapshots } = fakeRepository({
    latestByFund: { APUAMA: apuamaDate },
    positionsByFund: {
      APUAMA: [
        { referenceDate: apuamaDate, latestCreatedAt: new Date("2026-09-22T18:25:00.000Z") },
      ],
    },
    amounts: { "APUAMA:2026-09-21": "999.00" },
  });

  const result = await syncVopSnapshots({ now, repository });

  assert.deepEqual(snapshots, []);
  assert.deepEqual(result.funds.find((fund) => fund.fundKey === "APUAMA")?.waitingDates, [
    "2026-09-21",
  ]);
});

test("grava snapshot legítimo de valor zero", async () => {
  const { repository, snapshots } = fakeRepository({
    latestByFund: { APUAMA: apuamaDate },
    positionsByFund: {
      APUAMA: [
        { referenceDate: apuamaDate, latestCreatedAt: new Date("2026-09-21T15:00:00.000Z") },
      ],
    },
  });

  await syncVopSnapshots({ now, repository });

  assert.equal(snapshots[0]?.amount, "0");
});

test("mantém imutável um snapshot existente quando a origem muda", async () => {
  const existing = { fundId: "apuama", referenceDate: apuamaDate, amount: "100.00" };
  const { repository, snapshots } = fakeRepository({
    existing: [existing],
    latestByFund: { APUAMA: apuamaDate },
    positionsByFund: {
      APUAMA: [
        { referenceDate: apuamaDate, latestCreatedAt: new Date("2026-09-21T15:00:00.000Z") },
      ],
    },
    amounts: { "APUAMA:2026-09-21": "999.00" },
  });

  await syncVopSnapshots({ now, repository });

  assert.deepEqual(snapshots, [existing]);
});

test("resume o último VOP e o acumulado do mês da própria posição", async () => {
  const repository = fakeRepository().repository;
  repository.findLatestSnapshot = async () => ({
    fundId: "apuama",
    referenceDate: apuamaDate,
    amount: "200.75",
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
  });
});

test("não inventa VOP zero quando ainda não existe snapshot", async () => {
  const repository = fakeRepository().repository;
  assert.equal(await loadFundVopSummary("apuama", repository), null);
});
