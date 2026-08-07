import { issueSignedToken } from "@vercel/blob";
import {
  handleUploadPresigned,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { consignadoStockUploadConfig } from "@/server/operational/consignado-stock-service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  }
  if (!(await hasPermission("operational.stock.import"))) {
    return NextResponse.json({ error: "Sem permissão para importar estoque." }, { status: 403 });
  }

  try {
    const body = (await request.json()) as HandleUploadPresignedBody;
    const response = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async (pathname) => {
        if (
          !pathname.startsWith(consignadoStockUploadConfig.pathPrefix) ||
          !pathname.toLowerCase().endsWith(".xlsx")
        ) {
          throw new Error("Caminho ou extensão de arquivo inválidos.");
        }
        const allowedContentTypes = [
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/octet-stream",
        ];
        const maximumSizeInBytes = consignadoStockUploadConfig.maxFileSize;
        const token = await issueSignedToken({
          pathname,
          operations: ["put"],
          allowedContentTypes,
          maximumSizeInBytes,
        });

        return {
          token,
          urlOptions: {
            allowedContentTypes,
            maximumSizeInBytes,
            addRandomSuffix: true,
            allowOverwrite: false,
            tokenPayload: JSON.stringify({ userId: session.user.id }),
          },
        };
      },
    });
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao autorizar upload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
