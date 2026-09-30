import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { setForecastItemsExecuted } from "@/server/forecasts/forecast-history";

const bodySchema = z.object({
  action: z.enum(["EXECUTE", "UNDO"]),
  itemIds: z.array(z.string().min(1)).min(1),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { forecastId: string } }
) {
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
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Seleção de títulos inválida." },
      { status: 400 }
    );
  }

  const result = await setForecastItemsExecuted({
    ...parsed.data,
    forecastId: params.forecastId,
    userId: session.user.id,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
