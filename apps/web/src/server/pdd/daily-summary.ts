import type { Prisma } from "@prisma/client";
import { pddDaysLate, pddDebtorKey, pddRateForDelay } from "@/lib/logica-pdd";
import { prisma } from "@/lib/prisma";

type StockTitle = {
  id: string;
  cedentName: string;
  cedentDocument: string | null;
  debtorName: string;
  debtorDocument: string | null;
  dueDate: string;
  presentValue: number;
  currentPdd: number;
};

type GroupedPdd = {
  cedente: string;
  sacado: string;
  documentoSacado: string | null;
  valor: number;
};

export type PddDailySummaryItem = {
  cedente: string;
  sacado: string;
  documentoSacado: string | null;
  valorAnterior: number;
  valorAtual: number;
  delta: number;
};

export type PddDailyTurnover = {
  data: string;
  cedente: string;
  sacado: string;
  documentoSacado: string | null;
  faixaAnterior: string;
  faixaNova: string;
  valorPresente: number;
  valorVirada: number;
};

export type PddDailySummaryJson = {
  pddAtual: number;
  pddAnterior: number | null;
  deltaPdd: number | null;
  pddEm7Dias: number;
  pddEm15Dias: number;
  aumentos: PddDailySummaryItem[];
  reversoes: PddDailySummaryItem[];
  viradasProximos7Dias: PddDailyTurnover[];
  semComparativoAnterior: boolean;
  snapshotAnteriorData: string | null;
};

