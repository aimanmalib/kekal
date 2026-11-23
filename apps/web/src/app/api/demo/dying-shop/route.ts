import { demoRoute } from "@/lib/demo/route";
import { startDyingShop } from "@/lib/demo/service";

export const dynamic = "force-dynamic";

export const POST = (req: Request): Promise<Response> => demoRoute(req, startDyingShop);
