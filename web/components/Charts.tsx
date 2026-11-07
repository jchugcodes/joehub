const toneStroke: Record<string, string> = {
  finance: "var(--finance)",
  jobs: "var(--jobs)",
  gold: "var(--gold)",
  journal: "var(--journal)",
};

export function Ring({
  value,
  tone,
  label,
  suffix = "",
}: {
  value: number;
  tone: string;
  label: string;
  suffix?: string;
}) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const dash = (Math.max(0, Math.min(100, value)) / 100) * circumference;
  return (
    <svg width="76" height="76" viewBox="0 0 76 76" role="img" aria-label={label}>
      <circle cx="38" cy="38" r={radius} fill="none" stroke="var(--line)" strokeWidth="8" />
      <circle
        cx="38"
        cy="38"
        r={radius}
        fill="none"
        stroke={toneStroke[tone] ?? "var(--finance)"}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference - dash}`}
        transform="rotate(-90 38 38)"
      />
      <text x="38" y="43" textAnchor="middle" fill="var(--ink)" fontSize={suffix ? "13" : "16"} fontWeight="600">
        {value}
        {suffix}
      </text>
    </svg>
  );
}

const financeLine =
  "M0.0,116.0 L24.4,102.8 L48.8,109.4 L73.1,89.6 L97.5,94.9 L121.9,79.1 L146.2,76.5 L170.6,84.4 L195.0,64.6 L219.4,56.7 L243.8,62.0 L268.1,42.2 L292.5,34.3 L316.9,39.6 L341.2,23.8 L365.6,18.5 L390.0,4.0";
const homeLine = "M0.0,40.0 L18.6,32.0 L37.1,35.2 L55.7,24.0 L74.3,25.6 L92.9,16.0 L111.4,12.8 L130.0,4.0";

/** Paths are the synthetic series from the handoff HTML, not a live read. */
export function Sparkline({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <svg width="130" height="44" viewBox="0 0 130 44" role="img" aria-label="Net worth, year to date, rising">
        <path d={`${homeLine} L130,44 L0,44Z`} fill="var(--finance)" opacity="0.1" />
        <path d={homeLine} fill="none" stroke="var(--finance)" strokeWidth="2.2" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 390 120" className="h-[120px] w-full" role="img" aria-label="Net worth, year to date, rising">
      <path d={`${financeLine} L390,120 L0,120Z`} fill="var(--finance)" opacity="0.1" />
      <path d={financeLine} fill="none" stroke="var(--finance)" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}
