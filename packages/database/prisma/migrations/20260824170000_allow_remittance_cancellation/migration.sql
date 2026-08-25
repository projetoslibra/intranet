DROP INDEX IF EXISTS "consignado_remittances_batch_id_key";
DROP INDEX IF EXISTS "consignado_remittance_items_settlement_item_id_key";

CREATE INDEX IF NOT EXISTS "consignado_remittances_batch_id_idx"
  ON "consignado_remittances"("batch_id");

CREATE INDEX IF NOT EXISTS "consignado_remittance_items_settlement_item_id_idx"
  ON "consignado_remittance_items"("settlement_item_id");
