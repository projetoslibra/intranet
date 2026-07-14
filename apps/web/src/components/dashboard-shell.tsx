"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  BarChart3,
  BriefcaseBusiness,
  Building2,
  FileBarChart,
  LayoutDashboard,
  LogOut,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

type DashboardShellProps = {
  children: React.ReactNode;
  user: {
    name: string;
    email: string;
    role: string;
  };
};

const navigation = [
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Fundos",
    href: "/dashboard/fundos",
    icon: Building2,
  },
  {
    title: "DRE",
    href: "/dashboard/dre",
    icon: BarChart3,
  },
  {
    title: "Previsões",
    href: "/dashboard/previsoes",
    icon: TrendingUp,
  },
  {
    title: "Caixa",
    href: "/dashboard/caixa",
    icon: Wallet,
  },
  {
    title: "Operacional",
    href: "/dashboard/operacional",
    icon: BriefcaseBusiness,
  },
  {
    title: "Relatórios",
    href: "/dashboard/relatorios",
    icon: FileBarChart,
  },
  {
    title: "Usuários",
    href: "/dashboard/usuarios",
    icon: Users,
  },
];

const todayFormatter = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
});

function getPageTitle(pathname: string) {
  return (
    navigation
      .slice()
      .reverse()
      .find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
      ?.title ?? "Dashboard"
  );
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function DashboardShell({ children, user }: DashboardShellProps) {
  const pathname = usePathname();
  const pageTitle = getPageTitle(pathname);
  const today = todayFormatter.format(new Date());

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-[240px] flex-col bg-[#0f172a] text-slate-100">
        <div className="border-b border-white/10 px-5 py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded bg-emerald-500 text-sm font-bold text-slate-950">
              OS
            </div>
            <div>
              <p className="text-lg font-semibold leading-5">OSHER</p>
              <p className="text-xs text-slate-400">Finance App</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-5">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                className={cn(
                  "flex h-10 items-center gap-3 rounded px-3 text-sm font-medium text-slate-300 transition hover:bg-white/10 hover:text-white",
                  isActive && "bg-white/15 text-white"
                )}
                href={item.href}
                key={item.href}
              >
                <Icon className="h-4 w-4" />
                {item.title}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-white/10 text-xs font-semibold text-white">
              {getInitials(user.name) || "OS"}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{user.name}</p>
              <p className="truncate text-xs text-slate-400">{user.role}</p>
            </div>
          </div>

          <button
            className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded border border-white/10 px-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10 hover:text-white"
            onClick={() => signOut({ callbackUrl: "/login" })}
            type="button"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </div>
      </aside>

      <div className="min-h-screen pl-[240px]">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-8">
          <div>
            <h1 className="text-xl font-semibold tracking-normal text-slate-950">
              {pageTitle}
            </h1>
          </div>
          <p className="text-sm font-medium capitalize text-slate-500">{today}</p>
        </header>

        <main className="px-8 py-7">{children}</main>
      </div>
    </div>
  );
}
