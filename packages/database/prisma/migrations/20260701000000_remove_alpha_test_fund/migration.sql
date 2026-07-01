DELETE FROM "company_cash_daily_balances"
WHERE "fundId" IN (
  SELECT "id"
  FROM "funds"
  WHERE "cnpj" = '00.000.000/0001-00'
     OR "name" = 'FIDC Alpha Senior'
);

DELETE FROM "fund_quotes"
WHERE "fundId" IN (
  SELECT "id"
  FROM "funds"
  WHERE "cnpj" = '00.000.000/0001-00'
     OR "name" = 'FIDC Alpha Senior'
);

DELETE FROM "financial_positions"
WHERE "fundId" IN (
  SELECT "id"
  FROM "funds"
  WHERE "cnpj" = '00.000.000/0001-00'
     OR "name" = 'FIDC Alpha Senior'
);

DELETE FROM "dre_entries"
WHERE "fundId" IN (
  SELECT "id"
  FROM "funds"
  WHERE "cnpj" = '00.000.000/0001-00'
     OR "name" = 'FIDC Alpha Senior'
);

DELETE FROM "fund_cash_flows"
WHERE "fundId" IN (
  SELECT "id"
  FROM "funds"
  WHERE "cnpj" = '00.000.000/0001-00'
     OR "name" = 'FIDC Alpha Senior'
);

DELETE FROM "user_fund_accesses"
WHERE "fundId" IN (
  SELECT "id"
  FROM "funds"
  WHERE "cnpj" = '00.000.000/0001-00'
     OR "name" = 'FIDC Alpha Senior'
);

DELETE FROM "funds"
WHERE "cnpj" = '00.000.000/0001-00'
   OR "name" = 'FIDC Alpha Senior';
