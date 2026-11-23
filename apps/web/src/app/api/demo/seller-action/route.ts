import { demoRoute } from "@/lib/demo/route";
import { sellerAction } from "@/lib/demo/service";

export const dynamic = "force-dynamic";

export const POST = (req: Request): Promise<Response> => demoRoute(req, sellerAction);
