import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { generatePddDailySummary } from "@/server/pdd/daily-summary";

const bodySchema = z.object({
  dataReferencia: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "dataReferencia deve usar YYYY-MM-DD."),
  nomeFundo: z.string().min(2, "nomeFundo e obrigatorio."),
});

function extractBearerToken(value: string | null) {
  if (!value) return null;

  return value.startsWith("Bearer ") ? value.slice("Bearer ".length) : value;
}

function isAuthorized(request: NextRequest) {
  const expected = process.env.PDD_RESUMO_API_KEY;

  if (!expected) {
    return {
      ok: false,
      status: 500,
      message: "PDD_RESUMO_API_KEY nao configurada no ambiente.",
    };
  }

  const received =
    request.headers.get("x-osher-api-key") ??
    extractBearerToken(request.headers.get("authorization"));

  if (received !== expected) {
    return {
      ok: false,
      status: 401,
      message: "Token invalido para gerar resumo diario de PDD.",
    };
  }

  return { ok: true };
}

export async function POST(request: NextRequest) {
  const authorization = isAuthorized(request);

  if (!authorization.ok) {
    return NextResponse.json(
      { ok: false, message: authorization.message },
      { status: authorization.status }
    );
  }

  try {
    const input = bodySchema.parse(await request.json());
    const result = await generatePddDailySummary(input);

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Erro ao gerar resumo diario de PDD.";

    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
