"use client";

import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  createUserAction,
  deleteUserAction,
  updateUserAction,
  type UserFormState,
} from "@/app/dashboard/usuarios/actions";
import {
  osherAccessFieldName,
  type OsherAccessLevel,
} from "@/lib/osher-access";

export type AccessOption = {
  id: string;
  title: string;
  levels: {
    value: OsherAccessLevel;
    label: string;
  }[];
};

export type UserRow = {
  id: string;
  name: string;
  email: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  accessLevels: Record<string, OsherAccessLevel>;
};

type UsersAdminPanelProps = {
  accessOptions: AccessOption[];
  users: UserRow[];
};

const initialState: UserFormState = {
  ok: false,
  message: "",
};

const statusLabels: Record<string, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
  BLOCKED: "Bloqueado",
};

const statusBadgeClasses: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700",
  INACTIVE: "bg-slate-100 text-slate-600",
  BLOCKED: "bg-red-50 text-red-700",
};

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }

  return <p className="text-xs font-medium text-destructive">{message}</p>;
}

function SubmitButton({
  idleLabel,
  pendingLabel,
  icon,
  variant = "primary",
}: {
  idleLabel: string;
  pendingLabel: string;
  icon: ReactNode;
  variant?: "primary" | "danger";
}) {
  const { pending } = useFormStatus();
  const className =
    variant === "danger"
      ? "inline-flex h-10 items-center justify-center gap-2 rounded border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-70"
      : "inline-flex h-10 items-center justify-center gap-2 rounded bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70";

  return (
    <button className={className} disabled={pending} type="submit">
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}

function StateMessage({ state }: { state: UserFormState }) {
  if (!state.message) {
    return null;
  }

  return (
    <div
      className={`rounded border px-3 py-2 text-sm ${
        state.ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-red-200 bg-red-50 text-red-700"
      }`}
    >
      {state.message}
    </div>
  );
}

function AccessChecks({
  accessOptions,
  idPrefix,
  selectedAccessLevels,
}: {
  accessOptions: AccessOption[];
  idPrefix: string;
  selectedAccessLevels: Record<string, OsherAccessLevel>;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {accessOptions.map((access) => (
        <div
          className="space-y-2 rounded border border-slate-200 bg-white p-3"
          key={access.id}
        >
          <label
            className="text-sm font-medium text-slate-700"
            htmlFor={`${idPrefix}-${osherAccessFieldName(access.id)}`}
          >
            {access.title}
          </label>
          <select
            className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            defaultValue={selectedAccessLevels[access.id] ?? "NONE"}
            id={`${idPrefix}-${osherAccessFieldName(access.id)}`}
            name={osherAccessFieldName(access.id)}
          >
            {access.levels.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function CreateUserForm({ accessOptions }: { accessOptions: AccessOption[] }) {
  const [state, formAction] = useFormState(createUserAction, initialState);

  return (
    <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-slate-950">Novo usuario</h2>
      </div>

      <form action={formAction} className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="name">
              Nome
            </label>
            <input
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              id="name"
              name="name"
              type="text"
            />
            <FieldError message={state.fieldErrors?.name?.[0]} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="email">
              E-mail
            </label>
            <input
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              id="email"
              name="email"
              type="email"
            />
            <FieldError message={state.fieldErrors?.email?.[0]} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="password">
              Senha
            </label>
            <input
              autoComplete="new-password"
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              id="password"
              name="password"
              type="password"
            />
            <FieldError message={state.fieldErrors?.password?.[0]} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="status">
              Status
            </label>
            <select
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              defaultValue="ACTIVE"
              id="status"
              name="status"
            >
              <option value="ACTIVE">Ativo</option>
              <option value="INACTIVE">Inativo</option>
              <option value="BLOCKED">Bloqueado</option>
            </select>
            <FieldError message={state.fieldErrors?.status?.[0]} />
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-sm font-medium text-slate-700">
            Nível de acesso por aba
          </span>
          <p className="text-xs text-slate-500">
            Visualizadores consultam os dados; operadores também podem editar.
          </p>
          <AccessChecks
            accessOptions={accessOptions}
            idPrefix="create"
            selectedAccessLevels={{}}
          />
          <FieldError message={state.fieldErrors?.permissionKeys?.[0]} />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SubmitButton
            icon={<Plus className="h-4 w-4" />}
            idleLabel="Criar usuario"
            pendingLabel="Criando..."
          />
          <StateMessage state={state} />
        </div>
      </form>
    </section>
  );
}

function DeleteUserForm({ userId, userName }: { userId: string; userName: string }) {
  const [state, formAction] = useFormState(deleteUserAction, initialState);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <form
        action={formAction}
        onSubmit={(event) => {
          if (!window.confirm(`Excluir ${userName}?`)) {
            event.preventDefault();
          }
        }}
      >
        <input name="id" type="hidden" value={userId} />
        <SubmitButton
          icon={<Trash2 className="h-4 w-4" />}
          idleLabel="Excluir"
          pendingLabel="Excluindo..."
          variant="danger"
        />
      </form>
      <StateMessage state={state} />
    </div>
  );
}

function UserCard({
  accessOptions,
  user,
}: {
  accessOptions: AccessOption[];
  user: UserRow;
}) {
  const [state, formAction] = useFormState(updateUserAction, initialState);

  return (
    <article className="rounded border border-slate-200 bg-white p-5 shadow-executive">
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-950">{user.name}</h3>
            <span
              className={`rounded px-2.5 py-1 text-xs font-semibold ${
                statusBadgeClasses[user.status] ?? "bg-slate-100 text-slate-600"
              }`}
            >
              {statusLabels[user.status] ?? user.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">{user.email}</p>
        </div>
        <div className="text-xs text-slate-500 lg:text-right">
          <p>Criado em {user.createdAt}</p>
          <p>Atualizado em {user.updatedAt}</p>
        </div>
      </div>

      <form action={formAction} className="space-y-4">
        <input name="id" type="hidden" value={user.id} />

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor={`name-${user.id}`}>
              Nome
            </label>
            <input
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              defaultValue={user.name}
              id={`name-${user.id}`}
              name="name"
              type="text"
            />
            <FieldError message={state.fieldErrors?.name?.[0]} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor={`email-${user.id}`}>
              E-mail
            </label>
            <input
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              defaultValue={user.email}
              id={`email-${user.id}`}
              name="email"
              type="email"
            />
            <FieldError message={state.fieldErrors?.email?.[0]} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor={`status-${user.id}`}>
              Status
            </label>
            <select
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              defaultValue={user.status}
              id={`status-${user.id}`}
              name="status"
            >
              <option value="ACTIVE">Ativo</option>
              <option value="INACTIVE">Inativo</option>
              <option value="BLOCKED">Bloqueado</option>
            </select>
            <FieldError message={state.fieldErrors?.status?.[0]} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor={`password-${user.id}`}>
              Nova senha
            </label>
            <input
              autoComplete="new-password"
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              id={`password-${user.id}`}
              name="password"
              placeholder="Manter atual"
              type="password"
            />
            <FieldError message={state.fieldErrors?.password?.[0]} />
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-sm font-medium text-slate-700">
            Nível de acesso por aba
          </span>
          <p className="text-xs text-slate-500">
            Visualizadores consultam os dados; operadores também podem editar.
          </p>
          <AccessChecks
            accessOptions={accessOptions}
            idPrefix={user.id}
            selectedAccessLevels={user.accessLevels}
          />
          <FieldError message={state.fieldErrors?.permissionKeys?.[0]} />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SubmitButton
            icon={<Save className="h-4 w-4" />}
            idleLabel="Salvar"
            pendingLabel="Salvando..."
          />
          <StateMessage state={state} />
        </div>
      </form>

      <div className="mt-4 border-t border-slate-100 pt-4">
        <DeleteUserForm userId={user.id} userName={user.name} />
      </div>
    </article>
  );
}

export function UsersAdminPanel({ accessOptions, users }: UsersAdminPanelProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const filteredUsers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return users.filter((user) => {
      const matchesSearch =
        !normalizedSearch ||
        user.name.toLowerCase().includes(normalizedSearch) ||
        user.email.toLowerCase().includes(normalizedSearch);
      const matchesStatus =
        statusFilter === "ALL" || user.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [search, statusFilter, users]);

  return (
    <div className="space-y-5">
      <CreateUserForm accessOptions={accessOptions} />

      <section className="space-y-3">
        <div className="flex flex-col gap-3 rounded border border-slate-200 bg-white px-5 py-4 shadow-executive lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Usuarios</h2>
            <p className="mt-1 text-sm text-slate-500">
              {filteredUsers.length} de {users.length} usuarios
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-[260px_180px]">
            <input
              className="h-10 rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome ou e-mail"
              type="search"
              value={search}
            />
            <select
              className="h-10 rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              onChange={(event) => setStatusFilter(event.target.value)}
              value={statusFilter}
            >
              <option value="ALL">Todos os status</option>
              <option value="ACTIVE">Ativo</option>
              <option value="INACTIVE">Inativo</option>
              <option value="BLOCKED">Bloqueado</option>
            </select>
          </div>
        </div>

        {filteredUsers.length > 0 ? (
          <div className="space-y-3">
            {filteredUsers.map((user) => (
              <UserCard
                accessOptions={accessOptions}
                key={user.id}
                user={user}
              />
            ))}
          </div>
        ) : (
          <div className="rounded border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-executive">
            Nenhum usuario encontrado.
          </div>
        )}
      </section>
    </div>
  );
}
