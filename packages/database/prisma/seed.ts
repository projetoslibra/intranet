import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const permissions = [
  "dashboard.view",
  "funds.view",
  "funds.manage",
  "quotes.view",
  "quotes.import",
  "dre.view",
  "dre.import",
  "forecasts.view",
  "cash.view",
  "cash.manage",
  "operational.view",
  "operational.finance.manage",
  "operational.stock.import",
  "operational.risk.import",
  "operational.dimension.import",
  "users.manage",
  "reports.view",
  "reports.export",
];

const dreAccounts = [
  ["taxa_gestao", "Taxa de Gestão"],
  ["taxa_administracao", "Taxa de Administração"],
  ["taxa_custodia", "Taxa de Custódia"],
  ["auditoria", "Auditoria"],
  ["servicos_cobranca", "Serviços de Cobrança"],
  ["iof", "IOF"],
  ["cetip", "CETIP"],
  ["selic", "SELIC"],
  ["consultoria", "Consultoria"],
  ["rating", "Rating"],
  ["outras_despesas", "Outras Despesas"],
  ["pdd", "PDD - Provisão para Devedores Duvidosos"],
  ["receita_credito", "Receita de Crédito"],
  ["receita_fundo", "Receita de Fundos Investidos"],
] as const;

async function main() {
  const passwordHash = await bcrypt.hash("Admin@2024", 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@osher.com.br" },
    update: {
      name: "Admin OSHER",
      passwordHash,
      status: "ACTIVE",
    },
    create: {
      name: "Admin OSHER",
      email: "admin@osher.com.br",
      passwordHash,
      status: "ACTIVE",
    },
  });

  const adminRole = await prisma.role.upsert({
    where: { name: "ADMIN" },
    update: {
      description: "Acesso administrativo completo ao sistema OSHER.",
    },
    create: {
      name: "ADMIN",
      description: "Acesso administrativo completo ao sistema OSHER.",
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: admin.id,
        roleId: adminRole.id,
      },
    },
    update: {},
    create: {
      userId: admin.id,
      roleId: adminRole.id,
    },
  });

  for (const key of permissions) {
    const permission = await prisma.permission.upsert({
      where: { key },
      update: {
        description: `Permissão ${key}`,
      },
      create: {
        key,
        description: `Permissão ${key}`,
      },
    });

    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: adminRole.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: adminRole.id,
        permissionId: permission.id,
      },
    });
  }

  // Fundos do módulo Caixa. CNPJ/tipo/data são PLACEHOLDERS (não informados) —
  // substituir pelos dados reais quando disponíveis.
  const cashFundNames = ["Antena", "Apuama", "Bristol", "Consignado"];

  for (const name of cashFundNames) {
    const existing = await prisma.fund.findFirst({ where: { name } });

    if (existing) {
      console.log(`Fundo Caixa já existia: ${name}`);
      continue;
    }

    await prisma.fund.create({
      data: {
        name,
        shortName: name,
        cnpj: `PENDENTE-${name.toUpperCase()}`,
        fundType: "OUTRO",
        status: "ACTIVE",
        startDate: new Date("2024-01-01T00:00:00.000Z"),
      },
    });

    console.log(`Fundo Caixa criado (CNPJ placeholder): ${name}`);
  }

  for (const [code, name] of dreAccounts) {
    await prisma.dreAccount.upsert({
      where: { code },
      update: {
        name,
        type: code.startsWith("receita_") ? "REVENUE" : "EXPENSE",
      },
      create: {
        code,
        name,
        type: code.startsWith("receita_") ? "REVENUE" : "EXPENSE",
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
