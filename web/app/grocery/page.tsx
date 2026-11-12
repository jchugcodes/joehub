"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { Sheet } from "../../components/Sheet";
import type { GroceryItem } from "../../lib/contract";
import { existingName, groupGrocery, sectionSuggestions } from "../../lib/grocery.mjs";

const CACHE_DB = "joehub-grocery";
const CACHE_STORE = "cache";

type Draft = { name: string; quantity: string; notes: string; section: string };

function emptyDraft(): Draft {
  return { name: "", quantity: "", notes: "", section: "" };
}

function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CACHE_STORE)) request.result.createObjectStore(CACHE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readCache(): Promise<{ savedAt: number; items: GroceryItem[] } | null> {
  try {
    const db = await openCache();
    const row = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(CACHE_STORE, "readonly").objectStore(CACHE_STORE).get("list");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (!row || typeof row !== "object") return null;
    const parsed = row as { savedAt?: unknown; items?: unknown };
    if (typeof parsed.savedAt !== "number" || !Array.isArray(parsed.items)) return null;
    return { savedAt: parsed.savedAt, items: parsed.items as GroceryItem[] };
  } catch {
    return null;
  }
}

async function writeCache(items: GroceryItem[], savedAt: number) {
  try {
    const db = await openCache();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(CACHE_STORE, "readwrite").objectStore(CACHE_STORE).put({ savedAt, items }, "list");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    db.close();
  } catch {
    // A blocked cache still leaves the on-screen list readable.
  }
}

function newKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `key-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function metaLine(item: GroceryItem) {
  const quantity = item.quantity?.trim() || "";
  const section = item.section?.trim() || "";
  if (quantity && section) return `${quantity} · ${section}`;
  return quantity || section;
}

function formatDetroit(ms: number) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(ms);
}

export default function GroceryPage() {
  const [mode, setMode] = useState<"loading" | "ready" | "error">("loading");
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [offline, setOffline] = useState(false);
  const [link, setLink] = useState<"live" | "offline" | "reconnecting" | "back">("live");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [sheet, setSheet] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [nameError, setNameError] = useState("");
  const [quantityError, setQuantityError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [checkNotice, setCheckNotice] = useState(false);
  const [listError, setListError] = useState("");
  const [wide, setWide] = useState(false);
  const downRef = useRef(false);
  const savingRef = useRef(false);
  const idemRef = useRef("");
  const loadGen = useRef(0);

  const showCached = useCallback((snap: { savedAt: number; items: GroceryItem[] } | null) => {
    if (snap) {
      setItems(snap.items);
      setSavedAt(snap.savedAt);
      setMode("ready");
    }
    downRef.current = true;
    setOffline(true);
    setLink("offline");
  }, []);

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    try {
      const response = await fetch("/api/grocery", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as unknown;
      if (!Array.isArray(body)) throw new Error("grocery");
      if (gen !== loadGen.current) return;
      const next = body as GroceryItem[];
      const at = Date.now();
      await writeCache(next, at);
      setItems(next);
      setSavedAt(at);
      const recovered = downRef.current;
      downRef.current = false;
      setOffline(false);
      setLink(recovered ? "back" : "live");
      setMode("ready");
    } catch {
      if (gen !== loadGen.current) return;
      const snap = await readCache();
      showCached(snap);
      if (!snap) setMode("error");
    }
  }, [showCached]);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    const onOffline = () => {
      void readCache().then(showCached);
    };
    const onOnline = () => {
      if (!downRef.current) return;
      setLink("reconnecting");
      void load();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, showCached]);

  useEffect(() => {
    if (!offline) return undefined;
    let stopped = false;
    let timer = 0;
    let delay = 2000;
    const probe = async () => {
      if (stopped) return;
      setLink("reconnecting");
      let reachable = false;
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        reachable = response.ok;
      } catch {
        reachable = false;
      }
      if (stopped) return;
      if (reachable) await load();
      else setLink("offline");
      if (stopped) return;
      timer = window.setTimeout(() => void probe(), delay);
      delay = Math.min(delay * 2, 15000);
    };
    timer = window.setTimeout(() => void probe(), delay);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [offline, load]);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const apply = () => setWide(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (offline) return;
    setCheckNotice(false);
  }, [offline]);

  useEffect(() => {
    if (link !== "back") return undefined;
    const timer = window.setTimeout(() => setLink("live"), 3000);
    return () => window.clearTimeout(timer);
  }, [link]);

  function openAdd() {
    if (offline || mode !== "ready") return;
    idemRef.current = newKey();
    setEditingId(null);
    setConfirmDelete(false);
    setDraft(emptyDraft());
    setNameError("");
    setQuantityError("");
    setFormError("");
    setSheet(true);
  }

  function openEdit(item: GroceryItem) {
    if (offline || mode !== "ready") return;
    setEditingId(item.id);
    setConfirmDelete(false);
    setDraft({
      name: item.name,
      quantity: item.quantity || "",
      notes: item.notes || "",
      section: item.section || "",
    });
    setNameError("");
    setQuantityError("");
    setFormError("");
    setSheet(true);
  }

  function cancel() {
    if (savingRef.current) return;
    setConfirmDelete(false);
    setSheet(false);
    setEditingId(null);
    setNameError("");
    setQuantityError("");
    setFormError("");
    setDraft(emptyDraft());
  }

  useEffect(() => {
    if (!confirmDelete && !confirmClear) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || savingRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      setConfirmDelete(false);
      setConfirmClear(false);
      setFormError("");
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [confirmDelete, confirmClear]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (savingRef.current || offline) return;
    const name = draft.name.trim();
    if (!name) {
      setNameError("Enter a name.");
      setFormError("");
      document.getElementById("grocery-name")?.focus();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setNameError("");
    setQuantityError("");
    setFormError("");
    const editing = editingId;
    const payload: Record<string, string> = editing
      ? { name, quantity: draft.quantity.trim(), notes: draft.notes.trim(), section: draft.section.trim() }
      : { name };
    if (!editing) {
      if (draft.quantity.trim()) payload.quantity = draft.quantity.trim();
      if (draft.notes.trim()) payload.notes = draft.notes.trim();
      if (draft.section.trim()) payload.section = draft.section.trim();
    }
    try {
      const response = await fetch(editing ? `/api/grocery/${editing}` : "/api/grocery", {
        method: editing ? "PATCH" : "POST",
        headers: editing
          ? { "content-type": "application/json" }
          : { "content-type": "application/json", "idempotency-key": idemRef.current },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as { detail?: string; field?: string; id?: string } | null;
      if (response.status === 400 && body?.field === "name") {
        setNameError(body.detail || "Enter a name.");
        document.getElementById("grocery-name")?.focus();
        return;
      }
      if (response.status === 400 && body?.field === "quantity") {
        setQuantityError(body.detail || "Enter a valid quantity.");
        return;
      }
      if (!response.ok || !body || typeof body.id !== "string") {
        setFormError(editing ? "Couldn't save these edits." : "Couldn't save this item.");
        return;
      }
      const item = body as GroceryItem;
      const next = [...items.filter((row) => row.id !== item.id), item];
      setItems(next);
      await writeCache(next, Date.now());
      setSheet(false);
      setEditingId(null);
      setDraft(emptyDraft());
      void load();
    } catch {
      setFormError(editing ? "Couldn't save these edits." : "Couldn't save this item.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function toggle(item: GroceryItem) {
    if (offline || mode !== "ready") {
      setCheckNotice(true);
      return;
    }
    setListError("");
    const path = item.checked ? "uncheck" : "check";
    try {
      const response = await fetch(`/api/grocery/${item.id}/${path}`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as GroceryItem | null;
      if (!response.ok || !body || typeof body.id !== "string") {
        setListError("Couldn't update this item.");
        return;
      }
      const next = items.map((row) => (row.id === body.id ? body : row));
      setItems(next);
      await writeCache(next, Date.now());
    } catch {
      setListError("Couldn't update this item.");
    }
  }

  async function clearChecked() {
    if (savingRef.current || offline) {
      if (offline) setCheckNotice(true);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setFormError("");
    try {
      const response = await fetch("/api/grocery/clear-checked", { method: "POST" });
      const body = (await response.json().catch(() => null)) as { deleted?: number; ids?: string[] } | null;
      if (!response.ok || !body || !Array.isArray(body.ids)) {
        setFormError("Couldn't remove checked items.");
        return;
      }
      const gone = new Set(body.ids);
      const next = items.filter((row) => !gone.has(row.id));
      setItems(next);
      await writeCache(next, Date.now());
      setConfirmClear(false);
      void load();
    } catch {
      setFormError("Couldn't remove checked items.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function removeItem() {
    if (savingRef.current || offline || !editingId) return;
    savingRef.current = true;
    setSaving(true);
    setFormError("");
    const id = editingId;
    try {
      const response = await fetch(`/api/grocery/${id}`, { method: "DELETE" });
      const body = (await response.json().catch(() => null)) as { deleted?: boolean } | null;
      if (!response.ok || !body?.deleted) {
        setFormError("Couldn't delete this item.");
        return;
      }
      const next = items.filter((row) => row.id !== id);
      setItems(next);
      await writeCache(next, Date.now());
      setConfirmDelete(false);
      setSheet(false);
      setEditingId(null);
      setDraft(emptyDraft());
      void load();
    } catch {
      setFormError("Couldn't delete this item.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const groups = useMemo(() => groupGrocery(items) as { label: string; items: GroceryItem[] }[], [items]);
  const sections = useMemo(() => sectionSuggestions(items) as string[], [items]);
  const hint = existingName(items, draft.name, editingId || "");
  const checkedItems = items
    .filter((item) => item.checked)
    .slice()
    .sort((left, right) => (left.checkedAt || left.updatedAt) - (right.checkedAt || right.updatedAt) || left.createdAt - right.createdAt || (left.id < right.id ? -1 : 1));
  const checkedCount = checkedItems.length;
  const checkedNames =
    checkedItems.length <= 1
      ? checkedItems.map((item) => item.name).join("")
      : checkedItems.length === 2
        ? `${checkedItems[0].name} and ${checkedItems[1].name}`
        : `${checkedItems
            .slice(0, -1)
            .map((item) => item.name)
            .join(", ")}, and ${checkedItems[checkedItems.length - 1].name}`;
  const addDisabled = offline || mode !== "ready";
  const saveDisabled = offline || saving;

  const banners = (
    <>
      {link === "offline" && savedAt ? (
        <p role="status" data-offline="true" data-link="offline" className="pointer-events-none mx-4 mt-3 rounded-2xl border border-[#C9CEC8] bg-[#EEF0EC] px-3.5 py-3 text-body font-medium">
          Offline
          <span className="mt-0.5 block text-meta font-normal text-muted">Last updated {formatDetroit(savedAt)}</span>
          <span className="block text-meta font-normal text-muted">America/Detroit</span>
        </p>
      ) : null}
      {link === "reconnecting" ? (
        <p role="status" data-offline="true" data-link="reconnecting" className="pointer-events-none mx-4 mt-3 rounded-2xl border border-[#E9B94933] bg-[#E9B9491F] px-3.5 py-3 text-body font-medium text-[#8A6B14]">
          Reconnecting…
        </p>
      ) : null}
      {link === "back" ? (
        <p role="status" data-link="back" className="pointer-events-none mx-4 mt-3 flex items-center justify-between gap-3 rounded-2xl border border-[#2E8B6A33] bg-[#2E8B6A1F] px-3.5 py-3 text-body font-medium text-[#246C53]">
          <span>Back online</span>
          <button type="button" className="pointer-events-auto min-h-11 px-2 text-meta font-medium text-muted" onClick={() => setLink("live")}>
            Dismiss
          </button>
        </p>
      ) : null}
    </>
  );

  return (
    <div data-ready={mode === "loading" ? undefined : "true"} data-layout={wide ? "panel" : "sheet"} className={`grocery-type ${wide ? "flex min-w-0 items-start gap-6 px-8 pt-4" : "min-w-0"}`}>
      <div className={`relative min-w-0 flex-1 ${wide ? (sheet ? "max-w-[520px] opacity-50" : "max-w-[640px]") : ""}`}>
        <header className={wide ? "" : "px-5 pt-2"}>
          <p className="text-meta text-muted">joehub</p>
          <h1 className="text-title font-medium">Grocery</h1>
        </header>
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20">{banners}</div>
        {checkedCount > 0 ? (
          <div className="relative z-30 mx-4 mt-3 flex items-center justify-between gap-3 rounded-2xl bg-[#E7F2EC] px-3.5 py-2.5">
            <p className="text-body">{checkedCount} checked</p>
            <button
              type="button"
              className="flex min-h-11 items-center justify-center rounded-xl bg-ink px-4 text-body font-medium text-page disabled:opacity-50"
              aria-disabled={offline || undefined}
              onClick={() => {
                if (offline) {
                  setCheckNotice(true);
                  return;
                }
                setFormError("");
                setConfirmClear(true);
              }}
            >
              Remove checked
            </button>
          </div>
        ) : null}
        {checkNotice ? (
          <p role="status" data-check-notice="true" className="relative z-30 mx-4 mt-3 rounded-2xl border border-line bg-surface px-3.5 py-3 text-body">
            Can't check off offline
          </p>
        ) : null}
        {listError ? (
          <p role="alert" className="mx-4 mt-3 text-meta font-medium text-warn">
            {listError}
          </p>
        ) : null}
        {mode === "ready" && items.length === 0 ? (
          <div className="mt-16 flex flex-col items-center px-5 text-center" data-empty="true">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-[var(--table-header)] text-ink" data-empty-icon="true">
              <Icon name="check-square" size={28} />
            </span>
            <p className="mt-4 text-section font-medium">No items</p>
            <button
              type="button"
              className="mt-6 flex min-h-12 w-full items-center justify-center rounded-xl bg-ink px-4 text-body font-medium text-page disabled:opacity-50"
              onClick={openAdd}
              disabled={addDisabled}
            >
              Add an item
            </button>
          </div>
        ) : null}
        {mode === "ready" && items.length > 0 ? (
          <div>
            {groups.map((group) => (
              <section key={group.label} aria-label={group.label}>
                <h2 className="mt-4 flex items-baseline justify-between px-5 text-section font-medium">
                  <span>{group.label}</span>
                  <span className="text-meta font-normal text-muted">{group.items.length}</span>
                </h2>
                <ul className="mt-2 space-y-2 px-4">
                  {group.items.map((item: GroceryItem) => {
                    const meta = metaLine(item);
                    return (
                      <li key={item.id} className="card flex min-w-0 items-center">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={item.checked ? "true" : "false"}
                          aria-label={item.checked ? `Uncheck ${item.name}` : `Check ${item.name}`}
                          className="grid h-11 w-11 shrink-0 place-items-center"
                          onClick={() => void toggle(item)}
                        >
                          {item.checked ? (
                            <span className="grid h-6 w-6 place-items-center rounded-full bg-gain text-on-gain" aria-hidden="true">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <path d="M5 12.5 10 17.5 19 7.5" />
                              </svg>
                            </span>
                          ) : (
                            <span className="h-6 w-6 rounded-full border border-subtle-border" aria-hidden="true" />
                          )}
                        </button>
                        <button
                          type="button"
                          data-item-id={item.id}
                          className="min-h-11 min-w-0 flex-1 py-3.5 pr-3.5 text-left disabled:opacity-60"
                          aria-label={`Edit ${item.name}`}
                          disabled={offline}
                          onClick={() => openEdit(item)}
                        >
                          <p className={`break-words text-body font-medium ${item.checked ? "text-muted line-through" : ""}`}>{item.name}</p>
                          {meta ? <p className="mt-1 break-words text-meta text-muted">{meta}</p> : null}
                          {item.notes ? <p className="mt-1 break-words text-meta text-muted">{item.notes}</p> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {wide ? (
              <button
                type="button"
                className="ml-4 mt-4 flex min-h-12 max-w-[200px] items-center justify-center rounded-xl bg-ink px-4 text-body font-medium text-page disabled:opacity-50"
                onClick={openAdd}
                disabled={addDisabled}
              >
                Add an item
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {wide && !sheet ? (
        <aside className="card h-fit w-[400px] shrink-0 p-5">
          <h2 className="text-section font-medium">Select an item</h2>
        </aside>
      ) : null}
      {!wide && items.length > 0 ? (
        <button
          type="button"
          aria-label="Add an item"
          className="fixed bottom-[100px] right-5 z-20 grid h-14 w-14 place-items-center rounded-full bg-ink text-page shadow-xl disabled:opacity-50"
          onClick={openAdd}
          disabled={addDisabled}
        >
          <Icon name="plus" size={24} strokeWidth={2.2} />
        </button>
      ) : null}
      {sheet ? (
        <Sheet
          title={editingId ? "Edit item" : "Add an item"}
          onClose={cancel}
          frame
          dock={wide ? "panel" : "sheet"}
          titleClassName="text-section font-medium"
          header="slim"
          formId="grocery-form"
          saveLabel="Save"
          saveDisabled={saveDisabled}
          aside={
            wide && editingId ? (
              <button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-body font-medium text-warn disabled:opacity-50" onClick={() => setConfirmDelete(true)} disabled={offline || saving}>
                Delete
              </button>
            ) : null
          }
        >
          <form id="grocery-form" className="space-y-5" onSubmit={save}>
            {editingId && !wide ? (
              <button type="button" className="flex min-h-11 min-w-11 items-center text-body font-medium text-warn disabled:opacity-50" onClick={() => setConfirmDelete(true)} disabled={offline || saving}>
                Delete
              </button>
            ) : null}
            <div>
              <label className="block text-meta font-normal text-muted" htmlFor="grocery-name">
                Name
              </label>
              <input
                id="grocery-name"
                value={draft.name}
                data-autofocus=""
                aria-required="true"
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? "grocery-name-error" : hint ? "grocery-duplicate" : undefined}
                placeholder="What do you need?"
                inputMode="text"
                enterKeyHint="next"
                onBlur={() => {
                  if (!draft.name.trim()) setNameError("Enter a name.");
                }}
                onChange={(event) => {
                  setDraft({ ...draft, name: event.target.value });
                  if (nameError) setNameError("");
                }}
                className={`mt-1.5 min-h-11 w-full min-w-0 rounded-xl border-2 bg-surface px-3.5 py-3 text-base ${nameError ? "border-[var(--warn)]" : "border-ink"}`}
                autoComplete="off"
              />
              {nameError ? <p id="grocery-name-error" role="alert" className="mt-1.5 text-meta font-medium text-[var(--warn)]">{nameError}</p> : null}
              {hint ? <p id="grocery-duplicate" className="mt-1.5 text-meta text-muted">{hint} is already on the list</p> : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <label className="block text-meta font-normal text-muted" htmlFor="grocery-quantity">
                  Quantity
                </label>
                <input
                  id="grocery-quantity"
                  value={draft.quantity}
                  inputMode="numeric"
                  enterKeyHint="next"
                  aria-invalid={quantityError ? true : undefined}
                  aria-describedby={quantityError ? "grocery-quantity-error" : undefined}
                  onChange={(event) => {
                    setDraft({ ...draft, quantity: event.target.value });
                    if (quantityError) setQuantityError("");
                  }}
                  className={`mt-1 min-h-11 w-full min-w-0 rounded-xl border bg-surface px-3 py-2.5 text-base ${quantityError ? "border-[var(--warn)]" : "border-line"}`}
                  autoComplete="off"
                />
              </div>
              <div className="min-w-0">
                <label className="block text-meta font-normal text-muted" htmlFor="grocery-section">
                  Section
                </label>
                <select
                  id="grocery-section"
                  value={sections.includes(draft.section) || draft.section === "" ? draft.section : draft.section}
                  onChange={(event) => setDraft({ ...draft, section: event.target.value })}
                  className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2.5 text-base"
                >
                  <option value="">None</option>
                  {sections.map((section) => (
                    <option key={section} value={section}>
                      {section}
                    </option>
                  ))}
                  {draft.section && !sections.includes(draft.section) ? <option value={draft.section}>{draft.section}</option> : null}
                </select>
              </div>
            </div>
            {quantityError ? <p id="grocery-quantity-error" role="alert" className="text-meta font-medium text-[var(--warn)]">{quantityError}</p> : null}
            <div>
              <label className="block text-meta font-normal text-muted" htmlFor="grocery-notes">
                Notes
              </label>
              <textarea
                id="grocery-notes"
                value={draft.notes}
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                rows={2}
                enterKeyHint="done"
                className="mt-1.5 min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 py-3 text-base"
              />
            </div>
            {formError ? (
              <p role="alert" className="text-meta font-medium text-[var(--warn)]">
                {formError}
              </p>
            ) : null}
          </form>
        </Sheet>
      ) : null}
      {confirmClear ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 pb-[calc(var(--primary-nav-height,84px)+16px)] sm:items-center sm:pb-4">
          <div role="alertdialog" aria-modal="true" aria-labelledby="grocery-clear-title" id="grocery-clear-dialog" className="w-full max-w-[360px] rounded-[20px] bg-surface p-5 shadow-2xl">
            <h2 id="grocery-clear-title" className="text-section font-medium">Remove {checkedCount} checked {checkedCount === 1 ? "item" : "items"}?</h2>
            <p className="mt-2 text-body text-muted">{checkedNames}. This can't be undone.</p>
            {formError ? <p role="alert" className="mt-3 text-meta font-medium text-[var(--warn)]">{formError}</p> : null}
            <button type="button" className="mt-5 flex min-h-12 w-full items-center justify-center rounded-xl bg-warn px-4 text-body font-medium text-on-warn disabled:opacity-50" onClick={() => void clearChecked()} disabled={offline || saving}>
              Remove checked
            </button>
            <button type="button" className="mt-2 flex min-h-12 w-full items-center justify-center rounded-xl border border-[#C9CEC8] bg-surface px-4 text-body font-medium" onClick={() => { setConfirmClear(false); setFormError(""); }}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {confirmDelete ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 pb-[calc(var(--primary-nav-height,84px)+16px)] sm:items-center sm:pb-4">
          <div role="alertdialog" aria-modal="true" aria-labelledby="grocery-delete-title" id="grocery-delete-dialog" className="w-full max-w-[360px] rounded-[20px] bg-surface p-5 shadow-2xl">
            <h2 id="grocery-delete-title" className="text-section font-medium">Delete this item?</h2>
            <p className="mt-2 break-words text-body">{draft.name.trim()}</p>
            <p className="mt-2 text-body text-muted">This can't be undone.</p>
            {formError ? <p role="alert" className="mt-3 text-meta font-medium text-[var(--warn)]">{formError}</p> : null}
            <button type="button" className="mt-5 flex min-h-12 w-full items-center justify-center rounded-xl bg-warn px-4 text-body font-medium text-on-warn disabled:opacity-50" onClick={() => void removeItem()} disabled={offline || saving}>
              Delete
            </button>
            <button type="button" className="mt-2 flex min-h-12 w-full items-center justify-center rounded-xl border border-[#C9CEC8] bg-surface px-4 text-body font-medium" onClick={() => { setConfirmDelete(false); setFormError(""); }}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
