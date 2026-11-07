/** Frame example copy. Not a mapping from the API or the database. See docs/DESIGN_GAPS.md. */

export const home = {
  date: "Friday, Nov 6",
  greeting: "Evening, Joe",
  initial: "J",
  net: "$18,472",
  ytd: "+7.5% YTD",
  spent: "$1,126 of $4,204 spent",
  diningNote: "Dining $18 left this week",
  jobs: [
    { label: "Applied", value: "8", tone: "jobs" },
    { label: "Interviewing", value: "3", tone: "interview" },
    { label: "Offer", value: "1", tone: "finance" },
  ],
  nextEvent: "Globex panel · Tue 2:00 PM",
  streak: "12-day streak",
  streakNote: "Tonight's wins not logged yet",
  goals: [
    { label: "Loan payoff", value: 62, tone: "finance" },
    { label: "Emergency fund", value: 41, tone: "jobs" },
    { label: "NYC move", value: 28, tone: "gold" },
  ],
};

export const finance = {
  net: "$18,472.36",
  delta: "+$1,284.10 (7.5%) YTD",
  spent: "$1,126",
  plan: "of $4,204 plan",
  used: 27,
  pace: "pace marker: day 6 of 30",
  period: "Nov 1–6",
  stats: [
    { label: "YTD income", value: "$61.2k", tone: "finance-text" },
    { label: "YTD spent", value: "$43.9k", tone: "spent-text" },
    { label: "YTD saved", value: "$9.8k", tone: "jobs-text" },
  ],
  caps: [
    { name: "Dining Out", left: "$62", spent: "$18", cap: "$80/wk", tone: "spent" },
    { name: "Groceries", left: "$94", spent: "$26", cap: "$120/wk", tone: "finance" },
  ],
  ranges: ["1W", "1M", "YTD", "1Y", "All"],
};

export const goals = [
  {
    name: "Student loan payoff",
    detail: "Debt · auto-pay $400/mo",
    progress: "$12,400 / $20,000",
    note: "On track · paid off Mar 2028",
    tone: "finance",
    value: 62,
  },
  {
    name: "Emergency fund",
    detail: "Savings · 3 months expenses",
    progress: "$5,170 / $12,600",
    note: "+$220 this month",
    tone: "jobs",
    value: 41,
  },
  {
    name: "NYC move fund",
    detail: "Savings · target Aug 2027",
    progress: "$2,240 / $8,000",
    note: "Behind by $310 · bump +$40/mo?",
    tone: "gold",
    value: 28,
  },
];

export const categories = ["Dining Out", "Groceries", "Transport", "Subscriptions", "Shopping", "Utilities"];

export const pipeline = {
  counts: [
    { label: "Applied", value: "8", note: "+3 this wk", tone: "jobs" },
    { label: "Interviewing", value: "3", note: "1 tomorrow", tone: "interview" },
    { label: "Offer", value: "1", note: "respond by 11/13", tone: "finance" },
  ],
  columns: [
    { name: "Saved", total: 5, tone: "muted", cards: ["Acme Labs", "Northwind"] },
    { name: "Applied", total: 8, tone: "jobs", cards: ["Globex · PM", "Initech · Ops"] },
    { name: "Interviewing", total: 3, tone: "interview", cards: ["Umbrella"] },
  ],
  matches: [
    {
      id: "globex",
      initial: "G",
      title: "Senior Product Analyst",
      meta: "Globex · NYC · Hybrid",
      score: "9.1",
      tags: ["SQL", "Fintech", "$135–150k"],
    },
    {
      id: "hooli",
      initial: "H",
      title: "Strategy & Ops Lead",
      meta: "Hooli · Remote",
      score: "7.4",
      tags: [],
    },
  ],
};

export const jobDetail = {
  id: "globex",
  initial: "G",
  title: "Senior Product Analyst",
  meta: "Globex · NYC Hybrid · $135–150k",
  statuses: ["Saved", "Applied", "Interviewing", "Offer"],
  current: "Interviewing",
  round: "Interviewing · Round 2",
  fit: "9.1",
  fitNote: "SQL, fintech, NYC",
  next: "Tue Nov 10",
  nextNote: "2:00 PM · panel",
  notes: [
    {
      when: "Nov 4 · recruiter call",
      body: "Team owns pricing analytics. Ask about on-call and roadmap ownership.",
    },
  ],
};

export const journal = {
  streak: "12 days",
  streakNote: "nightly-wins streak",
  month: "This month",
  monthNote: "31 wins · 6 fails",
  days: ["M", "T", "W", "T", "F", "S", "S"],
  done: [true, true, true, true, true, false, false],
  wins: [
    { ok: true, text: "Finished Globex take-home" },
    { ok: true, text: "Gym before work" },
    { ok: false, text: "Skipped meal prep" },
  ],
  entries: [
    {
      place: "Williamsburg",
      title: "Lilia",
      when: "Date night · Sat Oct 31",
      mood: "Loved",
      body: "Cacio e pepe fritelle. Book again for anniversary.",
    },
    {
      place: "Midtown",
      title: "Sample reminder",
      when: "Fri Nov 6",
      mood: "Meh",
      body: "Short example note below the fold.",
    },
  ],
};

export const transactions = [
  ["Joe's Pizza", "Nov 6", "Dining Out", "-14.50"],
  ["Trader Joe's", "Nov 5", "Groceries", "-46.12"],
  ["MTA", "Nov 5", "Transport", "-2.90"],
  ["Sweetgreen", "Nov 4", "Dining Out", "-16.25"],
  ["Spotify", "Nov 3", "Subscriptions", "-11.99"],
  ["Con Ed", "Nov 2", "Utilities", "-63.40"],
  ["Payroll", "Nov 1", "Income", "+2,350.00"],
  ["Lilia", "Oct 31", "Dining Out", "-88.00"],
  ["Uber", "Oct 30", "Transport", "-18.70"],
  ["Netflix", "Oct 30", "Subscriptions", "-15.45"],
  ["Whole Foods", "Oct 29", "Groceries", "-52.30"],
  ["Amazon", "Oct 28", "Shopping", "-24.99"],
  ["Citi Bike", "Oct 27", "Transport", "-4.45"],
  ["Loan pmt", "Oct 26", "Debt", "-400.00"],
];
