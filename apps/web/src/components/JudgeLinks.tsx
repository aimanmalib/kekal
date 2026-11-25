import { fill, type Translate } from "@/lib/i18n";

interface Props {
  t: Translate;
  /** Each link is left out while its value is null, so the row never points at something that does not exist yet. */
  videoUrl: string | null;
  repoUrl: string | null;
  /** Program address and its explorer page; null while the program is not on the cluster. */
  program: { id: string; explorer: string } | null;
  network: string;
}

/** The short row at the top of the home page: the video, the source code and the program, for someone reviewing the project. */
export function JudgeLinks({ t, videoUrl, repoUrl, program, network }: Props) {
  if (!videoUrl && !repoUrl && !program) return null;
  return (
    <nav className="judge-links" aria-label={t("home.judge.label")}>
      <ul>
        {videoUrl ? (
          <li>
            <a href={videoUrl}>{t("home.link.video")}</a>
          </li>
        ) : null}
        {repoUrl ? (
          <li>
            <a href={repoUrl}>{t("home.link.repo")}</a>
          </li>
        ) : null}
        {program ? (
          <li>
            <a href={program.explorer} title={program.id} target="_blank" rel="noopener noreferrer">
              <span>
                {fill(t("home.judge.program"), { network })} <span className="mono">{shortAddress(program.id)}</span>
              </span>
            </a>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}

function shortAddress(id: string): string {
  return id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}
