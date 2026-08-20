import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissionSetHas } from "@/lib/permission-keys";

/**
 * Carrega o conjunto de chaves de permissão (`cash.view`, `cash.manage`, ...)
 * do usuário autenticado, consultando roles -> permissions no banco.
 *
 * A sessão só guarda o nome do role, então o gate granular é resolvido aqui.
 */
export async function getCurrentUserPermissions(): Promise<Set<string>> {
  const session = await auth();

  if (!session?.user?.id) {
    return new Set();
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      roles: {
        select: {
          role: {
            select: {
              permissions: {
                select: { permission: { select: { key: true } } },
              },
            },
          },
        },
      },
    },
  });

  const keys = new Set<string>();
  user?.roles.forEach((userRole) => {
    userRole.role.permissions.forEach((rolePermission) => {
      keys.add(rolePermission.permission.key);
    });
  });

  return keys;
}

export async function hasPermission(key: string): Promise<boolean> {
  const permissions = await getCurrentUserPermissions();
  return permissionSetHas(permissions, key);
}
