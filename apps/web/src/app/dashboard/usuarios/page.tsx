import { UsersAdminPanel } from "@/features/users/components/UsersAdminPanel";
import { formatDate } from "@/lib/formatters";
import {
  getOsherAccessLevel,
  osherAccessItems,
  osherAccessPermissionKeys,
} from "@/lib/osher-access";
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
        key: true,
      },
    }),
  ]);

  const availablePermissionKeys = new Set(
    permissions.map((permission) => permission.key)
  );
  const accessOptions = osherAccessItems
    .map((item) => ({
      id: item.id,
      title: item.title,
      levels: item.levels
        .filter((level) =>
          level.permissionKeys.every((permissionKey) =>
            availablePermissionKeys.has(permissionKey)
          )
        )
        .map((level) => ({
          value: level.value,
          label: level.label,
        })),
    }))
    .filter((item) => item.levels.length > 1);

  return (
    <UsersAdminPanel
      accessOptions={accessOptions}
      users={users.map((user) => {
        const userPermissionKeys = new Set<string>();

        user.roles.forEach((userRole) => {
          userRole.role.permissions.forEach((rolePermission) => {
            if (availablePermissionKeys.has(rolePermission.permission.key)) {
              userPermissionKeys.add(rolePermission.permission.key);
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
          accessLevels: Object.fromEntries(
            osherAccessItems.map((item) => [
              item.id,
              getOsherAccessLevel(item, userPermissionKeys),
            ])
          ),
        };
      })}
    />
  );
}
