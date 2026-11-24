import Link from "next/link";
import { fill, type Translate } from "@/lib/i18n";

/** Shown instead of the scenes while the program is not on the cluster: what the demo will do, and where to look now. */
export function DemoClosed({ t, network }: { t: Translate; network: string }) {
  return (
    <section className="demo-closed" aria-labelledby="demo-closed-title">
      <h2 id="demo-closed-title">{fill(t("demo.closed.notDeployed.title"), { network })}</h2>
      <p>{t("demo.closed.notDeployed.body")}</p>
      <p>
        <Link href="/contoh" className="button">
          {t("demo.examplesLink")}
        </Link>
      </p>
    </section>
  );
}
