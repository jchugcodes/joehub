/** Paths are the inline marks from the handoff HTML. Width and height stay the HTML sizes. */

const paths: Record<string, string[]> = {
  home: ["M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"],
  finance: [],
  jobs: ["M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"],
  journal: ["M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z", "M8 8h6M8 12h5"],
  search: [],
  bell: ["M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"],
  trend: ["M3 17l6-6 4 4 8-8M15 7h6v6"],
  chevron: ["M9 6l6 6-6 6"],
  back: ["M15 6l-6 6 6 6"],
  swipe: ["M4 12h14M14 8l4 4-4 4"],
  plus: ["M12 5v14M5 12h14"],
  close: ["M6 6l12 12M18 6L6 18"],
  filter: ["M3 5h18l-7 8v6l-4 2v-8z"],
  grip: ["M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"],
  check: ["M5 12l5 5 9-10"],
  pencil: ["M4 20h4L19 9l-4-4L4 16zM14 6l4 4"],
  dining: ["M7 3v8a2 2 0 0 0 2 2v8M5 3v6M9 3v6M17 3c-2 0-3 3-3 6s1 4 3 4v8"],
  groceries: [],
  transport: ["M5 16l1.5-6A2 2 0 0 1 8.4 8.5h7.2a2 2 0 0 1 1.9 1.5L19 16M3 16h18v3H3zM7 19v2M17 19v2"],
  subscriptions: ["M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"],
  shopping: ["M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2"],
  utilities: ["M13 2L4 14h7l-1 8 9-12h-7z"],
  income: ["M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"],
  sun: [],
};

export function Icon({
  name,
  size = 22,
  strokeWidth = 1.8,
  className,
}: {
  name: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
    className,
  };
  if (name === "finance") {
    return (
      <svg {...common}>
        <rect x="3" y="6" width="18" height="14" rx="2" />
        <path d="M16 13h2M3 10h18M6 6V4h11v2" />
      </svg>
    );
  }
  if (name === "jobs") {
    return (
      <svg {...common}>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" />
      </svg>
    );
  }
  if (name === "search") {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-4-4" />
      </svg>
    );
  }
  if (name === "more") {
    return (
      <svg {...common}>
        <circle cx="5" cy="12" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="19" cy="12" r="1.5" />
      </svg>
    );
  }
  if (name === "groceries") {
    return (
      <svg {...common}>
        <circle cx="9" cy="20" r="1.5" />
        <circle cx="18" cy="20" r="1.5" />
        <path d="M2 3h3l3 12h11l2-8H6" />
      </svg>
    );
  }
  if (name === "calendar") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    );
  }
  if (name === "sun") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.5 5.5l1.5 1.5M17 17l1.5 1.5M18.5 5.5 17 7M7 17l-1.5 1.5" />
      </svg>
    );
  }
  const drawn = paths[name] ?? ["M12 12h.01"];
  return (
    <svg {...common}>
      {drawn.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
