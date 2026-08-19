import { Download } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { findDefaultFund, sortFundsByDisplayPriority } from "@/lib/fund-order";
import { hasPermission } from "@/lib/permissions";
import { CarteiraImportPanel } from "@/features/carteiras/components/CarteiraImportPanel";
import { ConsignadoCarteiraImportPanel } from "@/features/carteiras/components/ConsignadoCarteiraImportPanel";
import {
  getMostRecentBusinessDate,
  toDateKey,
} from "@/server/singulare/date-utils";

type DrePageProps = {
  searchParams?: {
    fundId?: string;
    period?: string;
    from?: string;
    to?: string;
    view?: string;
  };
};

type DreRow = {
  label: string;
  kind?: "section" | "subtotal" | "pl";
  valueType?: "currency" | "decimal" | "percent";
  values?: Map<string, number>;
  isDelta?: boolean;
};

const assetClasses = {
  creditRights: "direitos_creditorios",
  otherFunds: "outros_fundos",
  senior: "senior",
  mezzanine: "mezanino",
  ntnb: "ntnb",
  pdd: "pdd",
};

const expenseRows = [
  ["taxa_gestao", "Taxa de Gestão"],
  ["taxa_administracao", "Taxa de Administração"],
  ["taxa_custodia", "Taxa de Custódia"],
  ["auditoria", "Auditoria"],
  ["servicos_cobranca", "Serviços de Cobrança"],
  ["iof", "IOF"],
  ["cetip", "CETIP"],
  ["selic", "SELIC"],
  ["consultoria", "Consultoria"],
  ["rating", "Rating"],
  ["outras_despesas", "Outras Despesas"],
] as const;

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const decimalFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 6,
  maximumFractionDigits: 6,
});

const percentFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const dateHeaderFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseInputDate(value?: string) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function startOfUtcMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function endOfUtcMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0));
}

function getPeriodRange(searchParams?: DrePageProps["searchParams"]) {
  const today = new Date();
  const currentDay = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  const period = searchParams?.period ?? "currentMonth";

  if (period === "last7") {
    return { period, startDate: addDays(currentDay, -6), endDate: currentDay };
  }

  if (period === "currentMonth") {
    return {
      period,
      startDate: startOfUtcMonth(currentDay),
      endDate: currentDay,
    };
  }

  if (period === "previousMonth") {
    const previousMonth = new Date(
      Date.UTC(currentDay.getUTCFullYear(), currentDay.getUTCMonth() - 1, 1)
    );

    return {
      period,
      startDate: startOfUtcMonth(previousMonth),
      endDate: endOfUtcMonth(previousMonth),
    };
  }

  if (period === "custom") {
    return {
      period,
      startDate: parseInputDate(searchParams?.from) ?? addDays(currentDay, -29),
      endDate: parseInputDate(searchParams?.to) ?? currentDay,
    };
  }

  return {
    period: "currentMonth",
    startDate: startOfUtcMonth(currentDay),
    endDate: currentDay,
  };
}

