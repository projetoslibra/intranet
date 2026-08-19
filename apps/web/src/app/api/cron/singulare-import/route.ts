import { NextResponse, type NextRequest } from "next/server";
import { importSingulareCaixa } from "@/server/singulare/cash-import-service";
import { importSingulareCarteiras } from "@/server/singulare/import-service";
import {
  getMostRecentBusinessDate,
  normalizeDateOnly,
  parseDateOnly,
  toDateKey,
} from "@/server/singulare/date-utils";

export const runtime = "nodejs";
export const maxDuration = 60;

function extractBearerToken(value: string | null) {
  if (!value) return null;

  return value.startsWith("Bearer ") ? value.slice("Bearer ".length) : value;
}

function isAuthorized(request: NextRequest) {
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return {
      ok: false,
      status: 500,
      message: "CRON_SECRET nao configurada no ambiente.",
    };
  }

  const received =
    request.headers.get("x-osher-api-key") ??
    extractBearerToken(request.headers.get("authorization"));

  if (received !== expected) {
    return {
      ok: false,
      status: 401,
      message: "Token invalido para executar importacao automatica da Singulare.",
    };
  }

  return { ok: true };
}

function isWeekend(date: Date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function resolveDays(value: string | null) {
  if (!value) return 3;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return 3;

  return Math.min(parsed, 7);
}

function resolveEndDate(value: string | null) {
  if (!value) return getMostRecentBusinessDate();

  const parsed = parseDateOnly(value);
  return parsed ?? getMostRecentBusinessDate();
}

function getRecentBusinessDates(count: number, endDate: Date) {
  const dates: Date[] = [];
  const cursor = normalizeDateOnly(endDate);

  while (dates.length < count) {
    if (!isWeekend(cursor)) {
      dates.push(new Date(cursor));
    }

    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return dates.reverse();
}

export async function GET(request: NextRequest) {
  const authorization = isAuthorized(request);

  if (!authorization.ok) {
    return NextResponse.json(
      { ok: false, message: authorization.message },
      { status: authorization.status }
    );
  }

  const days = resolveDays(request.nextUrl.searchParams.get("days"));
  const endDate = resolveEndDate(request.nextUrl.searchParams.get("endDate"));
  const dates = getRecentBusinessDates(days, endDate);
  const results = [];

  for (const date of dates) {
    const dataAnalise = toDateKey(date);

    try {
      const carteiraResult = await importSingulareCarteiras(dataAnalise);
      const caixaResult = await importSingulareCaixa(dataAnalise);

      results.push({
        dataAnalise,
        ok: true,
        carteiraResult,
        caixaResult,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Erro desconhecido na importacao automatica da Singulare.";

      console.error(`[Singulare Cron] ${dataAnalise} falhou: ${message}`);

      results.push({
        dataAnalise,
        ok: false,
        message,
      });
    }
  }

  const failedDates = results.filter((result) => !result.ok);

  return NextResponse.json(
    {
      ok: failedDates.length === 0,
      days,
      dates: dates.map(toDateKey),
      results,
    },
    { status: failedDates.length === 0 ? 200 : 207 }
  );
}
