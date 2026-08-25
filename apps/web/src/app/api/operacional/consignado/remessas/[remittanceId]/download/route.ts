import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getRemittanceDownload } from "@/server/operational/consignado-settlement-service";
import { RemittanceDownloadBlockedError } from "@/server/operational/consignado-settlement-safety";

export async function GET(_request: Request, { params }: { params: { remittanceId: string } }) {
  const session = await auth();
  if (!session?.user?.id || !(await hasPermission("operational.view"))) return new Response("Sem permissão.", { status: 403 });
  try {
    const file = await getRemittanceDownload(params.remittanceId);
    return new Response(file.stream, { headers: { "content-type": "text/plain; charset=iso-8859-1", "content-disposition": `attachment; filename="${file.fileName}"`, "cache-control": "private, no-store" } });
  } catch (error) { return new Response(error instanceof Error ? error.message : "Arquivo não encontrado.", { status: error instanceof RemittanceDownloadBlockedError ? 409 : 404 }); }
}
