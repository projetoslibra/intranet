ALTER TABLE "FIDC_MOVIMENTOS_ABERTOS"
  ADD COLUMN "periodo" TEXT NOT NULL DEFAULT 'MANHA';

DROP INDEX "fidc_movimentos_abertos_logical_unique";

CREATE UNIQUE INDEX "fidc_movimentos_abertos_logical_unique" ON "FIDC_MOVIMENTOS_ABERTOS" (
  "dataReferencia",
  "periodo",
  "nomeFundo",
  "docFundo",
  "dataMovimento",
  "seuNumero",
  "numeroDocumento",
  "tipoMovimento",
  "dataVencimento",
  "valorAquisicao",
  "valorNominal",
  "valorMovimentacao"
);
