/** GAP: icons were unresolved in the handoff. These are simple stand-ins, not a supplied set. */
export function Icon({ name }: { name: string }) {
  const common = {
    viewBox: "0 0 24 24",
    className: "h-[22px] w-[22px]",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (name === "home") {
    return (
      <svg {...common}>
        <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" />
      </svg>
    );
  }
  if (name === "finance") {
    return (
      <svg {...common}>
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M3 10h18M7 15h4" />
      </svg>
    );
  }
  if (name === "jobs") {
    return (
      <svg {...common}>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
    );
  }
  if (name === "journal") {
    return (
      <svg {...common}>
        <path d="M6 4h11a2 2 0 0 1 2 2v14H8a2 2 0 0 0-2 2V4z" />
        <path d="M6 4a2 2 0 0 0-2 2v14" />
      </svg>
    );
  }
  if (name === "more") {
    return (
      <svg {...common}>
        <circle cx="6" cy="12" r="1.2" fill="currentColor" />
        <circle cx="12" cy="12" r="1.2" fill="currentColor" />
        <circle cx="18" cy="12" r="1.2" fill="currentColor" />
      </svg>
    );
  }
  if (name === "search") {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="6" />
        <path d="m16 16 4 4" />
      </svg>
    );
  }
  if (name === "bell") {
    return (
      <svg {...common}>
        <path d="M6 16V10a6 6 0 1 1 12 0v6l1.5 2H4.5z" />
        <path d="M10 19a2 2 0 0 0 4 0" />
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
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}
