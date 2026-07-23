import { QuotaForecastPlanner } from "@/features/forecasts/components/QuotaForecastPlanner";
import { findDefaultFund, sortFundsByDisplayPriority } from "@/lib/fund-order";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type ForecastsPageProps = {
  searchParams?: {
    fundId?: string;
  };
};

type HistoricalAccumulator = {
  date: string;
  patrimonio: number;
  creditRights: number;
  creditRightsVariation: number;
  pdd: number;
  variacaoMensal: number;
  variacaoAnual: number;
};

type ForecastStockTitle = {
  id: string;
  cedentName: string;
  cedentDocument: string | null;
  debtorName: string;
  debtorDocument: string | null;
  documentNumber: string;
  originalDueDate: string;
  nominalValue: number;
  presentValue: number;
  pddValue: number;
  pddRange: string | null;
  situation: string | null;
};

type ForecastStockData = {
  fundName: string;
  latestDate: string;
  cedents: Array<{
    name: string;
    document: string | null;
    titleCount: number;
    nominalValue: number;
    pddValue: number;
  }>;
  titles: ForecastStockTitle[];
} | null;

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function resolveCarteiraFundo(fund: { name: string; shortName: string }) {
  const label = `${fund.shortName} ${fund.name}`.toUpperCase();

  if (label.includes("APUAMA")) {
    return "APUAMA";
  }

  if (label.includes("BRISTOL")) {
    return "BRISTOL";
  }

  return null;
}

