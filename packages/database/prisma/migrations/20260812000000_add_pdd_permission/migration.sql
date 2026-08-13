INSERT INTO "permissions" ("id", "key", "description") VALUES
('perm_pdd_view', 'pdd.view', 'Visualizar painel de PDD')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT "roles"."id", "permissions"."id"
FROM "roles"
CROSS JOIN "permissions"
WHERE "roles"."name" = 'ADMIN'
  AND "permissions"."key" = 'pdd.view'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
