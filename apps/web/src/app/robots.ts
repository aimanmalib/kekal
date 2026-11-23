import type { MetadataRoute } from "next";
import { robotsFile } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return robotsFile();
}
