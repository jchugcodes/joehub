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

/** GAP: the chart shape is reconstructed from the flattened frame, not a data series. */
export function Sparkline() {
  return (
    <svg viewBox="0 0 360 120" className="h-24 w-full" role="img" aria-label="Net worth, year to date, rising">
      <path
        d="M0 90 C 30 88, 40 70, 70 72 S 110 96, 140 78 S 190 40, 220 48 S 270 70, 300 36 L 360 18 L 360 120 L 0 120 Z"
        fill="var(--finance)"
        opacity="0.18"
      />
      <path
        d="M0 90 C 30 88, 40 70, 70 72 S 110 96, 140 78 S 190 40, 220 48 S 270 70, 300 36 L 360 18"
        fill="none"
        stroke="var(--finance)"
        strokeWidth="3"
      />
    </svg>
  );
}
