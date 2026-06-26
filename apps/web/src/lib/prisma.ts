import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

/**
 * Garante que a conexão use o schema dedicado do OSHER.
 *
 * O banco é uma instância compartilhada (multi-tenant por schema); o OSHER vive
 * no schema `OSHER`, não no `public` (que é o CRM). Se a DATABASE_URL não trouxer
 * `?schema=...` (ex.: env var na Vercel salva sem `&schema=OSHER`), o Prisma cai
 * no `public` e toda query estoura com P2021. Aqui forçamos o schema como fallback.
 */
function resolveDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url || /[?&]schema=/.test(url)) {
    return url;
  }

  return `${url}${url.includes("?") ? "&" : "?"}schema=OSHER`;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: resolveDatabaseUrl() } },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
