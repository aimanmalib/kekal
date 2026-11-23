// GET /api/warranty/[pda]: the same read-only view /w/[pda] renders, for pages that follow a warranty live (/demo).
import { runtimeCluster } from "@/lib/config";
import { readWarranty } from "@/lib/warranty/read";
import { termsStore } from "@/lib/warranty/terms-store";

export const dynamic = "force-dynamic";

const STATUS = { bad_address: 400, not_found: 404, network: 502 } as const;
const noStore = { "cache-control": "no-store" };

export async function GET(_req: Request, { params }: { params: Promise<{ pda: string }> }): Promise<Response> {
  const { pda } = await params;
  const r = await readWarranty(pda, { store: termsStore(), cluster: runtimeCluster() });
  if (!r.ok) return Response.json({ error: r.reason }, { status: STATUS[r.reason], headers: noStore });
  return Response.json(r.view, { headers: noStore });
}
