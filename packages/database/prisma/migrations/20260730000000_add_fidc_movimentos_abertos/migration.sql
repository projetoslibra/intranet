ALTER TYPE "ImportModule" ADD VALUE IF NOT EXISTS 'FIDC_OPEN_MOVEMENT';

CREATE TABLE "FIDC_MOVIMENTOS_ABERTOS" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batch_id" TEXT,
  "nomeFundo" TEXT NOT NULL,
  "docFundo" TEXT,
  "dataMovimento" DATE NOT NULL,
  "seuNumero" TEXT,
  "numeroDocumento" TEXT NOT NULL,
  "tipoMovimento" TEXT NOT NULL,
  "dataVencimento" DATE NOT NULL,
  "valorAquisicao" DECIMAL(24, 10) NOT NULL DEFAULT 0,
  "valorNominal" DECIMAL(24, 10) NOT NULL DEFAULT 0,
  "valorMovimentacao" DECIMAL(24, 10) NOT NULL DEFAULT 0,
  "dataReferencia" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FIDC_MOVIMENTOS_ABERTOS_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fidc_movimentos_abertos_logical_unique" ON "FIDC_MOVIMENTOS_ABERTOS" (
  "dataReferencia",
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

CREATE INDEX "FIDC_MOVIMENTOS_ABERTOS_dataReferencia_nomeFundo_idx" ON "FIDC_MOVIMENTOS_ABERTOS" ("dataReferencia", "nomeFundo");
CREATE INDEX "FIDC_MOVIMENTOS_ABERTOS_dataMovimento_nomeFundo_idx" ON "FIDC_MOVIMENTOS_ABERTOS" ("dataMovimento", "nomeFundo");
CREATE INDEX "FIDC_MOVIMENTOS_ABERTOS_numeroDocumento_idx" ON "FIDC_MOVIMENTOS_ABERTOS" ("numeroDocumento");

ALTER TABLE "FIDC_MOVIMENTOS_ABERTOS"
  ADD CONSTRAINT "FIDC_MOVIMENTOS_ABERTOS_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
