export const osherAccessItems = [
  {
    id: "dashboard",
    title: "Dashboard",
    permissionKey: "dashboard.view",
  },
  {
    id: "funds",
    title: "Fundos",
    permissionKey: "funds.view",
  },
  {
    id: "dre",
    title: "DRE",
    permissionKey: "dre.view",
  },
  {
    id: "forecasts",
    title: "Previsoes",
    permissionKey: "forecasts.view",
  },
  {
    id: "cash",
    title: "Caixa",
    permissionKey: "cash.view",
  },
  {
    id: "operational",
    title: "Operacional",
    permissionKey: "operational.view",
  },
  {
    id: "reports",
    title: "Relatorios",
    permissionKey: "reports.view",
  },
  {
    id: "users",
    title: "Usuarios",
    permissionKey: "users.manage",
  },
] as const;

export const osherAccessPermissionKeys = osherAccessItems.map(
  (item) => item.permissionKey
);
