-- O mesmo arquivo de baixa pode ser reprocessado após confirmação do operador.
DROP INDEX IF EXISTS "consignado_settlement_batches_fund_id_source_file_hash_key";

CREATE INDEX "consignado_settlement_batches_fund_id_source_file_hash_idx"
  ON "consignado_settlement_batches"("fund_id", "source", "file_hash");
