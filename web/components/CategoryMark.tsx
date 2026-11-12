import { Icon } from "./Icon";

const MARKS: Record<string, { icon: string; color: string }> = {
  "dining-out": { icon: "dining", color: "var(--cat-dining)" },
  groceries: { icon: "groceries", color: "var(--cat-groceries)" },
  transport: { icon: "transport", color: "var(--cat-transport)" },
  subscriptions: { icon: "subscriptions", color: "var(--cat-subscriptions)" },
  shopping: { icon: "shopping", color: "var(--cat-shopping)" },
  utilities: { icon: "utilities", color: "var(--cat-utilities)" },
  "health-fitness": { icon: "check", color: "#2A9D8F" },
  fun: { icon: "sun", color: "var(--cat-loan)" },
  school: { icon: "pencil", color: "#3A6EA5" },
  other: { icon: "more", color: "var(--muted)" },
  uncategorized: { icon: "clock", color: "var(--muted)" },
};

export function CategoryMark({ category, type }: { category?: string | null; type?: string | null }) {
  const known = category ? MARKS[category] : undefined;
  const icon = type === "income" ? "income" : type === "transfer" ? "finance" : known?.icon || "more";
  const color = type === "income" ? "var(--cat-income)" : type === "transfer" ? "var(--cat-transport)" : known?.color || "var(--muted)";
  return (
    <span aria-hidden="true" data-category-mark={category || type || "none"} className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}>
      <Icon name={icon} size={18} />
    </span>
  );
}
