import {
  Banknote,
  Building2,
  LineChart,
  TrendingUp,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate, formatPercent } from "@/lib/formatters";

export default async function DashboardPage() {
  const [funds, activeFundCount, fundsWithLatestQuote] = await Promise.all([
    prisma.fund.findMany({
      orderBy: {
        name: "asc",
      },
      select: {
        id: true,
        name: true,
        shortName: true,
        cnpj: true,
        fundType: true,
        status: true,
        startDate: true,
      },
    }),
    prisma.fund.count({
      where: {
        status: "ACTIVE",
      },
    }),
    prisma.fund.findMany({
      where: {
        status: "ACTIVE",
      },
      select: {
        quotes: {
          orderBy: {
            quoteDate: "desc",
          },
          take: 1,
          select: {
            netAssetValue: true,
            monthReturn: true,
            quoteDate: true,
          },
        },
      },
    }),
  ]);

  const latestQuotes = fundsWithLatestQuote.flatMap((fund) => fund.quotes);
  const consolidatedNetAssetValue = latestQuotes.reduce(
    (total, quote) => total + Number(quote.netAssetValue),
    0
  );
  const mainFundLatestQuote = latestQuotes
    .slice()
    .sort((current, next) => next.quoteDate.getTime() - current.quoteDate.getTime())[0];

  const kpis = [
    {
      label: "PL Consolidado",
      value: formatCurrency(consolidatedNetAssetValue),
      variation: formatPercent(0),
      icon: Banknote,
    },
    {
      label: "Rentabilidade Mês",
      value: mainFundLatestQuote
        ? `${Number(mainFundLatestQuote.monthReturn).toLocaleString("pt-BR", {
            minimumFractionDigits: 4,
            maximumFractionDigits: 4,
          })}%`
        : formatPercent(0),
      variation: formatPercent(0),
      icon: TrendingUp,
    },
    {
      label: "Caixa Disponível",
      value: formatCurrency(0),
      variation: formatPercent(0),
      icon: Wallet,
    },
    {
      label: "Fundos Ativos",
      value: String(activeFundCount),
      variation: formatPercent(0),
      icon: Building2,
    },
  ];

  return (
    <div className="space-y-7">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;

          return (
            <article
              className="rounded border border-slate-200 bg-white p-5 shadow-executive"
              key={kpi.label}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="rounded bg-emerald-50 p-2.5 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex items-center gap-1 rounded bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-500">
                  <LineChart className="h-3.5 w-3.5" />
                  {kpi.variation}
                </div>
              </div>
              <p className="mt-5 text-sm font-medium text-slate-500">
                {kpi.label}
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-normal text-slate-950">
                {kpi.value}
              </p>
            </article>
          );
        })}
      </section>

      <section className="rounded border border-slate-200 bg-white shadow-executive">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-950">
              Fundos cadastrados
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Lista inicial dos fundos registrados no banco de dados.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <th className="px-5 py-3 font-semibold">Fundo</th>
                <th className="px-5 py-3 font-semibold">CNPJ</th>
                <th className="px-5 py-3 font-semibold">Tipo</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Início</th>
              </tr>
            </thead>
            <tbody>
              {funds.length > 0 ? (
                funds.map((fund) => (
                  <tr
                    className="border-b border-slate-100 last:border-0"
                    key={fund.id}
                  >
                    <td className="px-5 py-4">
                      <Link
                        className="font-medium text-slate-950 transition hover:text-primary"
                        href={`/dashboard/fundos/${fund.id}`}
                      >
                        {fund.name}
                      </Link>
                      <p className="mt-1 text-xs text-slate-500">
                        {fund.shortName}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-slate-600">{fund.cnpj}</td>
                    <td className="px-5 py-4 text-slate-600">
                      {fund.fundType}
                    </td>
                    <td className="px-5 py-4">
                      <span className="rounded bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                        {fund.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {formatDate(fund.startDate)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    className="px-5 py-8 text-center text-sm text-slate-500"
                    colSpan={5}
                  >
                    Nenhum fundo cadastrado até o momento.
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
