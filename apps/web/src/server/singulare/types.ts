import type { Prisma } from "@prisma/client";

export type SingulareFundLabel = "BRISTOL" | "APUAMA";

export type SingulareFundConfig = {
  fundClassKey: string;
  label: SingulareFundLabel;
};

export type SingulareReportRecord = Record<string, unknown>;

export type SingulareReportSections = Record<string, SingulareReportRecord[]>;

export type CarteiraConsolidadaInput = {
  dataPosicao: Date;
  ativo: string;
  valor: Prisma.Decimal;
  fundo: SingulareFundLabel;
  dataAnalise: Date;
};

export type SingulareFundImportResult = {
  fundo: SingulareFundLabel;
  fundClassKey: string;
  fetched: boolean;
  transformedRows: number;
  upsertedRows: number;
  skippedRows: number;
  message?: string;
};

export type SingulareImportResult = {
  dataAnalise: string;
  totalRows: number;
  funds: SingulareFundImportResult[];
};

export type CaixaSingulareInput = {
  dataLiquidacao: Date;
  tipoDeRegistro: number;
  descricao: string;
  entradas: Prisma.Decimal;
  saidas: Prisma.Decimal;
  saldo: Prisma.Decimal;
  historicoTraduzido: string | null;
  idConta: number | null;
  banco: string | null;
  agencia: string | null;
  contaCorrente: string | null;
  digito: string | null;
  contaInvestimento: string | null;
  cpfDoCliente: string | null;
  clienteNome: string;
  clienteId: string;
  dataAnalise: Date;
};

export type SingulareCaixaImportResult = {
  dataAnalise: string;
  fetchedRows: number;
  importedRows: number;
  skippedRows: number;
};
