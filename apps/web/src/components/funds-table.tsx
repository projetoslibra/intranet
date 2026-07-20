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
import { Plus } from "lucide-react";

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

export function FundsTable({ canManage, funds }: FundsTableProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
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
    ],
    []
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