function normalizeAtivo(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function classifyAtivo(value: string) {
  const ativo = normalizeAtivo(value);

  if (ativo === "PATRIMONIO") {
    return "patrimonio";
  }

  if (ativo === "VARIACAO MENSAL") {
    return "variacaoMensal";
  }

  if (ativo === "VARIACAO ANUAL") {
    return "variacaoAnual";
  }

  if (ativo.includes("PDD")) {
    return "pdd";
  }

  if (
    ativo.includes("A VENCER") ||
    ativo.includes("VENCIDOS") ||
    ativo === "DIR"
  ) {
    return "creditRights";
  }

  return null;
}

function caixaFlowType(value: string) {
  const descricao = normalizeAtivo(value);

  if (descricao.startsWith("APLICACAO NO FUNDO")) {
    return "aplicacao";
  }

  if (descricao.startsWith("RESGATE DO FUNDO")) {
    return "resgate";
  }

  return null;
}

function isCreditRightsCaixaFlow(
  descricao: string,
  historicoTraduzido: string | null,
  clienteId: string
) {
  const text = normalizeAtivo(
    `${descricao} ${historicoTraduzido ?? ""} ${clienteId}`
  );

  return (
    text.includes("A VENCER") ||
    text.includes("VENCIDOS") ||
    text.includes("BRISAVE") ||
    text.includes("BRISVENC") ||
    text.includes("APULBAV") ||
    text.includes("APULBVE")
  );
}

function addToMap(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

export default async function ForecastsPage({ searchParams }: ForecastsPageProps) {
  const canView = await hasPermission("forecasts.view");

  if (!canView) {
    return (
      <section className="rounded border border-slate-200 bg-white p-6 shadow-executive">
        <h2 className="text-lg font-semibold text-slate-950">Previsoes</h2>
        <p className="mt-2 text-sm text-slate-500">
          Voce nao tem permissao para visualizar previsoes.
        </p>
      </section>
    );
  }

  const funds = sortFundsByDisplayPriority(await prisma.fund.findMany({
    where: {
      status: "ACTIVE",
      cnpj: {
        not: "00.000.000/0001-00",
      },
    },
    orderBy: {
      name: "asc",
    },
    select: {
      id: true,
      name: true,
      shortName: true,
    },
  }));

  const selectedFund = findDefaultFund(funds, searchParams?.fundId);
  const carteiraFundo = selectedFund ? resolveCarteiraFundo(selectedFund) : null;

  const [carteiras, caixas, latestQuote] = selectedFund
    ? await Promise.all([
        carteiraFundo
          ? prisma.carteira.findMany({
              where: {
                fundo: carteiraFundo,
              },
              orderBy: [{ dataAnalise: "asc" }, { ativo: "asc" }],
              select: {
                dataAnalise: true,
                ativo: true,
                valor: true,
              },
            })
          : Promise.resolve([]),
        carteiraFundo
          ? prisma.caixaSingulare.findMany({
              where: {
                OR: [
                  { clienteId: { contains: carteiraFundo, mode: "insensitive" } },
                  { clienteNome: { contains: carteiraFundo, mode: "insensitive" } },
                ],
              },
              select: {
                dataAnalise: true,
                descricao: true,
                historicoTraduzido: true,
                clienteId: true,
                entradas: true,
                saidas: true,
              },
            })
          : Promise.resolve([]),
        prisma.fundQuote.findFirst({
          where: {
            fundId: selectedFund.id,
          },
          orderBy: {
            quoteDate: "desc",
          },
          select: {
            sharesQuantity: true,
          },
        }),
      ])
    : [[], [], null];
  const latestStock =
    carteiraFundo
      ? await prisma.fidcEstoque.findFirst({
          where: {
            nomeFundo: {
              contains: carteiraFundo,
              mode: "insensitive",
            },
          },
          orderBy: {
            dataReferencia: "desc",
          },
          select: {
            nomeFundo: true,
            dataReferencia: true,
          },
        })
      : null;
  const stockRows = latestStock
    ? await prisma.fidcEstoque.findMany({
        where: {
          nomeFundo: latestStock.nomeFundo,
          dataReferencia: latestStock.dataReferencia,
        },
        orderBy: [
          {
            nomeCedente: "asc",
          },
          {
            dataVencimentoOriginal: "asc",
          },
          {
            numeroDocumento: "asc",
          },
        ],
        select: {
          id: true,
          nomeFundo: true,
          dataReferencia: true,
          nomeCedente: true,
          docCedente: true,
          nomeSacado: true,
          docSacado: true,
          numeroDocumento: true,
          dataVencimentoOriginal: true,
          valorNominal: true,
          valorPresente: true,
          valorPdd: true,
          faixaPdd: true,
          situacaoRecebivel: true,
        },
      })
    : [];
  const stockCedents = new Map<
    string,
    {
      name: string;
      document: string | null;
      titleCount: number;
      nominalValue: number;
      pddValue: number;
    }
  >();

  for (const row of stockRows) {
    const current = stockCedents.get(row.nomeCedente) ?? {
      name: row.nomeCedente,
      document: row.docCedente,
      titleCount: 0,
      nominalValue: 0,
      pddValue: 0,
    };
    current.titleCount += 1;
    current.nominalValue += Number(row.valorNominal);
    current.pddValue += Math.max(0, Number(row.valorPdd));
    stockCedents.set(row.nomeCedente, current);
  }

  const stockData: ForecastStockData =
    latestStock && stockRows.length > 0
      ? {
          fundName: latestStock.nomeFundo,
          latestDate: dateKey(latestStock.dataReferencia),
          cedents: Array.from(stockCedents.values()).sort((left, right) =>
            left.name.localeCompare(right.name, "pt-BR")
          ),
          titles: stockRows.map((row) => ({
            id: row.id,
            cedentName: row.nomeCedente,
            cedentDocument: row.docCedente,
            debtorName: row.nomeSacado,
            debtorDocument: row.docSacado,
            documentNumber: row.numeroDocumento,
            originalDueDate: dateKey(row.dataVencimentoOriginal),
            nominalValue: Number(row.valorNominal),
            presentValue: Number(row.valorPresente),
            pddValue: Math.max(0, Number(row.valorPdd)),
            pddRange: row.faixaPdd,
            situation: row.situacaoRecebivel,
          })),
        }
      : null;

  const historicalByDate = new Map<string, HistoricalAccumulator>();
  const creditRightsPurchasesByDate = new Map<string, number>();
  const creditRightsLiquidationsByDate = new Map<string, number>();

  for (const carteira of carteiras) {
    const key = dateKey(carteira.dataAnalise);
    const row = historicalByDate.get(key) ?? {
      date: key,
      patrimonio: 0,
      creditRights: 0,
      creditRightsVariation: 0,
      pdd: 0,
      variacaoMensal: 0,
      variacaoAnual: 0,
    };
    const category = classifyAtivo(carteira.ativo);
    const value = Number(carteira.valor);

    if (category === "patrimonio") {
      row.patrimonio = value;
    } else if (category === "creditRights") {
      row.creditRights += value;
    } else if (category === "pdd") {
      row.pdd += value;
    } else if (category === "variacaoMensal") {
      row.variacaoMensal = value;
    } else if (category === "variacaoAnual") {
      row.variacaoAnual = value;
    }

    historicalByDate.set(key, row);
  }

  for (const caixa of caixas) {
    const flowType = caixaFlowType(caixa.descricao);

    if (
      !flowType ||
      !isCreditRightsCaixaFlow(
        caixa.descricao,
        caixa.historicoTraduzido,
        caixa.clienteId
      )
    ) {
      continue;
    }

    const key = dateKey(caixa.dataAnalise);
    const amount =
      flowType === "aplicacao"
        ? Math.abs(Number(caixa.saidas))
        : Math.abs(Number(caixa.entradas));

    if (amount === 0) {
      continue;
    }

    addToMap(
      flowType === "aplicacao"
        ? creditRightsPurchasesByDate
        : creditRightsLiquidationsByDate,
      key,
      amount
    );
  }

  const historicalRows = Array.from(historicalByDate.values())
    .filter((row) => row.patrimonio !== 0)
    .sort((left, right) => left.date.localeCompare(right.date));

  for (let index = 1; index < historicalRows.length; index += 1) {
    const row = historicalRows[index];
    const previousRow = historicalRows[index - 1];
    row.creditRightsVariation =
      row.creditRights -
      previousRow.creditRights -
      (creditRightsPurchasesByDate.get(row.date) ?? 0) +
      (creditRightsLiquidationsByDate.get(row.date) ?? 0);
  }

  return (
    <QuotaForecastPlanner
      baseShareQuantity={Number(latestQuote?.sharesQuantity ?? 0)}
      funds={funds}
      historicalRows={historicalRows}
      selectedFundId={selectedFund?.id ?? ""}
      stockData={stockData}
    />
  );
}
