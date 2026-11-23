import { demoRoute } from "@/lib/demo/route";
import { arbiterAction } from "@/lib/demo/service";

export const dynamic = "force-dynamic";

export const POST = (req: Request): Promise<Response> => demoRoute(req, arbiterAction);
