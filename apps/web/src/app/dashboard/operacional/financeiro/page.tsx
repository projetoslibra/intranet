import { hasPermission } from "@/lib/permissions";
import { CashView } from "@/features/cash/components/CashView";
import { OperationalImportPanel } from "@/features/operational/components/OperationalImportPanel";
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

  const [canManageCash, canImportStock, canImportDimension, availableDates, funds] =
    await Promise.all([
      hasPermission("cash.manage"),
      hasPermission("operational.stock.import"),
      hasPermission("operational.dimension.import"),
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
          Aqui ficam o caixa diário dos fundos e as bases que alimentam a Mesa de Operações.
        </p>
      </section>

      <CashView
        availableDates={availableDates}
        balances={balances}
        canManage={canManageCash}
        funds={funds}
        selectedDate={selectedDate}
      />

      <div className="grid gap-5 xl:grid-cols-2">
        {canImportStock ? (
          <OperationalImportPanel
            description="Importa a posição analítica de recebíveis do fundo e guarda uma nova versão histórica."
            detectStockMetadata
            endpoint="/api/operacional/estoque/import"
            submitLabel="Importar estoque"
            title="Upload de estoque"
          />
        ) : null}

        {canImportDimension ? (
          <OperationalImportPanel
            dateField={{
              name: "referenceDate",
              label: "Data de referência da DIM",
              defaultValue: selectedDate,
            }}
            description="Atualiza a DIM_cedentes a partir do Google Sheets e mantém snapshot histórico."
            endpoint="/api/operacional/dim-cedentes/import"
            fileField={false}
            submitLabel="Atualizar DIM"
            title="DIM cedentes"
          />
        ) : null}
      </div>
    </div>
  );
}
