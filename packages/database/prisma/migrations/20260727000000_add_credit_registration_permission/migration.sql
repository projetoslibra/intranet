INSERT INTO "permissions" ("id", "key", "description") VALUES
('perm_credit_registration_view', 'credit-registration.view', 'Visualizar dashboard de Crédito & Cadastro')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT "roles"."id", "permissions"."id"
FROM "roles"
CROSS JOIN "permissions"
WHERE "roles"."name" = 'ADMIN'
  AND "permissions"."key" = 'credit-registration.view'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
