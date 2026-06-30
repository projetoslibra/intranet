-- CreateTable
CREATE TABLE "CARTEIRAS" (
    "id" TEXT NOT NULL,
    "data_posicao" DATE NOT NULL,
    "ativo" TEXT NOT NULL,
    "valor" DECIMAL(24,10) NOT NULL,
    "fundo" TEXT NOT NULL,
    "data_analise" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CARTEIRAS_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CARTEIRAS_data_analise_fundo_ativo_key"
ON "CARTEIRAS"("data_analise", "fundo", "ativo");

-- CreateIndex
CREATE INDEX "CARTEIRAS_data_analise_fundo_idx"
ON "CARTEIRAS"("data_analise", "fundo");
