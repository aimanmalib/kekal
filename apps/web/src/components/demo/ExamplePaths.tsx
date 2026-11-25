import type { MessageKey, Translate } from "@/lib/i18n";
import type { Examples } from "@/lib/demo/examples";

/** Step names the lifecycle report writes (scripts/lib/paths.ts and setup.ts). Others show as "another step". */
const STEPS = new Set([
  "issue_warranty", "file_claim", "respond_claim", "confirm_resolved", "settle_unanswered", "declare_dormant", "claim_orphan",
  "release_expired", "escalate", "resolve_dispute", "heartbeat",
]);
/** Paths that have locale text; others in config or a report are left out. */
export const PATHS = new Set(["A", "B", "C", "D", "E"]);

const stepKey = (step: string): MessageKey => (STEPS.has(step) ? `examples.step.${step}` : "examples.step.other") as MessageKey;

/** Finished examples: each path with its outcome in one sentence and every transaction it took. */
export function ExamplePaths({ examples, t }: { examples: Examples; t: Translate }) {
  return (
    <div className="examples">
      {examples.paths
        .filter((p) => PATHS.has(p.id))
        .map((p) => (
          <section key={p.id} className="example" aria-labelledby={`path-${p.id}`}>
            <h2 id={`path-${p.id}`}>{t(`examples.path.${p.id}.title` as MessageKey)}</h2>
            <p>{t(`examples.path.${p.id}.body` as MessageKey)}</p>
            <ol className="steps">
              {p.steps.map((s) => (
                <li key={s.signature}>
                  <span>{t(stepKey(s.step))}</span>{" "}
                  <a href={s.explorer} target="_blank" rel="noopener noreferrer">
                    {t("timeline.record")}
                  </a>
                </li>
              ))}
            </ol>
          </section>
        ))}
    </div>
  );
}
