import Link from "next/link";
import { fill, type Translate } from "@/lib/i18n";

/** Shown instead of the scenes while the program is not on the cluster: what the demo will do, and where to look now
 * (the finished examples, or how each path ends while no run is recorded). */
export function DemoClosed({ t, network, examplesReady }: { t: Translate; network: string; examplesReady: boolean }) {
  return (
    <section className="demo-closed" aria-labelledby="demo-closed-title">
      <h2 id="demo-closed-title">{fill(t("demo.closed.notDeployed.title"), { network })}</h2>
      <p>{t(examplesReady ? "demo.closed.notDeployed.body" : "demo.closed.notDeployed.bodyPending")}</p>
      <p>
        <Link href="/contoh" className={examplesReady ? "button" : "button button-link"}>
          {t(examplesReady ? "demo.examplesLink" : "home.examplesPending")}
        </Link>
      </p>
    </section>
  );
}
