// Fine interlaced lines, as printed on certificates. Deterministic, drawn once on the server.

interface Props {
  width: number;
  height: number;
  lines: number;
  waves: number;
}

function wavePath(width: number, height: number, waves: number, phase: number, amp: number): string {
  const steps = waves * 24;
  const mid = height / 2;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * width;
    const t = (i / steps) * waves * 2 * Math.PI;
    const y = mid + amp * Math.sin(t + phase) * Math.cos(t / 3 - phase / 2);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(2)}`;
  }
  return d;
}

export function Guilloche({ width, height, lines, waves }: Props) {
  const paths = Array.from({ length: lines }, (_, i) =>
    wavePath(width, height, waves, (i / lines) * Math.PI * 2, height * 0.42),
  );
  return (
    <svg className="guilloche" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
