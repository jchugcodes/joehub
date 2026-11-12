"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { hasNetWorthHistory, periodChange } from "../lib/finance.mjs";
import { showMonthBudget, showNetWorthChart } from "../lib/live-pages.mjs";
import { FinanceTabs } from "./FinanceTabs";
import { CategoryMark } from "./CategoryMark";
import { Icon } from "./Icon";
import { useProductionNav } from "./LivePages";

const RANGES = ["1W", "1M", "YTD", "1Y", "All"] as const;
type Range = (typeof RANGES)[number];
type Tone = "offline" | "reconnecting" | "back" | "";

type Cap = {
  slug: string;
  name: string;
  color: string;
  spentCents: number;
  capCents: number;
  state: string;
  percent: number | null;
  fill: number;
  tone: string;
  status: string;
};
type Recent = { id: string; payee: string; amountCents: number; meta: string; corrected: boolean; category: string | null; type: string };
type Overview = {
  asOf: string;
  weekStart: string;
  label: string;
  current: boolean;
  daysLeft: number | null;
  previousWeek: string;
  nextWeek: string | null;
  netWorthCents: number;
  chart: {
    range: string;
    kind: string;
    caption: string;
    points: number[];
    axis?: { min: number; max: number; zero: number | null };
    changeTone?: "up" | "down" | "flat";
    startCents?: number;
    endCents?: number;
  };
  month: { label: string; spentCents: number; planCents: number | null; percent: number | null; day: number; days: number };
  caps: Cap[];
  recent: Recent[];
  empty: boolean;
};

const CACHE = "joehub.finance.overview";

function dollars(cents: number) {
  const rounded = Math.round(cents);
  const whole = Math.trunc(Math.abs(rounded) / 100);
  return `${rounded < 0 ? "−" : ""}$${whole.toLocaleString("en-US")}`;
}

function centsPart(cents: number) {
  return String(Math.abs(Math.round(cents)) % 100).padStart(2, "0");
}

function money(cents: number, digits?: boolean, signed = false) {
  const sign = cents < 0 ? "−" : signed && cents > 0 ? "+" : "";
  const abs = Math.abs(cents);
  const show = digits ?? abs % 100 !== 0;
  const text = show ? (abs / 100).toFixed(2) : String(Math.round(abs / 100));
  const [whole, frac] = text.split(".");
  return `${sign}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac ? `.${frac}` : ""}`;
}

function stamp(ms: number) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(ms);
}

const CHART_W = 390;
const CHART_H = 148;
const ABOVE = "#2E8B6A";
const BELOW = "#E07A5F";

type PlotPoint = { x: number; y: number; v: number };

function easeOut(t: number) {
  return 1 - (1 - t) ** 3;
}

function motionReduced() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function resample(values: number[], count = 48) {
  if (!values.length) return [];
  if (values.length === 1) return Array(count).fill(values[0]);
  const out: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = (index / (count - 1)) * (values.length - 1);
    const left = Math.floor(t);
    const right = Math.min(values.length - 1, left + 1);
    const fraction = t - left;
    out.push(values[left] * (1 - fraction) + values[right] * fraction);
  }
  return out;
}