type GeneratePddDailySummaryInput = {
  nomeFundo: string;
  dataReferencia: string;
};

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  currency: "BRL",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseDateKey(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function addDays(value: string, days: number) {
  const date = parseDateKey(value);

  date.setUTCDate(date.getUTCDate() + days);

  return dateKey(date);
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function pddRangeLabel(daysLate: number) {
  if (daysLate <= 5) return "0 a 5 dias";
  if (daysLate <= 30) return "6 a 30 dias";
  if (daysLate <= 60) return "31 a 60 dias";
  if (daysLate <= 90) return "61 a 90 dias";
  if (daysLate <= 120) return "91 a 120 dias";

  return "121+ dias";
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function ensurePddDailySummaryTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PDD_RESUMOS_DIARIOS" (
      "id" UUID NOT NULL DEFAULT gen_random_uuid(),
      "nomeFundo" TEXT NOT NULL,
      "dataReferencia" DATE NOT NULL,
      "analiseTexto" TEXT NOT NULL,
      "analiseJson" JSONB NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PDD_RESUMOS_DIARIOS_pkey" PRIMARY KEY ("id")
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "pdd_resumos_diarios_unique"
      ON "PDD_RESUMOS_DIARIOS" ("nomeFundo", "dataReferencia")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PDD_RESUMOS_DIARIOS_dataReferencia_idx"
      ON "PDD_RESUMOS_DIARIOS" ("dataReferencia")
  `);
}

function groupKey(title: Pick<StockTitle, "cedentDocument" | "cedentName" | "debtorDocument" | "debtorName">) {
  return [
    title.cedentDocument ?? title.cedentName,
    pddDebtorKey({
      debtorDocument: title.debtorDocument,
      debtorName: title.debtorName,
    }),
  ].join("|");
}

function toTitles(
  rows: Array<{
    id: string;
    nomeCedente: string;
    docCedente: string | null;
    nomeSacado: string;
    docSacado: string | null;
    dataVencimentoOriginal: Date;
    valorPresente: Prisma.Decimal;
    valorPdd: Prisma.Decimal;
  }>
): StockTitle[] {
  return rows.map((row) => ({
    id: row.id,
    cedentName: row.nomeCedente,
    cedentDocument: row.docCedente,
    debtorName: row.nomeSacado,
    debtorDocument: row.docSacado,
    dueDate: dateKey(row.dataVencimentoOriginal),
    presentValue: Number(row.valorPresente),
    currentPdd: Math.max(0, Number(row.valorPdd)),
  }));
}

function groupSnapshotPdd(titles: StockTitle[]) {
  const groups = new Map<string, GroupedPdd>();

  titles.forEach((title) => {
    const key = groupKey(title);
    const current = groups.get(key) ?? {
      cedente: title.cedentName,
      sacado: title.debtorName,
      documentoSacado: title.debtorDocument,
      valor: 0,
    };

    current.valor += title.currentPdd;
    groups.set(key, current);
  });

  return groups;
}

function compareSnapshots(
  previousTitles: StockTitle[],
  currentTitles: StockTitle[]
) {
  const previous = groupSnapshotPdd(previousTitles);
  const current = groupSnapshotPdd(currentTitles);
  const keys = new Set([...previous.keys(), ...current.keys()]);
  const aumentos: PddDailySummaryItem[] = [];
  const reversoes: PddDailySummaryItem[] = [];

  keys.forEach((key) => {
    const previousItem = previous.get(key);
    const currentItem = current.get(key);
    const valorAnterior = roundMoney(previousItem?.valor ?? 0);
    const valorAtual = roundMoney(currentItem?.valor ?? 0);
    const delta = roundMoney(valorAtual - valorAnterior);

    if (Math.abs(delta) < 0.005) return;

    const item: PddDailySummaryItem = {
      cedente: currentItem?.cedente ?? previousItem?.cedente ?? "-",
      sacado: currentItem?.sacado ?? previousItem?.sacado ?? "-",
      documentoSacado:
        currentItem?.documentoSacado ?? previousItem?.documentoSacado ?? null,
      valorAnterior,
      valorAtual,
      delta,
    };

    if (delta > 0) {
      aumentos.push(item);
    } else {
      reversoes.push(item);
    }
  });

  return {
    aumentos: aumentos.sort((left, right) => right.delta - left.delta).slice(0, 20),
    reversoes: reversoes
      .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
      .slice(0, 20),
  };
}

function groupTitlesByDebtor(titles: StockTitle[]) {
  const debtors = new Map<string, StockTitle[]>();

  titles.forEach((title) => {
    const key = pddDebtorKey({
      debtorDocument: title.debtorDocument,
      debtorName: title.debtorName,
    });
    const group = debtors.get(key) ?? [];

    group.push(title);
    debtors.set(key, group);
  });

  return debtors;
}

function calculateProjectedPdd(referenceDate: string, titles: StockTitle[]) {
  const debtors = groupTitlesByDebtor(titles);
  let total = 0;

  debtors.forEach((debtorTitles) => {
    const maxDelay = Math.max(
      0,
      ...debtorTitles.map((title) => pddDaysLate(referenceDate, title.dueDate))
    );
    const rate = pddRateForDelay(maxDelay);

    total += debtorTitles.reduce(
      (subtotal, title) => subtotal + title.presentValue * rate,
      0
    );
  });

  return roundMoney(total);
}

function buildTurnovers(referenceDate: string, titles: StockTitle[]) {
  const result: PddDailyTurnover[] = [];
  const nextSevenDates = Array.from({ length: 7 }, (_, index) =>
    addDays(referenceDate, index + 1)
  );

  nextSevenDates.forEach((date, index) => {
    const previousDate = index === 0 ? referenceDate : nextSevenDates[index - 1];
    const debtors = groupTitlesByDebtor(titles);

    debtors.forEach((debtorTitles) => {
      const previousDelay = Math.max(
        0,
        ...debtorTitles.map((title) => pddDaysLate(previousDate, title.dueDate))
      );
      const nextDelay = Math.max(
        0,
        ...debtorTitles.map((title) => pddDaysLate(date, title.dueDate))
      );
      const previousRate = pddRateForDelay(previousDelay);
      const nextRate = pddRateForDelay(nextDelay);
      const deltaRate = nextRate - previousRate;

      if (deltaRate <= 0) return;

      const byCedent = new Map<
        string,
        {
          cedente: string;
          sacado: string;
          documentoSacado: string | null;
          valorPresente: number;
        }
      >();

      debtorTitles.forEach((title) => {
        const key = `${title.cedentDocument ?? ""}|${title.cedentName}`;
        const current = byCedent.get(key) ?? {
          cedente: title.cedentName,
          sacado: title.debtorName,
          documentoSacado: title.debtorDocument,
          valorPresente: 0,
        };

        current.valorPresente += title.presentValue;
        byCedent.set(key, current);
      });

      byCedent.forEach((item) => {
        result.push({
          data: date,
          cedente: item.cedente,
          sacado: item.sacado,
          documentoSacado: item.documentoSacado,
          faixaAnterior: pddRangeLabel(previousDelay),
          faixaNova: pddRangeLabel(nextDelay),
          valorPresente: roundMoney(item.valorPresente),
          valorVirada: roundMoney(item.valorPresente * deltaRate),
        });
      });
    });
  });

  return result
    .sort((left, right) => right.valorVirada - left.valorVirada)
    .slice(0, 20);
}

function deterministicText({
  dataReferencia,
  json,
  nomeFundo,
}: {
  dataReferencia: string;
  json: PddDailySummaryJson;
  nomeFundo: string;
}) {
  if (json.semComparativoAnterior) {
    return `Resumo de PDD do fundo ${nomeFundo} em ${dataReferencia}: o estoque do dia foi processado com PDD atual de ${currencyFormatter.format(json.pddAtual)}. Ainda nao existe snapshot anterior disponivel para comparacao.`;
  }

  const topIncrease = json.aumentos[0];
  const topReversal = json.reversoes[0];
  const topTurnover = json.viradasProximos7Dias[0];
  const pieces = [
    `Resumo de PDD do fundo ${nomeFundo} em ${dataReferencia}: a PDD atual e ${currencyFormatter.format(json.pddAtual)}, com variacao de ${currencyFormatter.format(json.deltaPdd ?? 0)} frente ao snapshot anterior de ${json.snapshotAnteriorData}.`,
  ];

  if (topIncrease) {
    pieces.push(
      `O maior aumento veio de ${topIncrease.cedente} / ${topIncrease.sacado}, com delta de ${currencyFormatter.format(topIncrease.delta)}.`
    );
  }

  if (topReversal) {
    pieces.push(
      `A maior reversao veio de ${topReversal.cedente} / ${topReversal.sacado}, com delta de ${currencyFormatter.format(topReversal.delta)}.`
    );
  }

  if (topTurnover) {
    pieces.push(
      `Nos proximos 7 dias, a maior virada prevista e ${topTurnover.cedente} / ${topTurnover.sacado}, em ${topTurnover.data}, com impacto de ${currencyFormatter.format(topTurnover.valorVirada)}.`
    );
  }

  return pieces.join(" ");
}

async function generateNarrativeWithOpenAi({
  dataReferencia,
  json,
  nomeFundo,
}: {
  dataReferencia: string;
  json: PddDailySummaryJson;
  nomeFundo: string;
}) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return deterministicText({ dataReferencia, json, nomeFundo });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      body: JSON.stringify({
        input: JSON.stringify({
          dataReferencia,
          nomeFundo,
          resumo: json,
        }),
        instructions:
          "Voce recebe dados financeiros ja calculados e validados. Sua unica tarefa e escrever um resumo em portugues natural descrevendo esses dados. Nao faca nenhum calculo, nao corrija, nao estime, nao arredonde de forma diferente e nao invente nenhum valor. Use exatamente os numeros fornecidos. Tom executivo, curto, para leitura rapida por gestores.",
        max_output_tokens: 450,
        model: process.env.OPENAI_PDD_SUMMARY_MODEL ?? "gpt-5-mini",
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      return deterministicText({ dataReferencia, json, nomeFundo });
    }

    const payload = (await response.json()) as {
      output_text?: string;
      output?: Array<{
        content?: Array<{
          text?: string;
          type?: string;
        }>;
      }>;
    };
    const text =
      payload.output_text ??
      payload.output
        ?.flatMap((item) => item.content ?? [])
        .map((content) => content.text)
        .filter(Boolean)
        .join("\n")
        .trim();

    return text || deterministicText({ dataReferencia, json, nomeFundo });
  } catch {
    return deterministicText({ dataReferencia, json, nomeFundo });
  }
}

export async function generatePddDailySummary({
  dataReferencia,
  nomeFundo,
}: GeneratePddDailySummaryInput) {
  const normalizedFund = normalizeText(nomeFundo);
  const referenceDate = parseDateKey(dataReferencia);
  const currentSnapshot = await prisma.fidcEstoque.findFirst({
    where: {
      dataReferencia: referenceDate,
      nomeFundo: {
        contains: normalizedFund,
        mode: "insensitive",
      },
    },
    orderBy: {
      nomeFundo: "asc",
    },
    select: {
      nomeFundo: true,
      dataReferencia: true,
    },
  });

  if (!currentSnapshot) {
    throw new Error("Nao existe estoque para o fundo/data informados.");
  }

  const [currentRows, previousSnapshot] = await Promise.all([
    prisma.fidcEstoque.findMany({
      where: {
        dataReferencia: currentSnapshot.dataReferencia,
        nomeFundo: currentSnapshot.nomeFundo,
      },
      select: {
        id: true,
        nomeCedente: true,
        docCedente: true,
        nomeSacado: true,
        docSacado: true,
        dataVencimentoOriginal: true,
        valorPresente: true,
        valorPdd: true,
      },
    }),
    prisma.fidcEstoque.findFirst({
      where: {
        dataReferencia: {
          lt: currentSnapshot.dataReferencia,
        },
        nomeFundo: currentSnapshot.nomeFundo,
      },
      orderBy: {
        dataReferencia: "desc",
      },
      select: {
        dataReferencia: true,
      },
    }),
  ]);
  const previousRows = previousSnapshot
    ? await prisma.fidcEstoque.findMany({
        where: {
          dataReferencia: previousSnapshot.dataReferencia,
          nomeFundo: currentSnapshot.nomeFundo,
        },
        select: {
          id: true,
          nomeCedente: true,
          docCedente: true,
          nomeSacado: true,
          docSacado: true,
          dataVencimentoOriginal: true,
          valorPresente: true,
          valorPdd: true,
        },
      })
    : [];
  const currentTitles = toTitles(currentRows);
  const previousTitles = toTitles(previousRows);
  const comparison = previousSnapshot
    ? compareSnapshots(previousTitles, currentTitles)
    : { aumentos: [], reversoes: [] };
  const pddAtual = roundMoney(
    currentTitles.reduce((total, title) => total + title.currentPdd, 0)
  );
  const pddAnterior = previousSnapshot
    ? roundMoney(previousTitles.reduce((total, title) => total + title.currentPdd, 0))
    : null;
  const analysisJson: PddDailySummaryJson = {
    pddAtual,
    pddAnterior,
    deltaPdd: pddAnterior === null ? null : roundMoney(pddAtual - pddAnterior),
    pddEm7Dias: calculateProjectedPdd(addDays(dataReferencia, 7), currentTitles),
    pddEm15Dias: calculateProjectedPdd(addDays(dataReferencia, 15), currentTitles),
    aumentos: comparison.aumentos,
    reversoes: comparison.reversoes,
    viradasProximos7Dias: buildTurnovers(dataReferencia, currentTitles),
    semComparativoAnterior: !previousSnapshot,
    snapshotAnteriorData: previousSnapshot ? dateKey(previousSnapshot.dataReferencia) : null,
  };
  const analysisText = await generateNarrativeWithOpenAi({
    dataReferencia,
    json: analysisJson,
    nomeFundo: currentSnapshot.nomeFundo,
  });

  await ensurePddDailySummaryTable();

  const record = await prisma.pddResumoDiario.upsert({
    create: {
      analiseJson: analysisJson as unknown as Prisma.InputJsonValue,
      analiseTexto: analysisText,
      dataReferencia: currentSnapshot.dataReferencia,
      nomeFundo: currentSnapshot.nomeFundo,
    },
    update: {
      analiseJson: analysisJson as unknown as Prisma.InputJsonValue,
      analiseTexto: analysisText,
    },
    where: {
      pdd_resumos_diarios_unique: {
        dataReferencia: currentSnapshot.dataReferencia,
        nomeFundo: currentSnapshot.nomeFundo,
      },
    },
  });

  return {
    analiseJson: analysisJson,
    analiseTexto: record.analiseTexto,
    dataReferencia: dateKey(record.dataReferencia),
    nomeFundo: record.nomeFundo,
  };
}
