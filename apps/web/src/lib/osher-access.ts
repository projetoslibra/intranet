export type OsherAccessLevel = "NONE" | "VIEWER" | "OPERATOR" | "ADMIN";

export type OsherAccessLevelOption = {
  value: OsherAccessLevel;
  label: string;
  permissionKeys: readonly string[];
};

export type OsherAccessItem = {
  id: string;
  title: string;
  levels: readonly OsherAccessLevelOption[];
};

const noAccess: OsherAccessLevelOption = {
  value: "NONE",
  label: "Sem acesso",
  permissionKeys: [],
};

export const osherAccessItems: readonly OsherAccessItem[] = [
  {
    id: "dashboard",
    title: "Dashboard",
    levels: [
      noAccess,
      {
        value: "VIEWER",
        label: "Visualizador",
        permissionKeys: ["dashboard.view"],
      },
    ],
  },
  {
    id: "credit-registration",
    title: "Crédito&Cadastro",
    levels: [
      noAccess,
      {
        value: "VIEWER",
        label: "Visualizador",
        permissionKeys: ["credit-registration.view"],
      },
    ],
  },
  {
    id: "funds",
    title: "Fundos",
    levels: [
      noAccess,
      {
        value: "VIEWER",
        label: "Visualizador",
        permissionKeys: ["funds.view"],
      },
      {
        value: "OPERATOR",
        label: "Operador",
        permissionKeys: ["funds.view", "funds.manage"],
      },
    ],
  },
  {
    id: "dre",
    title: "DRE",
    levels: [
      noAccess,
      {
        value: "VIEWER",
        label: "Visualizador",
        permissionKeys: ["dre.view"],
      },
      {
        value: "OPERATOR",
        label: "Operador",
        permissionKeys: ["dre.view", "dre.import"],
      },
    ],
  },
  {
    id: "forecasts",
    title: "Previsões",
    levels: [
      noAccess,
      {
        value: "VIEWER",
        label: "Visualizador",
        permissionKeys: ["forecasts.view"],
      },
    ],
  },
  {
    id: "pdd",
    title: "PDD",
    levels: [
      noAccess,
      {
        value: "VIEWER",
        label: "Visualizador",
        permissionKeys: ["pdd.view"],
      },
    ],
  },
  {
    id: "cash",
    title: "Caixa",
    levels: [
      noAccess,
      {
        value: "VIEWER",
        label: "Visualizador",
        permissionKeys: ["cash.view"],
      },
      {
        value: "OPERATOR",
        label: "Operador",
        permissionKeys: ["cash.view", "cash.manage"],
      },
    ],
  },
  {
    id: "operational",
    title: "Operacional",
    levels: [
      noAccess,
      {
        value: "VIEWER",
        label: "Visualizador",
        permissionKeys: ["operational.view"],
      },
      {
        value: "OPERATOR",
        label: "Operador",
        permissionKeys: [
          "operational.view",
          "operational.finance.manage",
          "operational.stock.import",
          "operational.risk.import",
          "operational.dimension.import",
          "cash.manage",
        ],
      },
    ],
  },
  {
    id: "reports",
    title: "Relatórios",
    levels: [
      noAccess,
      {
        value: "VIEWER",
        label: "Visualizador",
        permissionKeys: ["reports.view"],
      },
      {
        value: "OPERATOR",
        label: "Operador",
        permissionKeys: ["reports.view", "reports.export"],
      },
    ],
  },
  {
    id: "users",
    title: "Usuários",
    levels: [
      noAccess,
      {
        value: "ADMIN",
        label: "Administrador",
        permissionKeys: ["users.manage"],
      },
    ],
  },
];

export const osherAccessPermissionKeys = Array.from(
  new Set(
    osherAccessItems.flatMap((item) =>
      item.levels.flatMap((level) => level.permissionKeys)
    )
  )
);

export function osherAccessFieldName(itemId: string) {
  return `accessLevel.${itemId}`;
}

export function getOsherAccessLevel(
  item: OsherAccessItem,
  permissionKeys: ReadonlySet<string>
): OsherAccessLevel {
  const matchingLevels = [...item.levels]
    .reverse()
    .find(
      (level) =>
        level.permissionKeys.length > 0 &&
        level.permissionKeys.every((permissionKey) => permissionKeys.has(permissionKey))
    );

  return matchingLevels?.value ?? "NONE";
}
