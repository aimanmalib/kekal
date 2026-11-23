// /contoh: the finished paths A to E, read from the lifecycle report in config/examples.json. Pure.
export interface ExampleStep {
  step: string;
  signature: string;
  explorer: string;
}

export interface ExamplePath {
  id: string;
  steps: ExampleStep[];
}

export interface Examples {
  cluster: string;
  programId: string;
  paths: ExamplePath[];
}

const isStep = (x: unknown): x is ExampleStep => {
  const s = x as Record<string, unknown> | null;
  return (
    typeof s?.step === "string" &&
    typeof s.signature === "string" &&
    typeof s.explorer === "string" &&
    /^https:\/\//.test(s.explorer)
  );
};

/**
 * The report's paths in `order`, or null when the report is empty, malformed or from another cluster than the one
 * this site runs on (a local run's links point at a validator nobody else can reach). Unknown paths are left out.
 */
export function readExamples(raw: unknown, cluster: string, order: readonly string[]): Examples | null {
  const r = raw as { cluster?: unknown; programId?: unknown; paths?: unknown } | null;
  if (!r || r.cluster !== cluster || typeof r.programId !== "string" || typeof r.paths !== "object" || r.paths === null) return null;
  const all = r.paths as Record<string, unknown>;
  const paths: ExamplePath[] = [];
  for (const id of order) {
    const steps = all[id];
    if (Array.isArray(steps) && steps.length > 0 && steps.every(isStep)) paths.push({ id, steps });
  }
  return paths.length > 0 ? { cluster, programId: r.programId, paths } : null;
}
