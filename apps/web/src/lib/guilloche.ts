// Interlaced sine lines of the certificate band. Deterministic: the same numbers give the same paths on the page, in
// the PNG card and in the PDF card.

export function wavePath(width: number, height: number, waves: number, phase: number, amp: number): string {
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

export function guillochePaths(width: number, height: number, lines: number, waves: number): string[] {
  return Array.from({ length: lines }, (_, i) => wavePath(width, height, waves, (i / lines) * Math.PI * 2, height * 0.42));
}
