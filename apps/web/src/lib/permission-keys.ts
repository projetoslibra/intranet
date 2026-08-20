const permissionAliases: Readonly<Record<string, readonly string[]>> = {
  "operational.manage": ["operational.finance.manage"],
};

export function permissionSetHas(permissions: ReadonlySet<string>, key: string) {
  if (permissions.has(key)) return true;
  return (permissionAliases[key] ?? []).some((alias) => permissions.has(alias));
}
