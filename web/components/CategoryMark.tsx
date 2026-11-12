import { Icon } from "./Icon";

const MARKS: Record<string, { icon: string; color: string }> = {
  "dining-out": { icon: "dining", color: "#E07A5F" },
  groceries: { icon: "groceries", color: "#2E8B6A" },
  transport: { icon: "transport", color: "#5B6B8C" },
  subscriptions: { icon: "subscriptions", color: "#8E7CC3" },
  shopping: { icon: "shopping", color: "#E9B949" },
  utilities: { icon: "utilities", color: "#3A86C8" },
  "health-fitness": { icon: "check", color: "#2A9D8F" },
  fun: { icon: "sun", color: "#C2577A" },
  school: { icon: "pencil", color: "#3A6EA5" },
  other: { icon: "more", color: "#6B746E" },
  uncategorized: { icon: "clock", color: "#6B746E" },
};

export function CategoryMark({ category, type }: { category?: string | null; type?: string | null }) {
  const known = category ? MARKS[category] : undefined;
  const icon = type === "income" ? "income" : type === "transfer" ? "finance" : known?.icon || "more";
  const color = type === "income" ? "#2E8B6A" : type === "transfer" ? "#5B6B8C" : known?.color || "#6B746E";
  return (
    <span aria-hidden="true" data-category-mark={category || type || "none"} className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: `${color}1F`, color }}>
      <Icon name={icon} size={18} />
    </span>
  );
}
