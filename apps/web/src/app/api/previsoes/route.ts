import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createForecast } from "@/server/forecasts/forecast-history";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false, message: "Sessão expirada. Faça login novamente." },
      { status: 401 }
    );
  }
  if (!(await hasPermission("forecasts.view"))) {
    return NextResponse.json(
      { ok: false, message: "Você não possui acesso às previsões." },
      { status: 403 }
    );
  }

  const result = await createForecast(await request.json(), session.user.id);
  return NextResponse.json(result, { status: result.ok ? 201 : 400 });
}
