import Link from "next/link";
import { fill, type MessageKey, type Translate } from "@/lib/i18n";
import type { Examples } from "@/lib/demo/examples";
import { PATHS } from "@/components/demo/ExamplePaths";

interface Props {
  t: Translate;
  /** Null while no run is recorded for this cluster: each path is described, with no record link. */
  examples: Examples | null;
  /** Path order from config, used when nothing is recorded. */
  order: readonly string[];
  network: string;
  /** Null until the video exists (config web.home.videoUrl). */
  videoUrl: string | null;
}

/** The five ways a warranty ends; once recorded, each links the public record of the step that settled it. */
export function SeeItHappen({ t, examples, order, network, videoUrl }: Props) {
  const recorded = new Map(examples?.paths.map((p) => [p.id, p.steps[p.steps.length - 1]!.explorer]) ?? []);
  const ids = order.filter((id) => PATHS.has(id));
  return (
    <section className="home-section see" aria-labelledby="see-title">
      <h2 id="see-title">{t("home.see.title")}</h2>
      <p className="section-lede">{fill(t(examples ? "home.see.lede" : "home.see.ledePending"), { network })}</p>
      {videoUrl ? (
        <p>
          <a className="see-link" href={videoUrl}>{t("home.see.video")}</a>
        </p>
      ) : null}
      <dl className="paths">
        {ids.map((id) => {
          const record = recorded.get(id);
          return (
            <div key={id}>
              <dt>{t(`examples.path.${id}.title` as MessageKey)}</dt>
              <dd>
                {t(`examples.path.${id}.body` as MessageKey)}
                {record ? (
                  <a className="see-link" href={record} target="_blank" rel="noopener noreferrer">
                    {t("home.see.record")}
                  </a>
                ) : null}
              </dd>
            </div>
          );
        })}
      </dl>
      {examples ? (
        <p>
          <Link className="see-link" href="/contoh">{t("home.see.all")}</Link>
        </p>
      ) : null}
    </section>
  );
}
