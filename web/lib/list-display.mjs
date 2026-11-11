/** Client-safe list display helpers. Keep crypto and storage out of this file. */

export const LIST_PALETTE = [
  { name: "Teal", light: "#227777", dark: "#4ABABA" },
  { name: "Indigo", light: "#5B45B5", dark: "#9789D2" },
  { name: "Violet", light: "#8445B5", dark: "#AD81CF" },
  { name: "Berry", light: "#B54588", dark: "#CD7AAB" },
  { name: "Olive", light: "#5D7728", dark: "#94B450" },
  { name: "Ochre", light: "#866C27", dark: "#C69E39" },
  { name: "Plum", light: "#AE3DB8", dark: "#C871D0" },
  { name: "Azure", light: "#3075A6", dark: "#5190BD" },
];

export function nextPaletteColor(lists) {
  const used = new Set((Array.isArray(lists) ? lists : []).map((list) => String(list && list.color ? list.color : "").toLowerCase()));
  const slot = LIST_PALETTE.find((item) => !used.has(item.light.toLowerCase()));
  return (slot || LIST_PALETTE[0]).light;
}

export function resolveTaskList(project, lists) {
  if (project == null || String(project).trim() === "") return { label: "No list", color: null, id: null };
  const value = String(project);
  const found = (Array.isArray(lists) ? lists : []).find((list) => list && list.id === value);
  if (found) return { label: found.name, color: found.color || null, id: found.id };
  return { label: value, color: null, id: null };
}
