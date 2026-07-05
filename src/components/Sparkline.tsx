interface Props {
  seed: number;
  kind: "processor" | "mempool";
  width?: number;
  height?: number;
}

// Deterministic PRNG so the same device always renders the same fake trend
// across reloads, instead of re-randomizing every render.
function mulberry32(a: number) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POINTS = 48;

function generateSeries(seed: number): number[] {
  const rand = mulberry32(seed);
  const series: number[] = [];
  let value = 20 + rand() * 40;
  for (let i = 0; i < POINTS; i++) {
    value += (rand() - 0.5) * 12;
    value = Math.max(3, Math.min(97, value));
    series.push(value);
  }
  return series;
}

export function Sparkline({ seed, kind, width = 380, height = 100 }: Props) {
  const series = generateSeries(seed * 1000 + (kind === "processor" ? 1 : 2));
  const padding = 4;
  const w = width - padding * 2;
  const h = height - padding * 2;
  const stepX = w / (POINTS - 1);
  const points = series.map((v, i) => `${padding + i * stepX},${padding + h - (v / 100) * h}`);
  const areaPoints = [`${padding},${padding + h}`, ...points, `${padding + w},${padding + h}`];
  const color = kind === "processor" ? "#22c55e" : "#3b82f6";
  const latest = series[series.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="rounded w-full bg-gray-800">
      <polygon points={areaPoints.join(" ")} fill={color} fillOpacity={0.12} stroke="none" />
      <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth={1.5} />
      <text x={width - 6} y={14} textAnchor="end" fill={color} fontSize={11} fontFamily="monospace">
        {latest.toFixed(0)}%
      </text>
    </svg>
  );
}
