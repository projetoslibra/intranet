import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  buildRemittanceExclusions,
  classifyRemittanceExclusion,
  type RemittanceExclusionItem,
} from "./consignado-remittance-exclusions";
import * as remittanceExclusionsModule from "./consignado-remittance-exclusions";

type RemittanceCandidate = RemittanceExclusionItem & {
  occurrence: string | null;
  matchedStockPosition: { id: string; nominalValue: Prisma.Decimal } | null;
};

type SelectRemittanceItems = (items: RemittanceCandidate[]) => RemittanceCandidate[];
type BuildRemittanceExclusionPersistence = (
  remittanceId: string,
  allItems: RemittanceExclusionItem[],
  includedItems: Array<{ id: string }>,
) => {
  includedIds: Set<string>;
  exclusions: ReturnType<typeof buildRemittanceExclusions>;
  excludedItems: number;
  excludedPaidAmount: Prisma.Decimal;
  metadata: { excludedItems: number; excludedPaidAmount: string };
};

function item(overrides: Partial<RemittanceExclusionItem> = {}): RemittanceExclusionItem {
  return {
    id: "item-1",
    status: "DIVERGENT",
    matchedStockPositionId: "stock-1",
    approved: true,
    exclusionReason: null,
    statusReason: null,
    paidAmount: new Prisma.Decimal("50.00"),
    titleAmount: new Prisma.Decimal("60.00"),
    ...overrides,
  };
}

function serializable(rows: ReturnType<typeof buildRemittanceExclusions>) {
  return rows.map((row) => ({ ...row, paidAmount: row.paidAmount.toFixed(2), titleAmount: row.titleAmount.toFixed(2) }));
}

// @ts-expect-error snapshots monetários não podem aceitar number por risco de precisão.
item({ paidAmount: 50 });

test("prioriza recuperação PDD para título fora da remessa", () => {
  assert.equal(classifyRemittanceExclusion(item({
    status: "PDD_RECOVERY",
    matchedStockPositionId: null,
    statusReason: "Título não encontrado no estoque ativo.",
    exclusionReason: "Excluído pelo operador.",
    approved: false,
  })), "PDD_RECOVERY");
});

test("classifica revisão PDD como recuperação PDD", () => {
  assert.equal(classifyRemittanceExclusion(item({ status: "PDD_REVIEW" })), "PDD_RECOVERY");
});

test("classifica como não encontrado o título sem posição no estoque", () => {
  assert.equal(classifyRemittanceExclusion(item({
    matchedStockPositionId: null,
    statusReason: "Título não encontrado no estoque ativo.",
    approved: false,
  })), "NOT_FOUND_IN_STOCK");
});

test("classifica exclusão com motivo do operador", () => {
  assert.equal(classifyRemittanceExclusion(item({
    exclusionReason: "Duplicidade confirmada pelo operador.",
    approved: false,
  })), "OPERATOR_EXCLUDED");
});

test("classifica título não aprovado sem exclusão explícita", () => {
  assert.equal(classifyRemittanceExclusion(item({ approved: false })), "NOT_APPROVED");
});

test("usa outra divergência como fallback", () => {
  assert.equal(classifyRemittanceExclusion(item()), "OTHER_DIVERGENCE");
});

test("registra como não encontrado o item sem posição que ficou fora da remessa", () => {
  const rows = buildRemittanceExclusions("r1", [
    item({ id: "i1", matchedStockPositionId: null, statusReason: "Título não encontrado no estoque ativo.", paidAmount: new Prisma.Decimal("54.31"), titleAmount: new Prisma.Decimal("60.00") }),
  ], new Set());

  assert.deepEqual(serializable(rows), [{
    remittanceId: "r1",
    settlementItemId: "i1",
    category: "NOT_FOUND_IN_STOCK",
    reason: "Título não encontrado no estoque ativo.",
    paidAmount: "54.31",
    titleAmount: "60.00",
  }]);
});

