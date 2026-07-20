import { FundsTable } from "@/components/funds-table";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/formatters";
import { hasPermission } from "@/lib/permissions";

export default async function FundsPage() {
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

  const [canManage, funds] = await Promise.all([
    hasPermission("funds.manage"),
    prisma.fund.findMany({
    where: {
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
      cnpj: true,
      fundType: true,
      status: true,
      startDate: true,
    },
    }),
  ]);

  return (
    <FundsTable
      canManage={canManage}
      funds={funds.map((fund) => ({
        ...fund,
        startDate: formatDate(fund.startDate),
      }))}
    />
  );
}
