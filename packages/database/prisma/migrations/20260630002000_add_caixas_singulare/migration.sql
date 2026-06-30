-- CreateTable
CREATE TABLE "CAIXAS" (
    "id" TEXT NOT NULL,
    "data_liquidacao" DATE NOT NULL,
    "tipo_de_registro" INTEGER NOT NULL,
    "descricao" TEXT NOT NULL,
    "entradas" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "saidas" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "saldo" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "historico_traduzido" TEXT,
    "id_conta" INTEGER,
    "banco" TEXT,
    "agencia" TEXT,
    "conta_corrente" TEXT,
    "digito" TEXT,
    "conta_investimento" TEXT,
    "cpf_do_cliente" TEXT,
    "cliente_nome" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "data_analise" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CAIXAS_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CAIXAS_data_analise_cliente_id_idx"
ON "CAIXAS"("data_analise", "cliente_id");
