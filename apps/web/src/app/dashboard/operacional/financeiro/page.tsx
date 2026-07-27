import { hasPermission } from "@/lib/permissions";
import { CashView } from "@/features/cash/components/CashView";
import {
  getActiveCashFunds,
  getAvailableCashDates,
  getCashDailyBalancesByDate,
} from "@/app/dashboard/caixa/actions";

type FinanceiroPageProps = {
  searchParams?: {
    date?: string;
  };
};

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function FinanceiroPage({ searchParams }: FinanceiroPageProps) {
  const canView = await hasPermission("operational.view");

  if (!canView) {
    return (
      <section className="rounded border border-slate-200 bg-white p-6 shadow-executive">
        <h2 className="text-lg font-semibold text-slate-950">Financeiro</h2>
        <p className="mt-2 text-sm text-slate-500">
          Você não tem permissão para visualizar o financeiro operacional.
        </p>
      </section>
    );
  }

  const [canManageCash, availableDates, funds] = await Promise.all([
    hasPermission("cash.manage"),
    getAvailableCashDates(),
    getActiveCashFunds(),
  ]);

  const selectedDate = searchParams?.date ?? availableDates[0] ?? todayUtc();
  const balances = await getCashDailyBalancesByDate(selectedDate);

  return (
    <div className="space-y-6">
      <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
        <h2 className="text-base font-semibold text-slate-950">Financeiro operacional</h2>
        <p className="mt-1 text-sm text-slate-500">
          Aqui fica o caixa diário dos fundos que alimenta a Mesa de Operações.
        </p>
      </section>

      <CashView
        availableDates={availableDates}
        balances={balances}
        canManage={canManageCash}
        funds={funds}
        selectedDate={selectedDate}
      />
    </div>
  );
}
