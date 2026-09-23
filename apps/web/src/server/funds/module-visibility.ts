import { z } from "zod";
import { FUND_MODULES, type FundModuleKey } from "@/lib/fund-modules";

const moduleKeys = FUND_MODULES.map(({ key }) => key) as [
  FundModuleKey,
  ...FundModuleKey[],
];

const visibilityInputSchema = z.object({
  fundId: z.string().min(1),
  module: z.enum(moduleKeys),
  enabled: z.boolean(),
});

export type FundModuleVisibilityResult =
  | { ok: true; message: string; enabled: boolean }
  | { ok: false; message: string };

type PersistVisibilityInput = {
  fundId: string;
  module: FundModuleKey;
  enabled: boolean;
  updatedByUserId: string | null;
};

type VisibilityDependencies = {
  actorUserId: string | null;
  canManage: boolean;
  findFund: (fundId: string) => Promise<{ id: string } | null>;
  upsertVisibility: (
    input: PersistVisibilityInput
  ) => Promise<{ enabled: boolean }>;
  revalidate: (path: string) => void;
};

const revalidationPaths = [
  "/dashboard",
  "/dashboard/fundos",
  "/dashboard/caixa",
  "/dashboard/dre",
  "/dashboard/previsoes",
  "/dashboard/pdd",
] as const;

export function createDisabledFundModules(fundId: string) {
  return FUND_MODULES.map(({ key }) => ({
    fundId,
    module: key,
    enabled: false,
  }));
}

export function resolveFundModuleToggle(
  previous: boolean,
  result: FundModuleVisibilityResult
) {
  return result.ok ? result.enabled : previous;
}

export async function setFundModuleVisibilityWithDependencies(
  input: unknown,
  dependencies: VisibilityDependencies
): Promise<FundModuleVisibilityResult> {
  if (!dependencies.canManage) {
    return {
      ok: false,
      message: "Voce nao tem permissao para configurar modulos.",
    };
  }

  const parsed = visibilityInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Configuracao de modulo invalida." };
  }

  try {
    const fund = await dependencies.findFund(parsed.data.fundId);
    if (!fund) {
      return { ok: false, message: "Fundo nao encontrado." };
    }

    const visibility = await dependencies.upsertVisibility({
      ...parsed.data,
      updatedByUserId: dependencies.actorUserId,
    });

    for (const path of revalidationPaths) dependencies.revalidate(path);

    return {
      ok: true,
      message: "Modulo atualizado.",
      enabled: visibility.enabled,
    };
  } catch {
    return { ok: false, message: "Nao foi possivel atualizar o modulo." };
  }
}
