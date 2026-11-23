// Fine interlaced lines, as printed on certificates. Deterministic, drawn once on the server.
import { guillochePaths } from "@/lib/guilloche";

interface Props {
  width: number;
  height: number;
  lines: number;
  waves: number;
}

export function Guilloche({ width, height, lines, waves }: Props) {
  const paths = guillochePaths(width, height, lines, waves);
  return (
    <svg className="guilloche" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
