import Link from "next/link";
import { fill, type MessageKey, type Translate } from "@/lib/i18n";
import type { Examples } from "@/lib/demo/examples";
import { ExamplePaths, PATHS } from "./ExamplePaths";

interface Props {
  t: Translate;
  /** Null while no run is recorded for this cluster: the paths are described, with no claim that they already ran. */
  examples: Examples | null;
  /** The live demo is offered only when the program is on the cluster. */
  deployed: boolean;
  network: string;
  /** Path order from config, used for the descriptions when nothing is recorded. */
  order: readonly string[];
}

/** /contoh: the finished paths with their records, or, before a run is recorded, how each path ends. */
export function ExamplesView({ t, examples, deployed, network, order }: Props) {
  const demoLink = deployed ? (
    <p className="note">
      <Link href="/demo">{t("examples.demoLink")}</Link>
    </p>
  ) : null;
  if (examples) {
    return (
      <>
        <section className="demo-head">
          <h1>{t("examples.title")}</h1>
          <p className="lede">{t("examples.lede")}</p>
          {demoLink}
        </section>
        <ExamplePaths examples={examples} t={t} />
      </>
    );
  }
  return (
    <>
      <section className="demo-head">
        <h1>{t("examples.titlePending")}</h1>
        <p className="lede">{fill(t("examples.ledePending"), { network })}</p>
        {deployed ? <p className="note">{t("examples.empty")}</p> : null}
        {demoLink}
      </section>
      <div className="examples">
        {order.filter((id) => PATHS.has(id)).map((id) => (
          <section key={id} className="example" aria-labelledby={`path-${id}`}>
            <h2 id={`path-${id}`}>{t(`examples.path.${id}.title` as MessageKey)}</h2>
            <p>{t(`examples.path.${id}.body` as MessageKey)}</p>
          </section>
        ))}
      </div>
    </>
  );
}
