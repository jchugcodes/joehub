"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { Sheet } from "../../components/Sheet";
import type { GroceryItem } from "../../lib/contract";
import { existingName, groupGrocery } from "../../lib/grocery.mjs";

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
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [nameError, setNameError] = useState("");
  const [quantityError, setQuantityError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
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
    if (link !== "back") return undefined;
    const timer = window.setTimeout(() => setLink("live"), 3000);
    return () => window.clearTimeout(timer);
  }, [link]);

  function openAdd() {
    if (offline || mode !== "ready") return;
    idemRef.current = newKey();
    setDraft(emptyDraft());
    setNameError("");
    setQuantityError("");
    setFormError("");
    setSheet(true);
  }

  function cancel() {
    if (savingRef.current) return;
    setSheet(false);
    setNameError("");
    setQuantityError("");
    setFormError("");
    setDraft(emptyDraft());
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (savingRef.current || offline) return;
    const name = draft.name.trim();
    if (!name) {
      setNameError("Enter a name.");
      setFormError("");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setNameError("");
    setQuantityError("");
    setFormError("");
    const payload: Record<string, string> = { name };
    if (draft.quantity.trim()) payload.quantity = draft.quantity.trim();
    if (draft.notes.trim()) payload.notes = draft.notes.trim();
    if (draft.section.trim()) payload.section = draft.section.trim();
    try {
      const response = await fetch("/api/grocery", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idemRef.current },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as { detail?: string; field?: string; id?: string } | null;
      if (response.status === 400 && body?.field === "name") {
        setNameError(body.detail || "Enter a name.");
        return;
      }
      if (response.status === 400 && body?.field === "quantity") {
        setQuantityError(body.detail || "Enter a valid quantity.");
        return;
      }
      if (!response.ok || !body || typeof body.id !== "string") {
        setFormError("Couldn't save this item.");
        return;
      }
      const item = body as GroceryItem;
      const next = [...items.filter((row) => row.id !== item.id), item];
      setItems(next);
      await writeCache(next, Date.now());
      setSheet(false);
      setDraft(emptyDraft());
      void load();
    } catch {
      setFormError("Couldn't save this item.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const groups = useMemo(() => groupGrocery(items) as { label: string; items: GroceryItem[] }[], [items]);
  const sections = useMemo(() => {
    const seen = new Map<string, number>();
    for (const item of items) {
      const section = item.section?.trim();
      if (!section) continue;
      const at = seen.get(section);
      if (at == null || item.createdAt < at) seen.set(section, item.createdAt);
    }
    return [...seen.entries()].sort((left, right) => left[1] - right[1] || (left[0] < right[0] ? -1 : 1)).map(([label]) => label);
  }, [items]);
  const hint = existingName(items, draft.name);
  const addDisabled = offline || mode !== "ready";
  const saveDisabled = offline || saving || !draft.name.trim();

  const banners = (
    <>
      {link === "offline" && savedAt ? (
        <p role="status" data-offline="true" data-link="offline" className="mx-4 mt-3 rounded-2xl border border-[#C9CEC8] bg-[#EEF0EC] px-3.5 py-3 text-body font-medium">
          Offline
          <span className="mt-0.5 block text-meta font-normal text-muted">Last updated {formatDetroit(savedAt)}</span>
          <span className="block text-meta font-normal text-muted">America/Detroit</span>
        </p>
      ) : null}
      {link === "reconnecting" ? (
        <p role="status" data-offline="true" data-link="reconnecting" className="mx-4 mt-3 rounded-2xl border border-[#E9B94933] bg-[#E9B9491F] px-3.5 py-3 text-body font-medium text-[#8A6B14]">
          Reconnecting…
        </p>
      ) : null}
      {link === "back" ? (
        <p role="status" data-link="back" className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-2xl border border-[#2E8B6A33] bg-[#2E8B6A1F] px-3.5 py-3 text-body font-medium text-[#246C53]">
          <span>Back online</span>
          <button type="button" className="min-h-11 px-2 text-meta font-medium text-muted" onClick={() => setLink("live")}>
            Dismiss
          </button>
        </p>
      ) : null}
    </>
  );

  return (
    <div data-ready={mode === "loading" ? undefined : "true"} data-layout={wide ? "panel" : "sheet"} className={`grocery-type ${wide ? "flex min-w-0 items-start gap-6 px-8 pt-4" : "min-w-0"}`}>
      <div className={`min-w-0 flex-1 ${wide ? (sheet ? "max-w-[520px] opacity-50" : "max-w-[640px]") : ""}`}>
        <header className={wide ? "" : "px-5 pt-2"}>
          <p className="text-meta text-muted">joehub</p>
          <h1 className="text-page font-medium">Grocery</h1>
        </header>
        {banners}
        {mode === "ready" && items.length === 0 ? (
          <div className="mt-16 flex flex-col items-center px-5 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-full bg-ink/[0.12]" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M6 7h15l-1.5 9H8L6 7z" />
                <path d="M6 7L5 3H2" />
                <circle cx="9" cy="20" r="1.5" />
                <circle cx="18" cy="20" r="1.5" />
              </svg>
            </div>
            <p className="mt-4 text-section font-medium">The list is empty</p>
            <button
              type="button"
              className="mt-6 flex min-h-12 w-full max-w-[280px] items-center justify-center rounded-xl bg-ink px-4 text-body font-medium text-white disabled:opacity-50"
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
                      <li key={item.id} className="card min-w-0 p-3.5">
                        <p className="break-words text-body font-medium">{item.name}</p>
                        {meta ? <p className="mt-1 break-words text-meta text-muted">{meta}</p> : null}
                        {item.notes ? <p className="mt-1 break-words text-meta text-muted">{item.notes}</p> : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {wide ? (
              <button
                type="button"
                className="ml-4 mt-4 flex min-h-12 max-w-[200px] items-center justify-center rounded-xl bg-ink px-4 text-body font-medium text-white disabled:opacity-50"
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
          className="fixed bottom-[100px] right-5 z-20 grid h-14 w-14 place-items-center rounded-full bg-ink text-white shadow-xl disabled:opacity-50"
          onClick={openAdd}
          disabled={addDisabled}
        >
          <Icon name="plus" size={24} strokeWidth={2.2} />
        </button>
      ) : null}
      {sheet ? (
        <Sheet
          title="Add an item"
          onClose={cancel}
          frame
          dock={wide ? "panel" : "sheet"}
          titleClassName="text-section font-medium"
          actions={
            wide ? (
              <div className="flex gap-2">
                <button type="button" className="flex min-h-10 items-center justify-center rounded-xl border border-ink px-3 text-body font-medium" onClick={cancel}>
                  Cancel
                </button>
                <button
                  type="submit"
                  form="grocery-form"
                  className="flex min-h-10 items-center justify-center rounded-xl bg-ink px-4 text-body font-medium text-white disabled:opacity-50"
                  disabled={saveDisabled}
                >
                  Save
                </button>
              </div>
            ) : null
          }
        >
          <form id="grocery-form" className={wide ? "" : "mt-4"} onSubmit={save}>
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
              onBlur={() => {
                if (!draft.name.trim()) setNameError("Enter a name.");
              }}
              onChange={(event) => {
                setDraft({ ...draft, name: event.target.value });
                if (nameError) setNameError("");
              }}
              className={`mt-1.5 w-full min-w-0 rounded-xl border-2 bg-surface px-3.5 py-3 text-body ${nameError ? "border-[#E07A5F]" : "border-ink"}`}
              autoComplete="off"
            />
            {nameError ? <p id="grocery-name-error" role="alert" className="mt-1.5 text-meta font-medium text-[#E07A5F]">{nameError}</p> : null}
            {hint ? <p id="grocery-duplicate" className="mt-1.5 text-meta text-muted">{hint} is already on the list</p> : null}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <label className="block text-meta font-normal text-muted" htmlFor="grocery-quantity">
                  Quantity
                </label>
                <input
                  id="grocery-quantity"
                  value={draft.quantity}
                  aria-invalid={quantityError ? true : undefined}
                  aria-describedby={quantityError ? "grocery-quantity-error" : undefined}
                  onChange={(event) => {
                    setDraft({ ...draft, quantity: event.target.value });
                    if (quantityError) setQuantityError("");
                  }}
                  className={`mt-1 w-full min-w-0 rounded-xl border bg-surface px-3 py-2.5 text-body ${quantityError ? "border-[#E07A5F]" : "border-line"}`}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-meta font-normal text-muted" htmlFor="grocery-section">
                  Section
                </label>
                <input
                  id="grocery-section"
                  value={draft.section}
                  list="grocery-sections"
                  onChange={(event) => setDraft({ ...draft, section: event.target.value })}
                  className="mt-1 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2.5 text-body"
                  autoComplete="off"
                />
                <datalist id="grocery-sections">
                  {sections.map((section) => (
                    <option key={section} value={section} />
                  ))}
                </datalist>
              </div>
            </div>
            {quantityError ? <p id="grocery-quantity-error" role="alert" className="mt-1.5 text-meta font-medium text-[#E07A5F]">{quantityError}</p> : null}
            <label className="mt-3 block text-meta font-normal text-muted" htmlFor="grocery-notes">
              Notes
            </label>
            <textarea
              id="grocery-notes"
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              rows={2}
              className="mt-1.5 w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 py-3 text-body"
            />
            {formError ? (
              <p role="alert" className="mt-3 text-meta font-medium text-[#E07A5F]">
                {formError}
              </p>
            ) : null}
            {wide ? null : (
              <div className="sticky bottom-0 z-10 mt-5 flex gap-2.5 bg-surface pt-3 pb-[calc(var(--primary-nav-height,84px)+12px)]">
                <button type="button" className="flex min-h-12 flex-1 items-center justify-center rounded-xl border border-[#C9CEC8] bg-surface px-4 text-body font-medium" onClick={cancel}>
                  Cancel
                </button>
                <button type="submit" className="flex min-h-12 flex-1 items-center justify-center rounded-xl bg-ink px-4 text-body font-medium text-white disabled:opacity-50" disabled={saveDisabled}>
                  Save
                </button>
              </div>
            )}
          </form>
        </Sheet>
      ) : null}
    </div>
  );
}
