export type CashFund = {
  id: string;
  name: string;
  shortName: string;
};

/**
 * Posição diária de caixa de um fundo, serializada para o client.
 * Valores monetários trafegam como string (Decimal serializado) para
 * preservar a precisão financeira.
 */
export type CashDailyBalance = {
  fundId: string;
  fundName: string;
  fundShortName: string;
  referenceDate: string; // yyyy-mm-dd
  receivingBalance: string;
  reconciliationBalance: string;
  reserveBalance: string;
  paymentBalance: string;
  usedAmount: string;
  cash: string; // calculado: paymentBalance - reserveBalance - usedAmount
  note: string | null;
};

export type CashBalanceInput = {
  fundId: string;
  receivingBalance: number;
  reconciliationBalance: number;
  reserveBalance: number;
  paymentBalance: number;
  usedAmount: number;
  note?: string;
};

export type CashBatchInput = {
  referenceDate: string; // yyyy-mm-dd
  balances: CashBalanceInput[];
};

export type CashActionResult = {
  ok: boolean;
  message: string;
};
