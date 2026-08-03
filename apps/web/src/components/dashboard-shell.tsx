"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  BarChart3,
  BriefcaseBusiness,
  Building2,
  ClipboardCheck,
  FileBarChart,
  LayoutDashboard,
  LogOut,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { OsherLogo } from "@/components/brand/osher-logo";
import { cn } from "@/lib/utils";

type DashboardShellProps = {
  children: React.ReactNode;
  permissions: string[];
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
    permissionKey: "dashboard.view",
    icon: LayoutDashboard,
  },
  {
    title: "Fundos",
    href: "/dashboard/fundos",
    permissionKey: "funds.view",
    icon: Building2,
  },
  {
    title: "DRE",
    href: "/dashboard/dre",
    permissionKey: "dre.view",
    icon: BarChart3,
  },
  {
    title: "Previsoes",
    href: "/dashboard/previsoes",
    permissionKey: "forecasts.view",
    icon: TrendingUp,
  },
  {
    title: "Caixa",
    href: "/dashboard/caixa",
    permissionKey: "cash.view",
    icon: Wallet,
  },
  {
    title: "Operacional",
    href: "/dashboard/operacional",
    permissionKey: "operational.view",
    icon: BriefcaseBusiness,
  },
  {
    title: "Crédito&Cadastro",
    href: "/dashboard/credito-cadastro",
    permissionKey: "credit-registration.view",
    icon: ClipboardCheck,
  },
  {
    title: "Relatorios",
    href: "/dashboard/relatorios",
    permissionKey: "reports.view",
    icon: FileBarChart,
  },
  {
    title: "Usuarios",
    href: "/dashboard/usuarios",
    permissionKey: "users.manage",
    icon: Users,
  },
];

const todayFormatter = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
});

// Item de navegacao correspondente a rota: o match MAIS ESPECIFICO. Sem isso
// "/dashboard" casa com "/dashboard/dre" via startsWith e dois itens ficam
// marcados como ativos ao mesmo tempo.
function getActiveHref(pathname: string) {
  return (
    navigation
      .filter(
        (item) =>
          pathname === item.href || pathname.startsWith(`${item.href}/`)
      )
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null
  );
}

function getPageTitle(pathname: string) {
  const activeHref = getActiveHref(pathname);

  return (
    navigation.find((item) => item.href === activeHref)?.title ?? "Dashboard"
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

export function DashboardShell({ children, permissions, user }: DashboardShellProps) {
  const pathname = usePathname();
  const activeHref = getActiveHref(pathname);
  const pageTitle = getPageTitle(pathname);
  const today = todayFormatter.format(new Date());
  const permissionSet = new Set(permissions);
  const visibleNavigation = navigation.filter((item) =>
    permissionSet.has(item.permissionKey)
  );

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-950">
      <aside className="osher-sidebar fixed inset-y-0 left-0 z-20 flex w-[240px] flex-col">
        <div className="osher-sidebar-divider border-b px-5 py-6">
          <div className="flex items-center gap-3">
            <OsherLogo
              className="osher-mark-glow h-10 w-10 shrink-0"
              color="var(--osher-emerald-bright)"
              variant="mark"
            />
            <p className="osher-brand-name leading-5">OSHER</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-5">
          {visibleNavigation.map((item) => {
            const Icon = item.icon;
            const isActive = item.href === activeHref;

            return (
              <Link
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "osher-nav-item",
                  isActive && "osher-nav-item--active"
                )}
                href={item.href}
                key={item.href}
              >
                <Icon className="osher-nav-icon h-4 w-4 shrink-0" />
                {item.title}
              </Link>
            );
          })}
        </nav>

        <div className="osher-sidebar-divider border-t p-4">
          <div className="flex items-center gap-3">
            <div className="osher-avatar">
              {getInitials(user.name) || "OS"}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink-100">
                {user.name}
              </p>
              <p className="truncate text-xs text-ink-400">{user.role}</p>
            </div>
          </div>

          <button
            className="osher-sidebar-btn mt-4"
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
