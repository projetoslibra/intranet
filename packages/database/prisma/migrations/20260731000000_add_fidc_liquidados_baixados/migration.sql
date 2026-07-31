CREATE TABLE "FIDC_LIQUIDADOS_BAIXADOS" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batch_id" TEXT,
  "fundoNome" TEXT NOT NULL,
  "fundoCnpj" TEXT,
  "dataDaPosicao" DATE NOT NULL,
  "cedente" TEXT NOT NULL,
  "identificacaoCedente" TEXT,
  "sacado" TEXT NOT NULL,
  "identificacaoSacado" TEXT,
  "txAquisicao" DECIMAL(18, 10),
  "idRecebivel" TEXT NOT NULL,
  "valorAquisicao" DECIMAL(24, 10) NOT NULL DEFAULT 0,
  "valorVencimento" DECIMAL(24, 10) NOT NULL DEFAULT 0,
  "dataAquisicao" DATE,
  "dataVencimento" DATE NOT NULL,
  "valorPago" DECIMAL(24, 10) NOT NULL DEFAULT 0,
  "stRecebivel" TEXT,
  "ajuste" DECIMAL(24, 10) NOT NULL DEFAULT 0,
  "numeroCorrespondente" TEXT,
  "seuNumero" TEXT,
  "documento" TEXT NOT NULL,
  "tipoRecebivel" TEXT,
  "tipoMovimento" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FIDC_LIQUIDADOS_BAIXADOS_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fidc_liquidados_baixados_logical_unique" ON "FIDC_LIQUIDADOS_BAIXADOS" (
  "fundoNome",
  "fundoCnpj",
  "dataDaPosicao",
  "cedente",
  "identificacaoCedente",
  "sacado",
  "identificacaoSacado",
  "txAquisicao",
  "idRecebivel",
  "valorAquisicao",
  "valorVencimento",
  "dataAquisicao",
  "dataVencimento",
  "valorPago",
  "stRecebivel",
  "ajuste",
  "numeroCorrespondente",
  "seuNumero",
  "documento",
  "tipoRecebivel",
  "tipoMovimento"
);

CREATE INDEX "FIDC_LIQUIDADOS_BAIXADOS_dataDaPosicao_fundoNome_idx" ON "FIDC_LIQUIDADOS_BAIXADOS" ("dataDaPosicao", "fundoNome");
CREATE INDEX "FIDC_LIQUIDADOS_BAIXADOS_dataVencimento_fundoNome_idx" ON "FIDC_LIQUIDADOS_BAIXADOS" ("dataVencimento", "fundoNome");
CREATE INDEX "FIDC_LIQUIDADOS_BAIXADOS_idRecebivel_idx" ON "FIDC_LIQUIDADOS_BAIXADOS" ("idRecebivel");
CREATE INDEX "FIDC_LIQUIDADOS_BAIXADOS_documento_idx" ON "FIDC_LIQUIDADOS_BAIXADOS" ("documento");
CREATE INDEX "FIDC_LIQUIDADOS_BAIXADOS_seuNumero_idx" ON "FIDC_LIQUIDADOS_BAIXADOS" ("seuNumero");

ALTER TABLE "FIDC_LIQUIDADOS_BAIXADOS"
  ADD CONSTRAINT "FIDC_LIQUIDADOS_BAIXADOS_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