function addToMap(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function sumMaps(dates: string[], maps: Array<Map<string, number>>) {
  const result = new Map<string, number>();

  for (const key of dates) {
    result.set(
      key,
      maps.reduce((total, map) => total + (map.get(key) ?? 0), 0)
    );
  }

  return result;
}

function deltaMap(dates: string[], values: Map<string, number>) {
  const result = new Map<string, number>();

  for (let index = 1; index < dates.length; index += 1) {
    const key = dates[index];
    const previousKey = dates[index - 1];
    result.set(key, (values.get(key) ?? 0) - (values.get(previousKey) ?? 0));
  }

  return result;
}

function assetDeltaMap(
  dates: string[],
  values: Map<string, number>,
  applications: Map<string, number>,
  redemptions: Map<string, number>
) {
  const result = new Map<string, number>();

  for (let index = 1; index < dates.length; index += 1) {
    const key = dates[index];
    const previousKey = dates[index - 1];
    result.set(
      key,
      (values.get(key) ?? 0) -
        (values.get(previousKey) ?? 0) -
        (applications.get(key) ?? 0) +
        (redemptions.get(key) ?? 0)
    );
  }

  return result;
}

function creditRightsDeltaMap(
  dates: string[],
  values: Map<string, number>,
  purchases: Map<string, number>,
  liquidations: Map<string, number>
) {
  const result = new Map<string, number>();

  for (let index = 1; index < dates.length; index += 1) {
    const key = dates[index];
    const previousKey = dates[index - 1];
    result.set(
      key,
      (values.get(key) ?? 0) -
        (values.get(previousKey) ?? 0) +
        -(purchases.get(key) ?? 0) +
        (liquidations.get(key) ?? 0)
    );
  }

  return result;
}

function formatValue(value: number | undefined, valueType: DreRow["valueType"]) {
  const safeValue = value ?? 0;

  if (valueType === "decimal") {
    return decimalFormatter.format(safeValue);
  }

  if (valueType === "percent") {
    return `${percentFormatter.format(safeValue)}%`;
  }

  return currencyFormatter.format(safeValue);
}

function formatCellValue(row: DreRow, value: number | undefined) {
  if (row.isDelta && (value === undefined || Math.abs(value) < 0.005)) {
    return "—";
  }

  return formatValue(value, row.valueType);
}

function formatDateHeader(key: string) {
  return dateHeaderFormatter.format(new Date(`${key}T00:00:00.000Z`));
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugifyFilePart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildExcelWorkbook({
  title,
  subtitle,
  dates,
  rows,
}: {
  title: string;
  subtitle: string;
  dates: string[];
  rows: DreRow[];
}) {
  const headerCells = dates
    .map(
      (key) =>
        `<th style="background:#f8fafc;border:1px solid #cbd5e1;text-align:right;">${escapeHtml(formatDateHeader(key))}</th>`
    )
    .join("");
  const bodyRows = rows
    .map((row) => {
      const isSection = row.kind === "section";
      const rowStyle = isSection
        ? "background:#f1f5f9;font-weight:bold;text-transform:uppercase;"
        : row.kind === "subtotal" || row.kind === "pl"
          ? "font-weight:bold;"
          : "";
      const valueCells = dates
        .map((key) => {
          const value = row.values?.get(key);
          const label = isSection ? "" : formatCellValue(row, value);
          return `<td style="border:1px solid #e2e8f0;text-align:right;${rowStyle}">${escapeHtml(label)}</td>`;
        })
        .join("");

      return `<tr><td style="border:1px solid #e2e8f0;${rowStyle}">${escapeHtml(row.label)}</td>${valueCells}</tr>`;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
</head>
<body>
  <table>
    <tr><th colspan="${dates.length + 1}" style="font-size:16px;text-align:left;">${escapeHtml(title)}</th></tr>
    <tr><td colspan="${dates.length + 1}" style="text-align:left;">${escapeHtml(subtitle)}</td></tr>
    <tr></tr>
    <tr>
      <th style="background:#f8fafc;border:1px solid #cbd5e1;text-align:left;">Conta / Indicador</th>
      ${headerCells}
    </tr>
    ${bodyRows}
  </table>
</body>
</html>`;
}

function buildExcelDataUri(workbook: string) {
  return `data:application/vnd.ms-excel;charset=utf-8,${encodeURIComponent(workbook)}`;
}

function normalizeAssetClass(value: string) {
  return value.trim().toUpperCase();
}

function resolveCarteiraFundo(fund: { name: string; shortName: string }) {
  const label = `${fund.shortName} ${fund.name}`.toUpperCase();

  if (label.includes("APUAMA")) {
    return "APUAMA";
  }

  if (label.includes("BRISTOL")) {
    return "BRISTOL";
  }

  if (label.includes("CONSIGNADO")) {
    return "CONSIGNADO";
  }

  return null;
}

function normalizeCarteiraAtivo(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function classifyCarteiraAtivo(value: string) {
  const ativo = normalizeCarteiraAtivo(value);

  if (ativo === "PATRIMONIO") {
    return "patrimonio";
  }

  if (ativo === "VARIACAO DIARIA") {
    return "variacao_diaria";
  }

  if (ativo === "VARIACAO MENSAL") {
    return "variacao_mensal";
  }

  if (ativo === "VARIACAO ANUAL") {
    return "variacao_anual";
  }

  if (ativo === "QUANTIDADE DE COTAS") {
    return "quantidade_cotas";
  }

  if (ativo === "VALOR DA COTA") {
    return "valor_cota";
  }

  if (ativo.includes("PDD")) {
    return "pdd";
  }

  if (
    ativo.includes("LIQUIDADOS") ||
    ativo.includes("CONCILIA") ||
    ativo.includes("SALDO EM TESOURARIA") ||
    ativo === "BRADESCO" ||
    ativo === "SOCOPA"
  ) {
    return "reconciliation";
  }

  if (ativo === "SRP" || ativo.includes("SENIOR")) {
    return "senior";
  }

  if (ativo === "MEZAN" || ativo.includes("MEZANINO")) {
    return "mezzanine";
  }

  if (
    ativo.includes("A VENCER") ||
    ativo.includes("VENCIDOS") ||
    ativo === "DIR"
  ) {
    return "creditRights";
  }

  if (
    ativo.includes("NTN") ||
    ativo.includes("LFT") ||
    ativo.includes("SELIC")
  ) {
    return "ntnb";
  }

  if (
    ativo.includes("TAXA") ||
    ativo.includes("DESPESA") ||
    ativo.includes("DIFERIMENTO") ||
    ativo.includes("AUDITORIA") ||
    ativo.includes("CETIP") ||
    ativo.includes("CUSTO") ||
    ativo.includes("CONSULTORIA") ||
    ativo.includes("RATING")
  ) {
    return "expense";
  }

  return "otherFunds";
}

function expenseCodeFromCarteiraAtivo(value: string) {
  const ativo = normalizeCarteiraAtivo(value);

  if (ativo.includes("GESTAO")) {
    return "taxa_gestao";
  }

  if (ativo.includes("ADMINISTRACAO")) {
    return "taxa_administracao";
  }

  if (ativo.includes("CUSTODIA")) {
    return "taxa_custodia";
  }

  if (ativo.includes("AUDITORIA")) {
    return "auditoria";
  }

  if (ativo.includes("COBRANCA")) {
    return "servicos_cobranca";
  }

  if (ativo.includes("IOF")) {
    return "iof";
  }

  if (ativo.includes("CETIP")) {
    return "cetip";
  }

  if (ativo.includes("SELIC")) {
    return "selic";
  }

  if (ativo.includes("CONSULTORIA")) {
    return "consultoria";
  }

  if (ativo.includes("RATING")) {
    return "rating";
  }

  return "outras_despesas";
}

function caixaFlowType(value: string) {
  const descricao = normalizeCarteiraAtivo(value);

  if (descricao.startsWith("APLICACAO NO FUNDO")) {
    return "aplicacao";
  }

  if (descricao.startsWith("RESGATE DO FUNDO")) {
    return "resgate";
  }

  return null;
}

function classifyCaixaAssetClass(
  descricao: string,
  historicoTraduzido: string | null,
  clienteId: string
) {
  const text = normalizeCarteiraAtivo(
    `${descricao} ${historicoTraduzido ?? ""} ${clienteId}`
  );

  if (
    text.includes("MZ") ||
    text.includes("MEZ") ||
    text.includes("MEZAN") ||
    text.includes("MEZANINO")
  ) {
    return assetClasses.mezzanine;
  }

  if (text.includes(" SR") || text.includes("SRP") || text.includes("SENIOR")) {
    return assetClasses.senior;
  }

  if (
    text.includes("A VENCER") ||
    text.includes("VENCIDOS") ||
    text.includes("BRISAVE") ||
    text.includes("BRISVENC") ||
    text.includes("APULBAV") ||
    text.includes("APULBVE")
  ) {
    return assetClasses.creditRights;
  }

  if (
    text.includes("NTN") ||
    text.includes("LFT") ||
    text.includes("SELIC")
  ) {
    return assetClasses.ntnb;
  }

  return assetClasses.otherFunds;
}

function rowClassName(row: DreRow) {
  if (row.kind === "section") {
    return "bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600";
  }

  if (row.kind === "subtotal") {
    return "border-t-2 border-slate-300 bg-white font-bold text-slate-950";
  }

  if (row.kind === "pl") {
    return "bg-emerald-50 font-bold text-emerald-900";
  }

  return "bg-white text-slate-700";
}

function valueClassName(row: DreRow, value: number | undefined) {
  if (row.isDelta) {
    if (value === undefined || Math.abs(value) < 0.005) {
      return "text-slate-400";
    }

    return value > 0 ? "text-emerald-700" : "text-red-700";
  }

  if (row.valueType === "percent") {
    if ((value ?? 0) > 0) {
      return "text-emerald-700";
    }

    if ((value ?? 0) < 0) {
      return "text-red-700";
    }
  }

  return "";
}

export default async function DrePage({ searchParams }: DrePageProps) {
  const [canView, canImport] = await Promise.all([
    hasPermission("dre.view"),
    hasPermission("dre.import"),
  ]);

  if (!canView) {
    return (
      <section className="rounded border border-slate-200 bg-white p-6 shadow-executive">
        <h2 className="text-lg font-semibold text-slate-950">DRE</h2>
        <p className="mt-2 text-sm text-slate-500">
          Voce nao tem permissao para visualizar a DRE.
        </p>
      </section>
    );
  }

  const { period, startDate, endDate } = getPeriodRange(searchParams);
  const selectedView = searchParams?.view === "variacao" ? "variacao" : "carteira";
  const defaultImportDate = toDateKey(getMostRecentBusinessDate());
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

  if (!selectedFund) {
    return (
      <div className="space-y-6">
        {canImport ? <CarteiraImportPanel defaultDate={defaultImportDate} /> : null}
        <section className="rounded border border-slate-200 bg-white p-6 shadow-executive">
          <h2 className="text-lg font-semibold text-slate-950">DRE dos Fundos</h2>
          <p className="mt-2 text-sm text-slate-500">
            Nenhum fundo ativo encontrado para exibir a DRE.
          </p>
        </section>
      </div>
    );
  }

  const carteiraFundo = resolveCarteiraFundo(selectedFund);
  const [positions, dreEntries, quotes, cashFlows, carteiras, caixas] = await Promise.all([
    prisma.financialPosition.findMany({
      where: {
        fundId: selectedFund.id,
        positionDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        positionDate: true,
        assetClass: true,
        netValue: true,
      },
    }),
    prisma.dreEntry.findMany({
      where: {
        fundId: selectedFund.id,
        referenceDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        referenceDate: true,
        amount: true,
        account: {
          select: {
            code: true,
          },
        },
      },
    }),
    prisma.fundQuote.findMany({
      where: {
        fundId: selectedFund.id,
        quoteDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: {
        quoteDate: "asc",
      },
      select: {
        quoteDate: true,
        netAssetValue: true,
        sharesQuantity: true,
        quotaValue: true,
        dailyReturn: true,
        monthReturn: true,
        yearReturn: true,
      },
    }),
    prisma.fundCashFlow.findMany({
      where: {
        fundId: selectedFund.id,
        flowDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        flowDate: true,
        flowType: true,
        assetClass: true,
        amount: true,
      },
    }),
    carteiraFundo
      ? prisma.carteira.findMany({
          where: {
            fundo: carteiraFundo,
            dataAnalise: {
              gte: startDate,
              lte: endDate,
            },
          },
          orderBy: [{ dataAnalise: "asc" }, { ativo: "asc" }],
          select: {
            ativo: true,
            valor: true,
            dataAnalise: true,
          },
        })
      : Promise.resolve([]),
    carteiraFundo
      ? prisma.caixaSingulare.findMany({
          where: {
            dataAnalise: {
              gte: startDate,
              lte: endDate,
            },
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
  ]);

  const dateSet = new Set<string>();
  positions.forEach((position) => dateSet.add(dateKey(position.positionDate)));
  dreEntries.forEach((entry) => dateSet.add(dateKey(entry.referenceDate)));
  quotes.forEach((quote) => dateSet.add(dateKey(quote.quoteDate)));
  cashFlows.forEach((flow) => dateSet.add(dateKey(flow.flowDate)));
  carteiras.forEach((carteira) => dateSet.add(dateKey(carteira.dataAnalise)));
  caixas.forEach((caixa) => dateSet.add(dateKey(caixa.dataAnalise)));
  const dates = Array.from(dateSet).sort();

  const creditRights = new Map<string, number>();
  const otherFunds = new Map<string, number>();
  const senior = new Map<string, number>();
  const mezzanine = new Map<string, number>();
  const ntnb = new Map<string, number>();
  const pddPositions = new Map<string, number>();
  const reconciliation = new Map<string, number>();
  const applicationsByAssetClass = new Map<string, Map<string, number>>();
  const redemptionsByAssetClass = new Map<string, Map<string, number>>();
  const expensesByCode = new Map<string, Map<string, number>>();
  const quoteMaps = {
    netAssetValue: new Map<string, number>(),
    sharesQuantity: new Map<string, number>(),
    quotaValue: new Map<string, number>(),
    dailyReturn: new Map<string, number>(),
    monthReturn: new Map<string, number>(),
    yearReturn: new Map<string, number>(),
  };

  for (const [code] of expenseRows) {
    expensesByCode.set(code, new Map<string, number>());
  }

  for (const position of positions) {
    const key = dateKey(position.positionDate);
    const assetClass = normalizeAssetClass(position.assetClass);
    const value = Number(position.netValue);

    if (assetClass === normalizeAssetClass(assetClasses.creditRights)) {
      addToMap(creditRights, key, value);
    } else if (assetClass === normalizeAssetClass(assetClasses.otherFunds)) {
      addToMap(otherFunds, key, value);
    } else if (assetClass === normalizeAssetClass(assetClasses.senior)) {
      addToMap(senior, key, value);
    } else if (assetClass === normalizeAssetClass(assetClasses.mezzanine)) {
      addToMap(mezzanine, key, value);
    } else if (assetClass === normalizeAssetClass(assetClasses.ntnb)) {
      addToMap(ntnb, key, value);
    } else if (assetClass === normalizeAssetClass(assetClasses.pdd)) {
      addToMap(pddPositions, key, value);
    }
  }

  for (const carteira of carteiras) {
    const key = dateKey(carteira.dataAnalise);
    const value = Number(carteira.valor);
    const category = classifyCarteiraAtivo(carteira.ativo);

    if (category === "patrimonio") {
      quoteMaps.netAssetValue.set(key, value);
    } else if (category === "variacao_diaria") {
      quoteMaps.dailyReturn.set(key, value);
    } else if (category === "variacao_mensal") {
      quoteMaps.monthReturn.set(key, value);
    } else if (category === "variacao_anual") {
      quoteMaps.yearReturn.set(key, value);
    } else if (category === "quantidade_cotas") {
      quoteMaps.sharesQuantity.set(key, value);
    } else if (category === "valor_cota") {
      quoteMaps.quotaValue.set(key, value);
    } else if (category === "creditRights") {
      addToMap(creditRights, key, value);
    } else if (category === "otherFunds") {
      addToMap(otherFunds, key, value);
    } else if (category === "ntnb") {
      addToMap(ntnb, key, value);
    } else if (category === "senior") {
      addToMap(senior, key, value);
    } else if (category === "mezzanine") {
      addToMap(mezzanine, key, value);
    } else if (category === "pdd") {
      addToMap(pddPositions, key, value);
    } else if (category === "reconciliation") {
      addToMap(reconciliation, key, value);
    } else if (category === "expense") {
      const code = expenseCodeFromCarteiraAtivo(carteira.ativo);
      const map = expensesByCode.get(code) ?? new Map<string, number>();
      addToMap(map, key, value);
      expensesByCode.set(code, map);
    }
  }

  for (const entry of dreEntries) {
    const key = dateKey(entry.referenceDate);
    const code = entry.account.code;
    const map = expensesByCode.get(code) ?? new Map<string, number>();
    addToMap(map, key, Number(entry.amount));
    expensesByCode.set(code, map);
  }

  for (const quote of quotes) {
    const key = dateKey(quote.quoteDate);
    quoteMaps.netAssetValue.set(key, Number(quote.netAssetValue));
    quoteMaps.sharesQuantity.set(key, Number(quote.sharesQuantity));
    quoteMaps.quotaValue.set(key, Number(quote.quotaValue));
    quoteMaps.dailyReturn.set(key, Number(quote.dailyReturn));
    quoteMaps.monthReturn.set(key, Number(quote.monthReturn));
    quoteMaps.yearReturn.set(key, Number(quote.yearReturn));
  }

  for (const flow of cashFlows) {
    const key = dateKey(flow.flowDate);
    const assetClass = normalizeAssetClass(flow.assetClass);
    const target =
      flow.flowType === "resgate" ? redemptionsByAssetClass : applicationsByAssetClass;
    const map = target.get(assetClass) ?? new Map<string, number>();
    addToMap(map, key, Number(flow.amount));
    target.set(assetClass, map);
  }

  for (const caixa of caixas) {
    const flowType = caixaFlowType(caixa.descricao);

    if (!flowType) {
      continue;
    }

    const key = dateKey(caixa.dataAnalise);
    const assetClass = normalizeAssetClass(
      classifyCaixaAssetClass(
        caixa.descricao,
        caixa.historicoTraduzido,
        caixa.clienteId
      )
    );
    const amount =
      flowType === "aplicacao"
        ? Math.abs(Number(caixa.saidas))
        : Math.abs(Number(caixa.entradas));

    if (amount === 0) {
      continue;
    }

    const target =
      flowType === "resgate" ? redemptionsByAssetClass : applicationsByAssetClass;
    const map = target.get(assetClass) ?? new Map<string, number>();
    addToMap(map, key, amount);
    target.set(assetClass, map);
  }

  const cashFlowMap = (
    maps: Map<string, Map<string, number>>,
    assetClass: string
  ) => maps.get(normalizeAssetClass(assetClass)) ?? new Map<string, number>();
  const expenseMaps = expenseRows.map(([code]) => expensesByCode.get(code) ?? new Map());
  const expenseDeltaMaps = expenseRows.map(([code]) =>
    deltaMap(dates, expensesByCode.get(code) ?? new Map<string, number>())
  );
  const reconciliationDelta = deltaMap(dates, reconciliation);

  const creditRightsDelta = creditRightsDeltaMap(
    dates,
    creditRights,
    cashFlowMap(applicationsByAssetClass, assetClasses.creditRights),
    cashFlowMap(redemptionsByAssetClass, assetClasses.creditRights)
  );
  const otherFundsDelta = assetDeltaMap(
    dates,
    otherFunds,
    cashFlowMap(applicationsByAssetClass, assetClasses.otherFunds),
    cashFlowMap(redemptionsByAssetClass, assetClasses.otherFunds)
  );
  const ntnbDelta = assetDeltaMap(
    dates,
    ntnb,
    cashFlowMap(applicationsByAssetClass, assetClasses.ntnb),
    cashFlowMap(redemptionsByAssetClass, assetClasses.ntnb)
  );
  const seniorDelta = assetDeltaMap(
    dates,
    senior,
    cashFlowMap(applicationsByAssetClass, assetClasses.senior),
    cashFlowMap(redemptionsByAssetClass, assetClasses.senior)
  );
  const mezzanineDelta = assetDeltaMap(
    dates,
    mezzanine,
    cashFlowMap(applicationsByAssetClass, assetClasses.mezzanine),
    cashFlowMap(redemptionsByAssetClass, assetClasses.mezzanine)
  );
  const pddDelta = deltaMap(dates, pddPositions);

  const portfolioRows: DreRow[] = [
    { label: "ATIVOS", kind: "section" },
    { label: "Direitos Creditórios", values: creditRights },
    { label: "Outros Fundos Investidos", values: otherFunds },
    { label: "Renda Fixa — NTN-B", values: ntnb },
    {
      label: "Total Ativos",
      kind: "subtotal",
      values: sumMaps(dates, [creditRights, otherFunds, ntnb]),
    },
    { label: "CONCILIAÇÃO / LIQUIDAÇÕES", kind: "section" },
    { label: "Liquidações, bancos e tesouraria", values: reconciliation },
    {
      label: "Total Conciliação",
      kind: "subtotal",
      values: reconciliation,
    },
    { label: "SUPERIORES", kind: "section" },
    { label: "Cotas Sênior", values: senior },
    { label: "Cotas Mezanino", values: mezzanine },
    {
      label: "Total Superiores",
      kind: "subtotal",
      values: sumMaps(dates, [senior, mezzanine]),
    },
    { label: "DESPESAS OPERACIONAIS", kind: "section" },
    ...expenseRows.map(([code, label]) => ({
      label,
      values: expensesByCode.get(code) ?? new Map<string, number>(),
    })),
    {
      label: "Total Despesas",
      kind: "subtotal",
      values: sumMaps(dates, expenseMaps),
    },
    { label: "RESULTADO", kind: "section" },
    {
      label: "PDD — Provisão para Devedores Duvidosos",
      values: pddPositions,
    },
    {
      label: "Patrimônio Líquido",
      kind: "pl",
      values: quoteMaps.netAssetValue,
    },
    { label: "COTAS", kind: "section" },
    {
      label: "Quantidade de Cotas",
      valueType: "decimal",
      values: quoteMaps.sharesQuantity,
    },
    {
      label: "Valor da Cota",
      valueType: "decimal",
      values: quoteMaps.quotaValue,
    },
    {
      label: "Rentabilidade Diária %",
      valueType: "percent",
      values: quoteMaps.dailyReturn,
    },
    {
      label: "Rentabilidade Mensal %",
      valueType: "percent",
      values: quoteMaps.monthReturn,
    },
    {
      label: "Rentabilidade Anual %",
      valueType: "percent",
      values: quoteMaps.yearReturn,
    },
  ];
  const variationRows: DreRow[] = [
    { label: "ATIVOS", kind: "section" },
    { label: "Direitos Creditórios", values: creditRightsDelta, isDelta: true },
    { label: "Outros Fundos Investidos", values: otherFundsDelta, isDelta: true },
    { label: "Renda Fixa — NTN-B", values: ntnbDelta, isDelta: true },
    {
      label: "Total Ativos",
      kind: "subtotal",
      values: sumMaps(dates, [creditRightsDelta, otherFundsDelta, ntnbDelta]),
      isDelta: true,
    },
    { label: "CONCILIAÇÃO / LIQUIDAÇÕES", kind: "section" },
    {
      label: "Liquidações, bancos e tesouraria",
      values: reconciliationDelta,
      isDelta: true,
    },
    {
      label: "Total Conciliação",
      kind: "subtotal",
      values: reconciliationDelta,
      isDelta: true,
    },
    { label: "SUPERIORES", kind: "section" },
    { label: "Cotas Sênior", values: seniorDelta, isDelta: true },
    { label: "Cotas Mezanino", values: mezzanineDelta, isDelta: true },
    {
      label: "Total Superiores",
      kind: "subtotal",
      values: sumMaps(dates, [seniorDelta, mezzanineDelta]),
      isDelta: true,
    },
    { label: "DESPESAS OPERACIONAIS", kind: "section" },
    ...expenseRows.map(([code, label]) => ({
      label,
      values: deltaMap(dates, expensesByCode.get(code) ?? new Map<string, number>()),
      isDelta: true,
    })),
    {
      label: "Total Despesas",
      kind: "subtotal",
      values: sumMaps(dates, expenseDeltaMaps),
      isDelta: true,
    },
    { label: "RESULTADO", kind: "section" },
    {
      label: "PDD — Provisão para Devedores Duvidosos",
      values: pddDelta,
      isDelta: true,
    },
    {
      label: "Patrimônio Líquido",
      kind: "pl",
      values: quoteMaps.netAssetValue,
    },
    { label: "COTAS", kind: "section" },
    {
      label: "Quantidade de Cotas",
      valueType: "decimal",
      values: quoteMaps.sharesQuantity,
    },
    {
      label: "Valor da Cota",
      valueType: "decimal",
      values: quoteMaps.quotaValue,
    },
    {
      label: "Rentabilidade Diária %",
      valueType: "percent",
      values: quoteMaps.dailyReturn,
    },
    {
      label: "Rentabilidade Mensal %",
      valueType: "percent",
      values: quoteMaps.monthReturn,
    },
    {
      label: "Rentabilidade Anual %",
      valueType: "percent",
      values: quoteMaps.yearReturn,
    },
  ];

  const hasData = dates.length > 0;
  const rows = selectedView === "variacao" ? variationRows : portfolioRows;
  const exportTitle = `DRE dos Fundos - ${
    selectedView === "variacao" ? "DRE / Variação" : "Carteira"
  }`;
  const exportSubtitle = `${selectedFund.name} · ${dateKey(startDate)} a ${dateKey(endDate)}`;
  const excelWorkbook = buildExcelWorkbook({
    title: exportTitle,
    subtitle: exportSubtitle,
    dates,
    rows,
  });
  const excelFileName = `dre-${slugifyFilePart(selectedFund.shortName || selectedFund.name)}-${selectedView}-${dateKey(startDate)}-${dateKey(endDate)}.xls`;
  const viewHref = (view: "carteira" | "variacao") => {
    const params = new URLSearchParams();
    params.set("fundId", selectedFund.id);
    params.set("period", period);
    params.set("from", dateKey(startDate));
    params.set("to", dateKey(endDate));
    params.set("view", view);
    return `/dashboard/dre?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
        <form className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_190px_160px_160px_auto] lg:items-end">
          <input name="view" type="hidden" value={selectedView} />
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="fundId">
              Fundo
            </label>
            <select
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              defaultValue={selectedFund.id}
              id="fundId"
              name="fundId"
            >
              {funds.map((fund) => (
                <option key={fund.id} value={fund.id}>
                  {fund.shortName || fund.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="period">
              Período
            </label>
            <select
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              defaultValue={period}
              id="period"
              name="period"
            >
              <option value="currentMonth">Mês atual</option>
              <option value="last7">Últimos 7 dias</option>
              <option value="last30">Últimos 30 dias</option>
              <option value="previousMonth">Mês anterior</option>
              <option value="custom">Personalizado</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="from">
              De
            </label>
            <input
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              defaultValue={dateKey(startDate)}
              id="from"
              name="from"
              type="date"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="to">
              Até
            </label>
            <input
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              defaultValue={dateKey(endDate)}
              id="to"
              name="to"
              type="date"
            />
          </div>

          <div className="flex gap-2">
            <button
              className="h-10 rounded bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
              type="submit"
            >
              Aplicar
            </button>
            <a
              aria-disabled={!hasData}
              className={`inline-flex h-10 items-center gap-2 rounded border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 ${
                hasData ? "" : "pointer-events-none opacity-50"
              }`}
              download={excelFileName}
              href={hasData ? buildExcelDataUri(excelWorkbook) : undefined}
            >
              <Download className="h-4 w-4" />
              Exportar Excel
            </a>
          </div>
        </form>
      </section>

      {canImport ? (
        carteiraFundo === "CONSIGNADO" ? (
          <ConsignadoCarteiraImportPanel />
        ) : (
          <CarteiraImportPanel defaultDate={defaultImportDate} />
        )
      ) : null}

      <section className="rounded border border-slate-200 bg-white shadow-executive">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">
            DRE dos Fundos
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {selectedFund.name} · {dateKey(startDate)} a {dateKey(endDate)}
          </p>
        </div>

        <div className="flex border-b border-slate-200 px-5 pt-3">
          {[
            ["carteira", "Carteira"],
            ["variacao", "DRE / Variação"],
          ].map(([view, label]) => (
            <a
              className={`border-b-2 px-4 py-2 text-sm font-semibold transition ${
                selectedView === view
                  ? "border-primary text-primary"
                  : "border-transparent text-slate-500 hover:text-slate-900"
              }`}
              href={viewHref(view as "carteira" | "variacao")}
              key={view}
            >
              {label}
            </a>
          ))}
        </div>

        {!hasData ? (
          <p className="px-5 py-8 text-sm text-slate-500">
            Nenhum dado encontrado para o período selecionado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="sticky left-0 z-20 min-w-[220px] border-r border-slate-200 bg-slate-50 px-4 py-3 text-left font-semibold">
                    Conta / Indicador
                  </th>
                  {dates.map((key) => (
                    <th
                      className="min-w-[130px] px-4 py-3 text-right font-semibold"
                      key={key}
                    >
                      {formatDateHeader(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr className={rowClassName(row)} key={row.label}>
                    <td
                      className={`sticky left-0 z-10 min-w-[220px] border-r border-slate-200 px-4 py-3 text-left ${rowClassName(row)}`}
                    >
                      {row.label}
                    </td>
                    {dates.map((key) => {
                      const value = row.values?.get(key);

                      return (
                        <td
                          className={`min-w-[130px] px-4 py-3 text-right ${valueClassName(row, value)}`}
                          key={key}
                        >
                          {row.kind === "section" ? "" : formatCellValue(row, value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
