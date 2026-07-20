import { UsersAdminPanel } from "@/features/users/components/UsersAdminPanel";
import { formatDate } from "@/lib/formatters";
import { osherAccessItems, osherAccessPermissionKeys } from "@/lib/osher-access";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export default async function UsersPage() {
  const canManageUsers = await hasPermission("users.manage");

  if (!canManageUsers) {
    return (
      <section className="rounded border border-slate-200 bg-white p-6 shadow-executive">
        <h2 className="text-lg font-semibold text-slate-950">Usuarios</h2>
        <p className="mt-2 text-sm text-slate-500">
          Voce nao tem permissao para gerenciar usuarios.
        </p>
      </section>
    );
  }

  const [users, permissions] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        roles: {
          select: {
            role: {
              select: {
                permissions: {
                  select: {
                    permission: {
                      select: {
                        id: true,
                        key: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.permission.findMany({
      where: {
        key: {
          in: osherAccessPermissionKeys,
        },
      },
      select: {
        id: true,
        key: true,
      },
    }),
  ]);

  const permissionByKey = new Map(
    permissions.map((permission) => [permission.key, permission])
  );
  const accessOptions = osherAccessItems.flatMap((item) => {
    const permission = permissionByKey.get(item.permissionKey);

    if (!permission) {
      return [];
    }

    return [
      {
        id: permission.id,
        title: item.title,
        permissionKey: item.permissionKey,
      },
    ];
  });

  return (
    <UsersAdminPanel
      accessOptions={accessOptions}
      users={users.map((user) => {
        const accessPermissionIds = new Set<string>();

        user.roles.forEach((userRole) => {
          userRole.role.permissions.forEach((rolePermission) => {
            if (permissionByKey.has(rolePermission.permission.key)) {
              accessPermissionIds.add(rolePermission.permission.id);
            }
          });
        });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          status: user.status,
          createdAt: formatDate(user.createdAt),
          updatedAt: formatDate(user.updatedAt),
          accessPermissionIds: Array.from(accessPermissionIds),
        };
      })}
    />
  );
}
