"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useFormState, useFormStatus } from "react-dom";
import {
  deleteFundAction,
  type DeleteFundState,
} from "@/app/dashboard/fundos/actions";

type FundRow = {
  id: string;
  name: string;
  shortName: string;
  cnpj: string;
  fundType: string;
  status: string;
  startDate: string;
};

type FundsTableProps = {
  canManage: boolean;
  funds: FundRow[];
};

const statusLabels: Record<string, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
  CLOSED: "Encerrado",
};

const typeLabels: Record<string, string> = {
  FIDC: "FIDC",
  FII: "FII",
  FIM: "FIM",
  FIA: "FIA",
  RENDA_FIXA: "Renda Fixa",
  MULTIMERCADO: "Multimercado",
  OUTRO: "Outro",
};

const initialDeleteState: DeleteFundState = {
  ok: false,
  message: "",
};

function StatusBadge({ status }: { status: string }) {
  const isActive = status === "ACTIVE";

  return (
    <span
      className={
        isActive
          ? "rounded bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"
          : "rounded bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600"
      }
    >
      {statusLabels[status] ?? status}
    </span>
  );
}

function DeleteFundButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="inline-flex h-9 items-center justify-center gap-2 rounded border border-red-200 px-3 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Trash2 className="h-4 w-4" />
      )}
      {pending ? "Excluindo..." : "Excluir"}
    </button>
  );
}

function DeleteFundForm({ fund }: { fund: FundRow }) {
  const [state, formAction] = useFormState(deleteFundAction, initialDeleteState);

  return (
    <form
      action={formAction}
      className="flex flex-col items-start gap-1"
      onSubmit={(event) => {
        if (!window.confirm(`Excluir ${fund.name} das telas operacionais?`)) {
          event.preventDefault();
        }
      }}
    >
      <input name="id" type="hidden" value={fund.id} />
      <DeleteFundButton />
      {state.message ? (
        <span
          className={
            state.ok
              ? "text-xs font-medium text-emerald-700"
              : "text-xs font-medium text-red-700"
          }
        >
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

export function FundsTable({ canManage, funds }: FundsTableProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ACTIVE");
  const [typeFilter, setTypeFilter] = useState("ALL");

  const filteredFunds = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return funds.filter((fund) => {
      const matchesSearch =
        !normalizedSearch ||
        fund.name.toLowerCase().includes(normalizedSearch) ||
        fund.shortName.toLowerCase().includes(normalizedSearch);
      const matchesStatus =
        statusFilter === "ALL" || fund.status === statusFilter;
      const matchesType = typeFilter === "ALL" || fund.fundType === typeFilter;

      return matchesSearch && matchesStatus && matchesType;
    });
  }, [funds, search, statusFilter, typeFilter]);

  const fundTypes = useMemo(
    () => Array.from(new Set(funds.map((fund) => fund.fundType))).sort(),
    [funds]
  );

  const columns = useMemo<ColumnDef<FundRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Nome",
        cell: ({ row }) => (
          <Link
            className="font-medium text-slate-950 transition hover:text-primary"
            href={`/dashboard/fundos/${row.original.id}`}
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "shortName",
        header: "Nome Curto",
      },
      {
        accessorKey: "cnpj",
        header: "CNPJ",
      },
      {
        accessorKey: "fundType",
        header: "Tipo",
        cell: ({ row }) => typeLabels[row.original.fundType] ?? row.original.fundType,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "startDate",
        header: "Data de Início",
      },
      ...(canManage
        ? [
            {
              id: "actions",
              header: "Acoes",
              cell: ({ row }) => <DeleteFundForm fund={row.original} />,
            } satisfies ColumnDef<FundRow>,
          ]
        : []),
    ],
    [canManage]
  );

  const table = useReactTable({
    data: filteredFunds,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <section className="rounded border border-slate-200 bg-white shadow-executive">
      <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Fundos</h2>
          <p className="mt-1 text-sm text-slate-500">
            Cadastro e consulta dos fundos da OSHER.
          </p>
        </div>
        {canManage ? (
          <Link
            className="inline-flex h-10 items-center justify-center gap-2 rounded bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
            href="/dashboard/fundos/novo"
          >
            <Plus className="h-4 w-4" />
            Novo Fundo
          </Link>
        ) : null}
      </div>

      <div className="grid gap-3 border-b border-slate-200 px-5 py-4 md:grid-cols-[1fr_180px_180px]">
        <input
          className="h-10 rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nome"
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
          <option value="CLOSED">Encerrado</option>
        </select>
        <select
          className="h-10 rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          onChange={(event) => setTypeFilter(event.target.value)}
          value={typeFilter}
        >
          <option value="ALL">Todos os tipos</option>
          {fundTypes.map((type) => (
            <option key={type} value={type}>
              {typeLabels[type] ?? type}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-left text-sm">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr
                className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500"
                key={headerGroup.id}
              >
                {headerGroup.headers.map((header) => (
                  <th className="px-5 py-3 font-semibold" key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <tr className="border-b border-slate-100 last:border-0" key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td className="px-5 py-4 text-slate-600" key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  className="px-5 py-8 text-center text-sm text-slate-500"
                  colSpan={columns.length}
                >
                  Nenhum fundo encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
