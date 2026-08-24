-- Backfill idempotente: conciliacoes bancarias ACTIVE fechadas antes da
-- composicao por titulos/Outros (modelo antigo, com diferenca justificada
-- apenas em texto livre) nao tem nenhum registro em
-- consignado_bank_difference_titles/consignado_bank_other_differences,
-- entao a diferenca fica invisivel na aba "Diferencas e ajustes". Este
-- backfill cria a pendencia "Outro" OPEN correspondente, preservando o
-- texto original como motivo. Reconciliacoes criadas pelo fluxo novo nunca
-- caem aqui, pois sempre fecham a equacao com titulos e/ou Outros.
INSERT INTO "consignado_bank_other_differences" (
  "id", "reconciliation_id", "created_by_user_id", "category", "direction",
  "amount", "reason", "status", "created_at"
)
SELECT
  'backfill_other_' || md5(r."id"),
  r."id",
  r."created_by_user_id",
  'OTHER'::"BankDifferenceCategory",
  CASE WHEN r."entry_total_amount" >= r."remittance_total_amount" THEN 'ENTRY_EXCESS' ELSE 'REMITTANCE_EXCESS' END::"BankDifferenceDirection",
  r."difference_amount",
  COALESCE(NULLIF(r."difference_reason", ''), 'Diferenca historica registrada antes da composicao por titulos/Outros.'),
  'OPEN'::"BankDifferenceStatus",
  r."created_at"
FROM "consignado_bank_reconciliations" r
WHERE r."status" = 'ACTIVE'
  AND r."difference_amount" > 0
  AND NOT EXISTS (SELECT 1 FROM "consignado_bank_difference_titles" t WHERE t."reconciliation_id" = r."id")
  AND NOT EXISTS (SELECT 1 FROM "consignado_bank_other_differences" o WHERE o."reconciliation_id" = r."id")
ON CONFLICT ("id") DO NOTHING;
