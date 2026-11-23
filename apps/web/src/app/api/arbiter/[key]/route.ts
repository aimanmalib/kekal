// GET /api/arbiter/[key]: disputed claims of every shop that names this key as its arbiter (public chain data only).
import { readArbiterBoard } from "@/lib/shop/read";
import { parseAddress } from "@/lib/warranty/read";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }): Promise<Response> {
  const key = parseAddress((await params).key);
  if (!key) return Response.json({ error: "bad_address" }, { status: 400, headers: noStore });
  try {
    return Response.json(await readArbiterBoard(key), { headers: noStore });
  } catch {
    return Response.json({ error: "network" }, { status: 502, headers: noStore });
  }
}
