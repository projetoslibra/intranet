export type CashFundAccessResult =
  | { ok: true }
  | { ok: false; message: string };

export async function validateCashFundIdsWithDependencies(
  fundIds: readonly string[],
  findEnabledFundIds: (fundIds: string[]) => Promise<string[]>
): Promise<CashFundAccessResult> {
  const uniqueFundIds = Array.from(new Set(fundIds));
  if (uniqueFundIds.length === 0) {
    return { ok: false, message: "Informe ao menos um fundo." };
  }

  const enabledFundIds = new Set(await findEnabledFundIds(uniqueFundIds));
  if (uniqueFundIds.some((fundId) => !enabledFundIds.has(fundId))) {
    return {
      ok: false,
      message: "Um ou mais fundos nao estao habilitados no Caixa.",
    };
  }

  return { ok: true };
}
