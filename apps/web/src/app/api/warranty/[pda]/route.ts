// GET /api/warranty/[pda]: the same read-only view /w/[pda] renders, for pages that follow a warranty live (/demo).
// Reads are shared and briefly reused (lib/warranty/read-cache); when the RPC keeps answering 429 the answer is
// 503 with Retry-After, so the page knows to wait rather than treat the network as down.
import { runtimeCluster } from "@/lib/config";
import { readWarranty } from "@/lib/warranty/read";
import { readResponse } from "@/lib/warranty/read-response";
import { termsStore } from "@/lib/warranty/terms-store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ pda: string }> }): Promise<Response> {
  const { pda } = await params;
  return readResponse(await readWarranty(pda, { store: termsStore(), cluster: runtimeCluster() }));
}
