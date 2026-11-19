/** Map a Categories URL onto Spending. The path slug becomes `cat`. Other params stay. */

export function spendingPath(search, cat) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search || {})) {
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (typeof item === "string") query.append(key, item);
    }
  }
  if (cat) query.set("cat", cat);
  const text = query.toString();
  return text ? `/finance/spending?${text}` : "/finance/spending";
}
