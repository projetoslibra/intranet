CREATE TABLE IF NOT EXISTS "OSHER"."qprof_cobranca" (
  "id" BIGSERIAL PRIMARY KEY,

  "loaded_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "fundo" TEXT NOT NULL,
  "linha_arquivo" INTEGER NOT NULL,

  "codigo_cedente" TEXT,
  "cedente" TEXT,
  "codigo_sacado" TEXT,
  "sacado" TEXT,
  "fone_1" TEXT,
  "fone_2" TEXT,
  "celular" TEXT,
  "s_num" TEXT,
  "situacao" TEXT,
  "dta_vcto" DATE,
  "vlr_face" NUMERIC(18, 2),
  "vlr_aberto" NUMERIC(18, 2),
  "atr" INTEGER,
  "vlr_desagio" NUMERIC(18, 2),
  "cod_ag_neg" TEXT,
  "ag_neg" TEXT,
  "vlr_desc" NUMERIC(18, 2),
  "vlr_presente" NUMERIC(18, 2),
  "vlr_mora" NUMERIC(18, 2),
  "vlr_cor_monet" NUMERIC(18, 2),
  "acordo_cobranca" TEXT,
  "vlr_pago" NUMERIC(18, 2),
  "dta_liq" DATE,
  "ai" TEXT,
  "c" TEXT,
  "p" TEXT,
  "e" TEXT,
  "m" TEXT,
  "seq_tit" TEXT,
  "carteira" TEXT,
  "cart_interna" TEXT,
  "csa" TEXT,
  "mov_cart" TEXT,
  "aditivo" TEXT,
  "dta_negociacao" DATE,
  "dta_vcto_orig" DATE,
  "rotulo" TEXT,
  "n_num" TEXT,
  "esp_doc" TEXT,
  "a_c" TEXT,
  "sit_rec" TEXT,
  "grupo_economico" TEXT,
  "status" TEXT,
  "score" NUMERIC(18, 4),
  "ur" TEXT,
  "num_op_cred_estrut" TEXT
);

CREATE INDEX IF NOT EXISTS "qprof_cobranca_fundo_idx"
  ON "OSHER"."qprof_cobranca" ("fundo");

CREATE OR REPLACE VIEW "OSHER"."qprof_cobranca_bristol" AS
SELECT *
FROM "OSHER"."qprof_cobranca"
WHERE "fundo" = 'BRISTOL FIDC - BRISTOL';

CREATE OR REPLACE VIEW "OSHER"."qprof_cobranca_antena" AS
SELECT *
FROM "OSHER"."qprof_cobranca"
WHERE "fundo" = 'ANTENA';

CREATE OR REPLACE VIEW "OSHER"."qprof_cobranca_apuama" AS
SELECT *
FROM "OSHER"."qprof_cobranca"
WHERE "fundo" = 'APUAMA';

CREATE OR REPLACE VIEW "OSHER"."qprof_cobranca_tractor" AS
SELECT *
FROM "OSHER"."qprof_cobranca"
WHERE "fundo" = 'TRACTOR';
