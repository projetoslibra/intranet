INSERT INTO "permissions" ("id", "key", "description") VALUES
('perm_forecasts_view', 'forecasts.view', 'Permissao forecasts.view'),
('perm_reports_view', 'reports.view', 'Permissao reports.view')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT "roles"."id", "permissions"."id"
FROM "roles"
CROSS JOIN "permissions"
WHERE "roles"."name" = 'ADMIN'
  AND "permissions"."key" IN ('forecasts.view', 'reports.view')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