test("não registra itens incluídos e preserva motivo explícito ou padrão", () => {
  const rows = buildRemittanceExclusions("r1", [
    item({ id: "included", exclusionReason: "Excluído pelo operador." }),
    item({ id: "explicit", exclusionReason: "Aguardando documentação." }),
    item({ id: "default", approved: false }),
  ], new Set(["included"]));

  assert.deepEqual(serializable(rows), [
    {
      remittanceId: "r1",
      settlementItemId: "explicit",
      category: "OPERATOR_EXCLUDED",
      reason: "Aguardando documentação.",
      paidAmount: "50.00",
      titleAmount: "60.00",
    },
    {
      remittanceId: "r1",
      settlementItemId: "default",
      category: "NOT_APPROVED",
      reason: "Não incluído na remessa.",
      paidAmount: "50.00",
      titleAmount: "60.00",
    },
  ]);
});

test("não seleciona título não aprovado com divergência 77 para a remessa", () => {
  const selectRemittanceItems = (remittanceExclusionsModule as unknown as { selectRemittanceItems?: SelectRemittanceItems })
    .selectRemittanceItems;

  assert.equal(typeof selectRemittanceItems, "function", "selectRemittanceItems ainda não foi implementada");

  const items: RemittanceCandidate[] = [
    {
      ...item({ id: "unapproved-77", approved: false, status: "DIVERGENT", paidAmount: new Prisma.Decimal("90.00") }),
      occurrence: "77",
      matchedStockPosition: { id: "stock-unapproved", nominalValue: new Prisma.Decimal("100.00") },
    },
    {
      ...item({ id: "approved-77", approved: true, status: "DIVERGENT", paidAmount: new Prisma.Decimal("90.00") }),
      occurrence: "77",
      matchedStockPosition: { id: "stock-approved", nominalValue: new Prisma.Decimal("100.00") },
    },
  ];

  assert.deepEqual(selectRemittanceItems!(items).map((item) => item.id), ["approved-77"]);
});

test("prepara IDs, snapshots e totais de exclusões da remessa", () => {
  const selectRemittanceItems = (remittanceExclusionsModule as unknown as { selectRemittanceItems?: SelectRemittanceItems })
    .selectRemittanceItems;
  const buildRemittanceExclusionPersistence = (remittanceExclusionsModule as unknown as {
    buildRemittanceExclusionPersistence?: BuildRemittanceExclusionPersistence;
  }).buildRemittanceExclusionPersistence;

  assert.equal(typeof selectRemittanceItems, "function", "selectRemittanceItems ainda não foi implementada");
  assert.equal(typeof buildRemittanceExclusionPersistence, "function", "buildRemittanceExclusionPersistence ainda não foi implementada");

  const allItems: RemittanceCandidate[] = [
    {
      ...item({ id: "included", status: "FULL_MATCH", paidAmount: new Prisma.Decimal("10.00") }),
      occurrence: "77",
      matchedStockPosition: { id: "stock-included", nominalValue: new Prisma.Decimal("10.00") },
    },
    {
      ...item({ id: "unapproved", approved: false, status: "DIVERGENT", paidAmount: new Prisma.Decimal("20.00") }),
      occurrence: "77",
      matchedStockPosition: { id: "stock-unapproved", nominalValue: new Prisma.Decimal("25.00") },
    },
    {
      ...item({ id: "not-found", matchedStockPositionId: null, statusReason: "Título não encontrado no estoque ativo.", paidAmount: new Prisma.Decimal("30.00") }),
      occurrence: "77",
      matchedStockPosition: null,
    },
  ];
  const includedItems = selectRemittanceItems!(allItems);
  const persistence = buildRemittanceExclusionPersistence!("r1", allItems, includedItems);

  assert.deepEqual({
    includedIds: Array.from(persistence.includedIds),
    exclusions: serializable(persistence.exclusions),
    eventMetadata: persistence.metadata,
  }, {
    includedIds: ["included"],
    exclusions: [
      {
        remittanceId: "r1",
        settlementItemId: "unapproved",
        category: "NOT_APPROVED",
        reason: "Não incluído na remessa.",
        paidAmount: "20.00",
        titleAmount: "60.00",
      },
      {
        remittanceId: "r1",
        settlementItemId: "not-found",
        category: "NOT_FOUND_IN_STOCK",
        reason: "Título não encontrado no estoque ativo.",
        paidAmount: "30.00",
        titleAmount: "60.00",
      },
    ],
    eventMetadata: {
      excludedItems: 2,
      excludedPaidAmount: "50",
    },
  });
});
