"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export type UserFormState = {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

const statusValues = ["ACTIVE", "INACTIVE", "BLOCKED"] as const;

const baseUserSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome."),
  email: z
    .string()
    .trim()
    .email("Informe um e-mail valido.")
    .transform((email) => email.toLowerCase()),
  status: z.enum(statusValues),
  permissionIds: z
    .array(z.string().min(1))
    .min(1, "Selecione ao menos uma aba."),
});

const createUserSchema = baseUserSchema.extend({
  password: z.string().min(8, "A senha deve ter ao menos 8 caracteres."),
});

const updateUserSchema = baseUserSchema
  .extend({
    id: z.string().min(1, "Usuario invalido."),
    password: z.string().optional(),
  })
  .superRefine((data, context) => {
    if (data.password && data.password.length < 8) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A senha deve ter ao menos 8 caracteres.",
        path: ["password"],
      });
    }
  });

const deleteUserSchema = z.object({
  id: z.string().min(1, "Usuario invalido."),
});

function readPermissionIds(formData: FormData) {
  return Array.from(
    new Set(formData.getAll("permissionIds").map(String).filter(Boolean))
  );
}

function accessRoleName(userId: string) {
  return `USER_ACCESS_${userId}`;
}

async function assertCanManageUsers(): Promise<UserFormState | null> {
  if (await hasPermission("users.manage")) {
    return null;
  }

  return {
    ok: false,
    message: "Voce nao tem permissao para gerenciar usuarios.",
  };
}

async function assertNotSelf(userId: string): Promise<UserFormState | null> {
  const session = await auth();

  if (session?.user?.id !== userId) {
    return null;
  }

  return {
    ok: false,
    message: "Voce nao pode alterar o proprio acesso por esta tela.",
  };
}

async function validatePermissions(permissionIds: string[]): Promise<boolean> {
  const permissionsCount = await prisma.permission.count({
    where: {
      id: {
        in: permissionIds,
      },
    },
  });

  return permissionsCount === permissionIds.length;
}

async function syncUserAccessRole(userId: string, permissionIds: string[]) {
  await prisma.$transaction(async (transaction) => {
    const role = await transaction.role.upsert({
      where: { name: accessRoleName(userId) },
      update: {
        description: "Acessos selecionados na tela de usuarios.",
      },
      create: {
        name: accessRoleName(userId),
        description: "Acessos selecionados na tela de usuarios.",
      },
    });

    await transaction.rolePermission.deleteMany({
      where: {
        roleId: role.id,
      },
    });

    await transaction.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({
        roleId: role.id,
        permissionId,
      })),
      skipDuplicates: true,
    });

    await transaction.userRole.upsert({
      where: {
        userId_roleId: {
          userId,
          roleId: role.id,
        },
      },
      update: {},
      create: {
        userId,
        roleId: role.id,
      },
    });
  });
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export async function createUserAction(
  _previousState: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  const permissionError = await assertCanManageUsers();

  if (permissionError) {
    return permissionError;
  }

  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    status: formData.get("status"),
    permissionIds: readPermissionIds(formData),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Revise os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  if (!(await validatePermissions(parsed.data.permissionIds))) {
    return {
      ok: false,
      message: "Uma das abas selecionadas nao existe mais.",
    };
  }

  try {
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);

    const user = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash,
        status: parsed.data.status,
      },
      select: {
        id: true,
      },
    });

    await syncUserAccessRole(user.id, parsed.data.permissionIds);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return {
        ok: false,
        message: "Ja existe um usuario cadastrado com este e-mail.",
      };
    }

    return {
      ok: false,
      message: "Nao foi possivel criar o usuario.",
    };
  }

  revalidatePath("/dashboard/usuarios");

  return {
    ok: true,
    message: "Usuario criado com sucesso.",
  };
}

export async function updateUserAction(
  _previousState: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  const permissionError = await assertCanManageUsers();

  if (permissionError) {
    return permissionError;
  }

  const password = String(formData.get("password") ?? "").trim();
  const parsed = updateUserSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: password || undefined,
    status: formData.get("status"),
    permissionIds: readPermissionIds(formData),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Revise os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const selfError = await assertNotSelf(parsed.data.id);

  if (selfError) {
    return selfError;
  }

  if (!(await validatePermissions(parsed.data.permissionIds))) {
    return {
      ok: false,
      message: "Uma das abas selecionadas nao existe mais.",
    };
  }

  try {
    const data: {
      name: string;
      email: string;
      status: (typeof statusValues)[number];
      passwordHash?: string;
    } = {
      name: parsed.data.name,
      email: parsed.data.email,
      status: parsed.data.status,
    };

    if (parsed.data.password) {
      data.passwordHash = await bcrypt.hash(parsed.data.password, 12);
    }

    await prisma.user.update({
      where: { id: parsed.data.id },
      data,
    });

    await syncUserAccessRole(parsed.data.id, parsed.data.permissionIds);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return {
        ok: false,
        message: "Ja existe um usuario cadastrado com este e-mail.",
      };
    }

    return {
      ok: false,
      message: "Nao foi possivel atualizar o usuario.",
    };
  }

  revalidatePath("/dashboard/usuarios");

  return {
    ok: true,
    message: "Usuario atualizado com sucesso.",
  };
}

export async function deleteUserAction(
  _previousState: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  const permissionError = await assertCanManageUsers();

  if (permissionError) {
    return permissionError;
  }

  const parsed = deleteUserSchema.safeParse({
    id: formData.get("id"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Usuario invalido.",
    };
  }

  const selfError = await assertNotSelf(parsed.data.id);

  if (selfError) {
    return selfError;
  }

  try {
    await prisma.user.delete({
      where: { id: parsed.data.id },
    });
  } catch {
    return {
      ok: false,
      message:
        "Nao foi possivel excluir. Se houver historico vinculado, bloqueie ou inative o usuario.",
    };
  }

  revalidatePath("/dashboard/usuarios");

  return {
    ok: true,
    message: "Usuario excluido com sucesso.",
  };
}
