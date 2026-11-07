/** Sampled from flattened Figma frames 1:2–1:20. See docs/DESIGN_GAPS.md. */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        card: "var(--card)",
        ink: "var(--ink)",
        overlay: "var(--overlay)",
        muted: "var(--muted)",
        line: "var(--line)",
        finance: "var(--finance)",
        "finance-text": "var(--finance-text)",
        jobs: "var(--jobs)",
        "jobs-text": "var(--jobs-text)",
        journal: "var(--journal)",
        "journal-text": "var(--journal-text)",
        spent: "var(--spent)",
        "spent-text": "var(--spent-text)",
        gold: "var(--gold)",
        "gold-text": "var(--gold-text)",
        interview: "var(--interview)",
        "finance-soft": "var(--finance-soft)",
        "jobs-soft": "var(--jobs-soft)",
        "journal-soft": "var(--journal-soft)",
      },
      fontFamily: {
        sans: ["var(--font-dm)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      maxWidth: {
        phone: "390px",
      },
    },
  },
  plugins: [],
};