function useChartMotion(points: number[], startCents: number, endCents: number) {
  const fromPts = useRef<number[] | null>(null);
  const fromEnds = useRef<{ start: number; end: number } | null>(null);
  const [frame, setFrame] = useState(() => ({ points: resample(points), start: startCents, end: endCents }));
  const key = `${points.join(",")}|${startCents}|${endCents}`;
  useEffect(() => {
    const to = resample(points);
    const next = { start: startCents, end: endCents };
    const from = fromPts.current;
    const ends = fromEnds.current;
    fromPts.current = to;
    fromEnds.current = next;
    if (!from || !ends || motionReduced()) {
      setFrame({ points: to, start: next.start, end: next.end });
      return undefined;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 300);
      const eased = easeOut(t);
      setFrame({
        points: from.map((value, index) => value + (to[index] - value) * eased),
        start: ends.start + (next.start - ends.start) * eased,
        end: ends.end + (next.end - ends.end) * eased,
      });
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [key]);
  return frame;
}

function yDomain(values: number[]) {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low;
  const include = (low <= 0 && high >= 0) || span <= 0 || span >= 0.25 * Math.min(Math.abs(low), Math.abs(high));
  const lo = include ? Math.min(low, 0) : low;
  const hi = include ? Math.max(high, 0) : high;
  const pad = (hi - lo) * 0.12 || 1000;
  return { lo: lo - pad, hi: hi + pad, include };
}

function plotPoints(values: number[]) {
  const domain = yDomain(values);
  const yOf = (value: number) => ((domain.hi - value) / (domain.hi - domain.lo || 1)) * CHART_H;
  const pts: PlotPoint[] = values.map((value, index) => ({
    x: values.length === 1 ? CHART_W / 2 : (index / (values.length - 1)) * CHART_W,
    y: yOf(value),
    v: value,
  }));
  return { pts, y0: yOf(0), include: domain.include };
}

function crossings(pts: PlotPoint[]) {
  const out: PlotPoint[] = [pts[0]];
  for (let index = 1; index < pts.length; index += 1) {
    const left = pts[index - 1];
    const right = pts[index];
    if ((left.v > 0 && right.v < 0) || (left.v < 0 && right.v > 0)) {
      const t = left.v / (left.v - right.v);
      out.push({ x: left.x + t * (right.x - left.x), y: left.y + t * (right.y - left.y), v: 0 });
    }
    out.push(right);
  }
  return out;
}

function segments(pts: PlotPoint[]) {
  const above: PlotPoint[][] = [];
  const below: PlotPoint[][] = [];
  let current: PlotPoint[] = [];
  let sign = 0;
  const flush = () => {
    if (current.length >= 2) (sign > 0 ? above : below).push(current.slice());
    current = [];
  };
  for (const point of pts) {
    const next = point.v === 0 ? 0 : point.v > 0 ? 1 : -1;
    if (!current.length || next === 0 || next === sign || sign === 0) {
      current.push(point);
      if (next) sign = next;
    } else {
      current.push(point);
      flush();
      current.push(point);
      sign = next;
    }
  }
  if (current.length) flush();
  return { above, below };
}

function linePath(seg: PlotPoint[]) {
  return seg.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
}

function areaPath(seg: PlotPoint[], y0: number) {
  const last = seg[seg.length - 1];
  return `${linePath(seg)} L${last.x.toFixed(2)},${y0.toFixed(2)} L${seg[0].x.toFixed(2)},${y0.toFixed(2)} Z`;
}

function weeklyGeometry(points: number[], axis?: { min: number; max: number; zero: number | null }) {
  if (!points.length) return { line: "", fill: "", zeroY: null as number | null };
  const width = 360;
  const height = 120;
  const min = axis ? axis.min : Math.min(...points);
  const max = axis ? axis.max : Math.max(...points);
  const span = max - min || 1;
  const yOf = (value: number) => height - 8 - ((value - min) / span) * (height - 16);
  const coords = points.map((value, index) => {
    const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
    return { x, y: yOf(value) };
  });
  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const zeroY = axis && axis.zero != null ? yOf(axis.zero) : null;
  const base = zeroY == null ? height : zeroY;
  const fill = `${line} L${coords[coords.length - 1].x.toFixed(1)} ${base.toFixed(1)} L${coords[0].x.toFixed(1)} ${base.toFixed(1)} Z`;
  return { line, fill, zeroY };
}

function TrendMark({ tone, color }: { tone: string; color: string }) {
  if (tone !== "up" && tone !== "down") return null;
  const d = tone === "down" ? "M3 7l6 6 4-4 8 8M15 17h6v-6" : "M3 17l6-6 4 4 8-8M15 7h6v6";
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function ChartPaths({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const { pts, y0, include } = plotPoints(points);
  const drawn = segments(crossings(pts));
  const labelY = y0 < 18 ? y0 + 14 : y0 - 6;
  return (
    <>
      {include ? (
        <>
          <line x1="0" x2={CHART_W} y1={y0} y2={y0} stroke="#C9CEC8" strokeWidth="1" />
          <text x="8" y={labelY} fill="#6B746E" fontSize="12" fontFamily="Outfit, sans-serif">
            0
          </text>
        </>
      ) : null}
      {drawn.above.map((seg, index) => (
        <g key={`above-${index}`}>
          <path d={areaPath(seg, y0)} fill={ABOVE} opacity="0.1" />
          <path d={linePath(seg)} fill="none" stroke={ABOVE} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        </g>
      ))}
      {drawn.below.map((seg, index) => (
        <g key={`below-${index}`}>
          <path d={areaPath(seg, y0)} fill={BELOW} opacity="0.12" />
          <path d={linePath(seg)} fill="none" stroke={BELOW} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        </g>
      ))}
    </>
  );
}

function WeeklySpendChart({
  netWorthCents,
  chart,
  showCaption,
  showChart,
  children,
}: {
  netWorthCents: number;
  chart: Overview["chart"];
  showCaption: boolean;
  showChart: boolean;
  children: ReactNode;
}) {
  const geometry = weeklyGeometry(chart.points, chart.axis);
  return (
    <>
      <p className="mt-1 font-medium leading-none" data-net-worth={netWorthCents} style={netWorthCents < 0 ? { color: BELOW } : undefined}>
        <span className="text-title">{dollars(netWorthCents)}</span>
        <span className="text-section">.{centsPart(netWorthCents)}</span>
      </p>
      {showCaption ? <p className="mt-2 text-body text-finance-primary">{chart.caption}</p> : null}
      {showChart ? (
        <div className="mt-4" data-chart={chart.range} data-kind="weekly" data-points={chart.points.join(",")} data-baseline={chart.axis?.zero != null ? "true" : "false"}>
          <svg viewBox="0 0 360 120" className="h-28 w-full" role="img" aria-label="Net worth chart">
            <path d={geometry.fill} fill="#2E8B6A" opacity="0.1" />
            {geometry.zeroY != null ? <line x1="0" x2="360" y1={geometry.zeroY} y2={geometry.zeroY} stroke="#C9CEC8" strokeWidth="1" /> : null}
            <path d={geometry.line} fill="none" stroke="#2E8B6A" strokeWidth="2.2" />
          </svg>
          {chart.axis && chart.axis.min < 0 ? (
            <p className="mt-1 flex justify-between text-meta text-muted">
              <span>{money(chart.axis.min, true)}</span>
              <span>{money(chart.axis.max, true)}</span>
            </p>
          ) : null}
          {children}
        </div>
      ) : null}
    </>
  );
}

function NetWorthSeriesChart({
  netWorthCents,
  chart,
  showCaption,
  showChart,
  children,
}: {
  netWorthCents: number;
  chart: Overview["chart"];
  showCaption: boolean;
  showChart: boolean;
  children: ReactNode;
}) {
  const start = chart.startCents ?? chart.points[0] ?? 0;
  const end = chart.endCents ?? chart.points[chart.points.length - 1] ?? netWorthCents;
  const frame = useChartMotion(chart.points, start, end);
  const shownEnd = showChart ? frame.end : netWorthCents;
  const change = periodChange(frame.start, frame.end);
  const changeColor = change.tone === "down" ? BELOW : change.tone === "up" ? ABOVE : "#6B746E";
  const settledTone = chart.changeTone || change.tone;
  return (
    <>
      <p className="mt-1 font-medium leading-none" data-net-worth={netWorthCents} style={shownEnd < 0 ? { color: BELOW } : undefined}>
        <span className="text-title">{dollars(shownEnd)}</span>
        <span className="text-section">.{centsPart(shownEnd)}</span>
      </p>
      {showCaption ? (
        <p className="mt-0.5 flex items-center gap-1 text-body" style={{ color: changeColor }} data-change={chart.caption} data-tone={settledTone}>
          <TrendMark tone={change.tone} color={changeColor} />
          <span>{change.text}</span>
          <span className="font-medium text-muted">{chart.range}</span>
        </p>
      ) : null}
      {showChart ? (
        <div
          className="mt-2"
          data-chart={chart.range}
          data-kind="net-worth"
          data-points={chart.points.join(",")}
          data-baseline={chart.axis?.zero != null ? "true" : "false"}
        >
          <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="h-[148px] w-full overflow-hidden" role="img" aria-label="Net worth chart">
            <ChartPaths points={frame.points} />
          </svg>
          {children}
        </div>
      ) : null}
    </>
  );
}

function NetWorthChart(props: {
  netWorthCents: number;
  chart: Overview["chart"];
  showCaption: boolean;
  showChart: boolean;
  children: ReactNode;
}) {
  if (props.chart.kind !== "net-worth") return <WeeklySpendChart {...props} />;
  return <NetWorthSeriesChart {...props} />;
}

export function FinanceOverview() {
  const production = useProductionNav();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [week, setWeek] = useState("");
  const [range, setRange] = useState<Range>("YTD");
  const [asOf, setAsOf] = useState("");
  const [tone, setTone] = useState<Tone>("");
  const [updated, setUpdated] = useState("");
  const [menu, setMenu] = useState(false);
  const [wide, setWide] = useState(false);
  const [message, setMessage] = useState("");
  const overviewRef = useRef<Overview | null>(null);
  const weekRef = useRef("");
  const rangeRef = useRef<Range>("YTD");
  const asOfRef = useRef("");
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  overviewRef.current = overview;
  weekRef.current = week;
  rangeRef.current = range;
  asOfRef.current = asOf;

  const remember = useCallback((body: Overview) => {
    setOverview(body);
    setUpdated(stamp(Date.now()));
    try {
      sessionStorage.setItem(CACHE, JSON.stringify(body));
    } catch {
      /* snapshot is best-effort */
    }
  }, []);

  const load = useCallback(
    async (nextWeek = weekRef.current, nextRange = rangeRef.current, quiet = false) => {
      const params = new URLSearchParams();
      if (nextWeek) params.set("week", nextWeek);
      if (nextRange) params.set("range", nextRange);
      if (asOfRef.current) params.set("asOf", asOfRef.current);
      const response = await fetch(`/api/finance/overview?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as Overview;
      remember(body);
      failures.current = 0;
      return body;
    },
    [remember],
  );

  const refresh = useCallback(async () => {
    if (!navigator.onLine) {
      setTone("offline");
      return;
    }
    if (!overviewRef.current) setTone("");
    else if (tone === "offline" || tone === "reconnecting") setTone("reconnecting");
    try {
      await load(weekRef.current, rangeRef.current, true);
      if (tone === "offline" || tone === "reconnecting") {
        setTone("back");
        if (backTimer.current) clearTimeout(backTimer.current);
        backTimer.current = setTimeout(() => setTone(""), 3000);
      } else setTone("");
    } catch {
      failures.current += 1;
      setTone(overviewRef.current ? (failures.current > 1 ? "reconnecting" : "offline") : "");
      if (!overviewRef.current) setMessage("Finance is unavailable.");
    }
  }, [load, tone]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialWeek = params.get("week") || "";
    const initialRange = RANGES.includes(params.get("range") as Range) ? (params.get("range") as Range) : "YTD";
    const initialAsOf = params.get("asOf") || "";
    setWeek(initialWeek);
    setRange(initialRange);
    setAsOf(initialAsOf);
    weekRef.current = initialWeek;
    rangeRef.current = initialRange;
    asOfRef.current = initialAsOf;
    try {
      const cached = sessionStorage.getItem(CACHE);
      if (cached) setOverview(JSON.parse(cached) as Overview);
    } catch {
      /* ignore a bad snapshot */
    }
    const onResize = () => setWide(window.innerWidth >= 1024);
    onResize();
    window.addEventListener("resize", onResize);
    if (!navigator.onLine) setTone("offline");
    void load(initialWeek, initialRange).catch(() => {
      if (!navigator.onLine) setTone("offline");
      else setMessage("Finance is unavailable.");
    });
    return () => window.removeEventListener("resize", onResize);
  }, [load]);

  useEffect(() => {
    const poll = () => {
      if (timer.current) clearTimeout(timer.current);
      const wait = document.visibilityState === "hidden" ? 60_000 : failures.current ? Math.min(30_000, 1000 * 2 ** failures.current) : 15_000;
      timer.current = setTimeout(async () => {
        if (document.visibilityState !== "hidden") await refresh();
        poll();
      }, wait);
    };
    const onFocus = () => void refresh();
    const onOffline = () => setTone("offline");
    const onOnline = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    poll();
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      if (timer.current) clearTimeout(timer.current);
      if (backTimer.current) clearTimeout(backTimer.current);
    };
  }, [refresh]);

  function chooseWeek(next: string) {
    setWeek(next);
    weekRef.current = next;
    const params = new URLSearchParams(window.location.search);
    params.set("week", next);
    window.history.replaceState(null, "", `/finance?${params.toString()}`);
    void load(next, rangeRef.current).catch(() => setMessage("Finance is unavailable."));
  }

  function chooseRange(next: Range) {
    setRange(next);
    rangeRef.current = next;
    setMenu(false);
    const params = new URLSearchParams(window.location.search);
    params.set("range", next);
    window.history.replaceState(null, "", `/finance?${params.toString()}`);
    void load(weekRef.current, next).catch(() => setMessage("Finance is unavailable."));
  }

  const offline = tone === "offline" || tone === "reconnecting";
  const recent = overview ? overview.recent.slice(0, wide ? 6 : 5) : [];
  const query = new URLSearchParams();
  if (overview) query.set("week", overview.weekStart);
  if (asOf) query.set("asOf", asOf);
  const suffix = query.toString() ? `?${query.toString()}` : "";

  return (
    <main className="finance-type relative mx-auto w-full max-w-[1080px] text-ink" data-ready={overview ? "true" : "false"}>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
        {tone === "offline" && updated ? (
          <p role="status" data-offline="true" data-link="offline" className="pointer-events-none mx-4 mt-3 rounded-2xl border border-[#C9CEC8] bg-[#EEF0EC] px-3.5 py-3 text-body font-medium">
            Offline
            <span className="mt-0.5 block text-meta font-normal text-muted">Last updated {updated}</span>
            <span className="block text-meta font-normal text-muted">America/Detroit</span>
          </p>
        ) : null}
        {tone === "reconnecting" ? (
          <p role="status" data-offline="true" data-link="reconnecting" className="pointer-events-none mx-4 mt-3 rounded-2xl border border-[#E9B94933] bg-[#E9B9491F] px-3.5 py-3 text-body font-medium text-[#8A6B14]">
            Reconnecting…
          </p>
        ) : null}
        {tone === "back" ? (
          <p role="status" data-link="back" className="pointer-events-none mx-4 mt-3 flex items-center justify-between gap-3 rounded-2xl border border-[#2E8B6A33] bg-[#2E8B6A1F] px-3.5 py-3 text-body font-medium text-[#246C53]">
            <span>Back online</span>
            <button type="button" className="pointer-events-auto min-h-11 px-2 text-meta font-medium text-muted" onClick={() => setTone("")}>
              Dismiss
            </button>
          </p>
        ) : null}
      </div>
      <header className="flex items-center justify-between px-5 pb-1 pt-2">
        <p className="text-meta text-muted">joehub</p>
      </header>
      <div className="px-5">
        <h1 className="text-title font-medium">Finance</h1>
      </div>
      <div className="mt-3">
        <FinanceTabs />
      </div>
      {!overview ? <p className="px-5 py-8 text-body text-muted">{message || "Loading finance…"}</p> : null}
      {overview ? (
        <div className="lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] lg:gap-8">
          <section className="px-5 pt-5">
            <p className="text-meta text-muted">Net worth</p>
            <NetWorthChart
              netWorthCents={overview.netWorthCents}
              chart={overview.chart}
              showCaption={showNetWorthChart(production, hasNetWorthHistory(overview.chart.points)) && !offline && Boolean(overview.chart.caption) && !(production && /no history imported|\(7\.5%\)/.test(overview.chart.caption))}
              showChart={showNetWorthChart(production, hasNetWorthHistory(overview.chart.points)) && !offline}
            >
              <div className="mt-2 flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 gap-1">
                    {RANGES.map((item) => (
                      <button
                        key={item}
                        type="button"
                        aria-pressed={range === item}
                        className={`min-h-11 flex-1 rounded-full text-meta ${range === item ? "bg-finance-primary text-page" : "text-muted"}`}
                        onClick={() => chooseRange(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                  <div className="relative">
                    <button type="button" aria-label="Choose chart period" aria-expanded={menu} className="grid h-11 w-11 place-items-center" onClick={() => setMenu((open) => !open)}>
                      <Icon name="chevron" size={18} />
                    </button>
                    {menu ? (
                      <div className="absolute right-0 z-10 mt-1 min-w-28 rounded-2xl border border-line bg-page p-1 shadow-sm">
                        {RANGES.map((item) => (
                          <button key={item} type="button" className="block min-h-11 w-full rounded-xl px-3 text-left text-body" onClick={() => chooseRange(item)}>
                            {item}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
            </NetWorthChart>
            {!offline ? (
              <section className="mt-6 rounded-[22px] border border-line px-4 py-4">
                <div className="flex items-baseline justify-between gap-3 text-meta">
                  <p className="font-medium text-ink">Spent this month</p>
                  <p className="text-muted">{overview.month.label}</p>
                </div>
                <p className="mt-1 font-medium">
                  <span className="text-title">{money(overview.month.spentCents, false)}</span>
                  {showMonthBudget(production, overview.month) && overview.month.planCents != null && overview.month.percent != null ? (
                    <>
                      {" "}
                      <span className="text-body font-normal text-muted">of {money(overview.month.planCents, false)} plan</span>
                    </>
                  ) : null}
                </p>
                {showMonthBudget(production, overview.month) && overview.month.percent != null ? (
                  <div className="relative mt-3 h-2.5 rounded-full bg-line">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, overview.month.percent))}%`, background: "#E07A5F" }} />
                    <span className="absolute -top-1 h-[18px] w-0.5 bg-ink" style={{ left: `${Math.min(100, Math.round((overview.month.day / overview.month.days) * 100))}%` }} />
                  </div>
                ) : null}
                <p className={`mt-2 flex text-meta text-muted ${showMonthBudget(production, overview.month) ? "justify-between" : "justify-end"}`}>
                  {showMonthBudget(production, overview.month) && overview.month.percent != null ? <span>{overview.month.percent}% used</span> : null}
                  <span>Day {overview.month.day} of {overview.month.days}</span>
                </p>
              </section>
            ) : null}
          </section>
          <section className="px-5 pt-6">
            <div className="flex items-center justify-between gap-2">
              <button type="button" aria-label="Previous week" className="grid h-11 w-11 shrink-0 place-items-center" onClick={() => chooseWeek(overview.previousWeek)}>
                <Icon name="back" size={18} />
              </button>
              <div className="min-w-0 text-center">
                <h2 className="text-body font-medium">{overview.label}</h2>
                {overview.daysLeft != null ? <p className="text-meta text-muted">{overview.daysLeft} days left</p> : null}
              </div>
              <button
                type="button"
                aria-label={overview.nextWeek ? "Next week" : "Next week, unavailable"}
                disabled={!overview.nextWeek}
                className="grid h-11 w-11 shrink-0 place-items-center disabled:opacity-40"
                onClick={() => overview.nextWeek && chooseWeek(overview.nextWeek)}
              >
                <Icon name="chevron" size={18} />
              </button>
            </div>
            <div className="mt-4 flex items-baseline justify-between gap-3">
              <h3 className="text-body font-medium">Weekly caps</h3>
              <Link href={`/finance/caps${suffix}`} className="text-body font-medium text-finance-primary">
                Edit caps
              </Link>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {overview.caps.map((cap) => (
                <Link key={cap.slug} href={`/finance/categories/${cap.slug}${suffix}`} className="min-h-11 rounded-2xl border border-line p-3">
                  <span className="block h-2 w-2 rounded-full" style={{ background: cap.color }} />
                  <span className="mt-2 block text-meta">{cap.name}</span>
                  <span className="mt-1 block text-body font-medium">{money(cap.spentCents)}</span>
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-line">
                    {cap.percent != null ? (
                      <span className="block h-full rounded-full" style={{ width: `${cap.fill}%`, background: cap.tone === "over" ? "#E07A5F" : cap.color }} />
                    ) : null}
                  </span>
                  <span className="mt-1.5 block text-meta font-medium leading-tight" style={{ color: cap.percent == null ? undefined : cap.tone === "over" ? "#E07A5F" : cap.color }}>
                    {cap.percent == null ? <span className="font-normal text-muted">{cap.status}</span> : <>{cap.percent}%<br />{cap.status}</>}
                  </span>
                </Link>
              ))}
            </div>
            {offline ? <p className="mt-4 rounded-2xl border border-line px-4 py-3 text-center text-body">Can’t edit offline</p> : null}
            <div className="mt-6 flex items-baseline justify-between gap-3">
              <h3 className="text-body font-medium">Recent</h3>
              <Link href={`/finance/transactions${suffix}`} className="text-body font-medium text-finance-primary">
                See all
              </Link>
            </div>
            {overview.empty ? (
              <div className="mt-6 text-center">
                <p className="text-body">No transactions this week</p>
                <Link href={`/finance/transactions${suffix ? `${suffix}&add=1` : "?add=1"}`} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-ink px-4 text-body text-page">
                  Add expense or income
                </Link>
              </div>
            ) : (
              <ul className="mt-2">
                {recent.map((row) => (
                  <li key={row.id} className="flex min-h-11 items-center gap-3 border-b border-line py-3">
                    <CategoryMark category={row.category} type={row.type} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body">{row.payee}</span>
                      <span className="block text-meta text-muted">{row.meta}</span>
                    </span>
                    <span className={`text-body ${row.amountCents > 0 ? "text-finance-primary" : ""}`}>{money(row.amountCents, true, true)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}
