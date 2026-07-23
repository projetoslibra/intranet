CREATE TABLE "FIDC_ESTOQUES" (
  "id" TEXT NOT NULL,
  "nomeFundo" TEXT NOT NULL,
  "docFundo" TEXT,
  "dataFundo" DATE,
  "nomeGestor" TEXT,
  "docGestor" TEXT,
  "nomeOriginador" TEXT,
  "docOriginador" TEXT,
  "nomeCedente" TEXT NOT NULL,
  "docCedente" TEXT,
  "nomeSacado" TEXT NOT NULL,
  "docSacado" TEXT,
  "seuNumero" TEXT,
  "numeroDocumento" TEXT NOT NULL,
  "tipoRecebivel" TEXT,
  "valorNominal" DECIMAL(24, 10) NOT NULL DEFAULT 0,
  "valorPresente" DECIMAL(24, 10) NOT NULL DEFAULT 0,
  "valorAquisicao" DECIMAL(24, 10) NOT NULL DEFAULT 0,
  "valorPdd" DECIMAL(24, 10) NOT NULL DEFAULT 0,
  "faixaPdd" TEXT,
  "dataReferencia" DATE NOT NULL,
  "dataVencimentoOriginal" DATE NOT NULL,
  "dataVencimentoAjustada" DATE,
  "dataEmissao" DATE,
  "dataAquisicao" DATE,
  "prazo" INTEGER,
  "prazoAnual" INTEGER,
  "situacaoRecebivel" TEXT,
  "taxaCessao" DECIMAL(18, 10),
  "taxaRecebivel" DECIMAL(18, 10),
  "coobrigacao" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FIDC_ESTOQUES_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fidc_estoques_logical_unique" ON "FIDC_ESTOQUES" (
  "nomeFundo",
  "dataReferencia",
  "nomeCedente",
  "dataVencimentoOriginal",
  "valorPresente",
  "numeroDocumento",
  "nomeSacado"
);

CREATE INDEX "FIDC_ESTOQUES_dataReferencia_nomeFundo_idx" ON "FIDC_ESTOQUES" ("dataReferencia", "nomeFundo");
CREATE INDEX "FIDC_ESTOQUES_dataReferencia_nomeCedente_idx" ON "FIDC_ESTOQUES" ("dataReferencia", "nomeCedente");
CREATE INDEX "FIDC_ESTOQUES_numeroDocumento_idx" ON "FIDC_ESTOQUES" ("numeroDocumento");
