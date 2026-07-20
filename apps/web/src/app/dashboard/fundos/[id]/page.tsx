import { notFound } from "next/navigation";
import { Banknote, LineChart, Percent, Wallet } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate, formatPercent } from "@/lib/formatters";
import { hasPermission } from "@/lib/permissions";

type FundDetailPageProps = {
  params: {
    id: string;
  };
};

const statusLabels: Record<string, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
  CLOSED: "Encerrado",
};

const typeLabels: Record<string, string> = {
  FIDC: "FIDC",
  FII: "FII",
  FIM: "FIM",
  FIA: "FIA",
  RENDA_FIXA: "Renda Fixa",
  MULTIMERCADO: "Multimercado",
  OUTRO: "Outro",
};

export default async function FundDetailPage({ params }: FundDetailPageProps) {
  const canView = await hasPermission("funds.view");

  if (!canView) {
    return (
      <section className="rounded border border-slate-200 bg-white p-6 shadow-executive">
        <h2 className="text-lg font-semibold text-slate-950">Fundos</h2>
        <p className="mt-2 text-sm text-slate-500">
          Voce nao tem permissao para visualizar fundos.
        </p>
      </section>
    );
  }

  const fund = await prisma.fund.findUnique({
    where: {
      id: params.id,
    },
    include: {
      quotes: {
        orderBy: {
          quoteDate: "desc",
        },
        take: 30,
      },
    },
  });

  if (!fund) {
    notFound();
  }

  const latestQuote = fund.quotes[0];
  const latestPosition = await prisma.financialPosition.findFirst({
    where: {
      fundId: fund.id,
    },
    orderBy: {
      positionDate: "desc",
    },
    select: {
      positionDate: true,
    },
  });

  const positions = latestPosition
    ? await prisma.financialPosition.findMany({
        where: {
          fundId: fund.id,
          positionDate: latestPosition.positionDate,
        },
        orderBy: [
          {
            assetClass: "asc",
          },
          {
            assetName: "asc",
          },
        ],
      })
    : [];

  const metrics = [
    {
      label: "PL",
      value: latestQuote
        ? formatCurrency(Number(latestQuote.netAssetValue))
        : formatCurrency(0),
      icon: Banknote,
    },
    {
      label: "Valor da Cota",
      value: latestQuote
        ? formatCurrency(Number(latestQuote.quotaValue))
        : formatCurrency(0),
      icon: Wallet,
    },
    {
      label: "Rentabilidade Diária",
      value: latestQuote
        ? formatPercent(Number(latestQuote.dailyReturn) / 100)
        : formatPercent(0),
      icon: Percent,
    },
    {
      label: "Rentabilidade Anual",
      value: latestQuote
        ? formatPercent(Number(latestQuote.yearReturn) / 100)
        : formatPercent(0),
      icon: LineChart,
    },
  ];

  const quoteHistory = fund.quotes.slice().reverse();

  return (
    <div className="space-y-7">
      <section className="rounded border border-slate-200 bg-white p-6 shadow-executive">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-normal text-slate-950">
              {fund.name}
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              {fund.shortName} · {fund.cnpj}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
              {typeLabels[fund.fundType] ?? fund.fundType}
            </span>
            <span className="rounded bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              {statusLabels[fund.status] ?? fund.status}
            </span>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;

          return (
            <article
              className="rounded border border-slate-200 bg-white p-5 shadow-executive"
              key={metric.label}
            >
              <div className="rounded bg-emerald-50 p-2.5 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <p className="mt-5 text-sm font-medium text-slate-500">
                {metric.label}
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-normal text-slate-950">
                {metric.value}
              </p>
            </article>
          );
        })}
      </section>

      <section className="rounded border border-slate-200 bg-white shadow-executive">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-950">
            Histórico de Cotas
          </h3>
          <p className="mt-1 text-sm text-slate-500">Últimos 30 registros.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <th className="px-5 py-3 font-semibold">Data</th>
                <th className="px-5 py-3 font-semibold">Valor da Cota</th>
                <th className="px-5 py-3 font-semibold">PL</th>
                <th className="px-5 py-3 font-semibold">Dia</th>
                <th className="px-5 py-3 font-semibold">Ano</th>
              </tr>
            </thead>
            <tbody>
              {quoteHistory.length > 0 ? (
                quoteHistory.map((quote) => (
                  <tr
                    className="border-b border-slate-100 last:border-0"
                    key={quote.id}
                  >
                    <td className="px-5 py-4 text-slate-600">
                      {formatDate(quote.quoteDate)}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {formatCurrency(Number(quote.quotaValue))}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {formatCurrency(Number(quote.netAssetValue))}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {formatPercent(Number(quote.dailyReturn) / 100)}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {formatPercent(Number(quote.yearReturn) / 100)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    className="px-5 py-8 text-center text-sm text-slate-500"
                    colSpan={5}
                  >
                    Nenhuma cota importada até o momento.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white shadow-executive">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-950">
            Posição da Carteira
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {latestPosition
              ? `Posição de ${formatDate(latestPosition.positionDate)}`
              : "Nenhuma posição importada."}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <th className="px-5 py-3 font-semibold">Classe</th>
                <th className="px-5 py-3 font-semibold">Ativo</th>
                <th className="px-5 py-3 font-semibold">Quantidade</th>
                <th className="px-5 py-3 font-semibold">Valor Bruto</th>
                <th className="px-5 py-3 font-semibold">Valor Líquido</th>
              </tr>
            </thead>
            <tbody>
              {positions.length > 0 ? (
                positions.map((position) => (
                  <tr
                    className="border-b border-slate-100 last:border-0"
                    key={position.id}
                  >
                    <td className="px-5 py-4 text-slate-600">
                      {position.assetClass}
                    </td>
                    <td className="px-5 py-4 font-medium text-slate-950">
                      {position.assetName}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {Number(position.quantity).toLocaleString("pt-BR")}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {formatCurrency(Number(position.grossValue))}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {formatCurrency(Number(position.netValue))}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    className="px-5 py-8 text-center text-sm text-slate-500"
                    colSpan={5}
                  >
                    Nenhuma posição de carteira importada até o momento.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
