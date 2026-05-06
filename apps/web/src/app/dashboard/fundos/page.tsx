import { FundsTable } from "@/components/funds-table";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/formatters";

export default async function FundsPage() {
  const funds = await prisma.fund.findMany({
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
  });

  return (
    <FundsTable
      funds={funds.map((fund) => ({
        ...fund,
        startDate: formatDate(fund.startDate),
      }))}
    />
  );
}
