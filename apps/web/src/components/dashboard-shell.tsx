"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  ArrowLeft,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  ClipboardCheck,
  ChevronRight,
  FileBarChart,
  LayoutDashboard,
  LogOut,
  ShieldAlert,
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
    title: "PDD",
    href: "/dashboard/pdd",
    permissionKey: "pdd.view",
    icon: ShieldAlert,
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
  {
    title: "Fundos",
    href: "/dashboard/fundos",
    permissionKey: "funds.view",
    icon: Building2,
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

const breadcrumbLabels: Record<string, string> = {
  caixa: "Caixa",
  "conciliacao-bancaria": "Conciliação bancária",
  conciliacao: "Conciliação de Fundos",
  consignado: "Consignado",
  "credito-cadastro": "Crédito & Cadastro",
  dashboard: "Dashboard",
  dre: "DRE",
  estoques: "Estoques",
  financeiro: "Financeiro",
  fundos: "Fundos",
  baixas: "Baixas e remessas",
  mesa: "Mesa de Operações",
  novo: "Novo fundo",
  operacional: "Operacional",
  pdd: "PDD",
  previsoes: "Previsões",
  relatorios: "Relatórios",
  usuarios: "Usuários",
};

type BreadcrumbItem = {
  href: string;
  label: string;
};

function humanizeSegment(segment: string) {
  const decoded = decodeURIComponent(segment).replace(/[-_]+/g, " ");
  return decoded.charAt(0).toUpperCase() + decoded.slice(1);
}

function getBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const segments = pathname.split("/").filter(Boolean);
  const dashboardIndex = segments.indexOf("dashboard");
  const routeSegments = dashboardIndex >= 0 ? segments.slice(dashboardIndex + 1) : [];

  if (!routeSegments.length) {
    return [{ href: "/dashboard", label: "Dashboard" }];
  }

  return routeSegments.map((segment, index) => {
    const parent = routeSegments[index - 1];
    const isFundIdentifier = parent === "fundos" && segment !== "novo";
    const label = isFundIdentifier
      ? "Detalhes do fundo"
      : breadcrumbLabels[segment] ?? humanizeSegment(segment);

    return {
      href: `/dashboard/${routeSegments.slice(0, index + 1).join("/")}`,
      label,
    };
  });
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
  const breadcrumbs = getBreadcrumbs(pathname);
  const previousPage = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2] : null;
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
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-6 border-b border-slate-200 bg-white px-8">
          <div className="flex min-w-0 items-center gap-3">
            {previousPage ? (
              <Link
                aria-label={`Voltar para ${previousPage.label}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
                href={previousPage.href}
                title={`Voltar para ${previousPage.label}`}
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
            ) : null}
            <nav aria-label="Navegação estrutural" className="min-w-0 overflow-hidden">
              <ol className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-sm">
                {breadcrumbs.map((item, index) => {
                  const isCurrent = index === breadcrumbs.length - 1;
                  return (
                    <li className="flex min-w-0 items-center gap-1.5" key={item.href}>
                      {index > 0 ? (
                        <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                      ) : null}
                      {isCurrent ? (
                        <span
                          aria-current="page"
                          className="truncate text-base font-semibold text-slate-950"
                          title={item.label}
                        >
                          {item.label}
                        </span>
                      ) : (
                        <Link
                          className="truncate font-medium text-slate-500 transition hover:text-primary"
                          href={item.href}
                          title={`Ir para ${item.label}`}
                        >
                          {item.label}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ol>
            </nav>
          </div>
          <p className="text-sm font-medium capitalize text-slate-500">{today}</p>
        </header>

        <main className="px-8 py-7">{children}</main>
      </div>
    </div>
  );
}
