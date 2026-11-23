// GET /api/shop/[owner]: the merchant board of the shop this wallet owns (public chain data only).
import { readShopBoard } from "@/lib/shop/read";
import { parseAddress } from "@/lib/warranty/read";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

export async function GET(_req: Request, { params }: { params: Promise<{ owner: string }> }): Promise<Response> {
  const owner = parseAddress((await params).owner);
  if (!owner) return Response.json({ error: "bad_address" }, { status: 400, headers: noStore });
  try {
    return Response.json(await readShopBoard(owner), { headers: noStore });
  } catch {
    return Response.json({ error: "network" }, { status: 502, headers: noStore });
  }
}
