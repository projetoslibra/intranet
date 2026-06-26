import { hasPermission } from "@/lib/permissions";
import { CashView } from "@/features/cash/components/CashView";
import {
  getActiveCashFunds,
  getAvailableCashDates,
  getCashDailyBalancesByDate,
} from "./actions";

type CashPageProps = {
  searchParams?: {
    date?: string;
  };
};

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function CashPage({ searchParams }: CashPageProps) {
  const canView = await hasPermission("cash.view");

  if (!canView) {
    return (
      <section className="rounded border border-slate-200 bg-white p-6 shadow-executive">
        <h2 className="text-lg font-semibold text-slate-950">Caixa</h2>
        <p className="mt-2 text-sm text-slate-500">
          Você não tem permissão para visualizar o caixa da empresa.
        </p>
      </section>
    );
  }

  const [canManage, availableDates, funds] = await Promise.all([
    hasPermission("cash.manage"),
    getAvailableCashDates(),
    getActiveCashFunds(),
  ]);

  const selectedDate = searchParams?.date ?? availableDates[0] ?? todayUtc();
  const balances = await getCashDailyBalancesByDate(selectedDate);

  return (
    <CashView
      availableDates={availableDates}
      balances={balances}
      canManage={canManage}
      funds={funds}
      selectedDate={selectedDate}
    />
  );
}
