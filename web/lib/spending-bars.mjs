/** Bar for one spending row. A cap or estimate fills against that amount. Otherwise the bar is that row's share of the period, and it is never marked over. */

export function categoryBar(item, periodSpent) {
  const cap = item && item.capCents;
  const percent = item && item.percent;
  const hasCap = Number.isInteger(cap) && cap > 0 && typeof percent === "number";
  if (hasCap) {
    const over = percent > 100;
    return {
      mode: "estimate",
      width: Math.min(100, Math.max(0, percent)),
      over,
      color: over ? "var(--chart-negative)" : item.color || "var(--muted)",
    };
  }
  const spent = Number.isInteger(periodSpent) && periodSpent > 0 ? periodSpent : 0;
  const rowSpent = item && Number.isInteger(item.spentCents) ? item.spentCents : 0;
  const share = spent > 0 ? Math.min(100, Math.max(rowSpent > 0 ? 1 : 0, Math.round((rowSpent / spent) * 100))) : 0;
  return {
    mode: "share",
    width: share,
    over: false,
    color: (item && item.color) || "var(--muted)",
  };
}
