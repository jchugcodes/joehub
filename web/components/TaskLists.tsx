"use client";

import { useEffect, useState } from "react";
import { LIST_PALETTE, tasksMoveCopy } from "../lib/list-display.mjs";
import { Icon } from "./Icon";
import { ConfirmDialog, OverlayPanel } from "./OverlayPanel";
import { Sheet } from "./Sheet";

export interface TaskList {
  id: string;
  name: string;
  color: string | null;
  createdAt: number;
  updatedAt: number;
  count?: number;
}

export function listAccent(color: string | null) {
  if (!color) return "";
  const slot = LIST_PALETTE.find((item) => item.light.toLowerCase() === color.toLowerCase());
  return slot ? `var(--list-${slot.name.toLowerCase()})` : color;
}

export function Swatch({ color, size = 16 }: { color: string | null; size?: number }) {
  return (
    <span
      aria-hidden="true"
      data-swatch={color ? "fill" : "ring"}
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: color ? listAccent(color) : "transparent",
        boxShadow: color ? undefined : "inset 0 0 0 1.5px var(--subtle-border)",
      }}
    />
  );
}

function Palette({ value, onPick, disabled = false }: { value: string | null; onPick: (color: string) => void; disabled?: boolean }) {
  return (
    <div className="mt-2 grid grid-cols-4 gap-2" role="listbox" aria-label="List color">
      {LIST_PALETTE.map((slot) => {
        const selected = value != null && value.toLowerCase() === slot.light.toLowerCase();
        return (
          <button
            key={slot.name}
            type="button"
            role="option"
            aria-selected={selected}
            aria-label={slot.name}
            className="flex min-h-11 flex-col items-center gap-1 rounded-xl py-1 disabled:opacity-50"
            disabled={disabled}
            onClick={() => {
              if (!disabled) onPick(slot.light);
            }}
          >
            <span
              className="grid h-11 w-11 place-items-center rounded-full"
              style={selected ? { boxShadow: "inset 0 0 0 2px var(--surface), inset 0 0 0 4px var(--ink)" } : undefined}
            >
              <Swatch color={slot.light} size={28} />
            </span>
            <span className="text-meta text-muted">{slot.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function TaskListMenu({
  value,
  label,
  lists,
  legacy,
  open,
  name,
  color,
  colorOpen,
  error,
  onToggle,
  onPick,
  onName,
  onColor,
  onToggleColor,
  onAdd,
  onManage,
}: {
  value: string;
  label: string;
  lists: TaskList[];
  legacy: string[];
  open: boolean;
  name: string;
  color: string;
  colorOpen: boolean;
  error: string;
  onToggle: () => void;
  onPick: (project: string) => void;
  onName: (name: string) => void;
  onColor: (color: string) => void;
  onToggleColor: () => void;
  onAdd: () => void;
  onManage: () => void;
}) {
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    if (!open) setComposing(false);
  }, [open]);
  useEffect(() => {
    if (!composing) return;
    document.getElementById("new-list-name")?.focus();
  }, [composing]);
  return (
    <div>
      <span className="block text-meta font-medium" id="task-project-label">
        List
      </span>
      <button
        id="task-project"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby="task-project-label"
        data-value={value}
        className="mt-1 flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 text-left text-base"
        onClick={onToggle}
      >
        <span className="flex min-w-0 items-center gap-3">
          {value ? <Swatch color={lists.find((list) => list.id === value)?.color || null} /> : null}
          <span className="truncate">{label}</span>
        </span>
        <span aria-hidden="true" className="text-muted">▾</span>
      </button>
      {open ? (
        <div className="mt-2 rounded-xl border border-line bg-surface p-1" role="listbox" aria-label="Lists">
          <button type="button" className="flex min-h-11 w-full items-center px-3 text-left text-body" onClick={() => onPick("")}>
            None
          </button>
          {lists.length === 0 && legacy.length === 0 ? <p className="px-3 py-2 text-body text-muted">No lists yet</p> : null}
          {lists.map((list) => (
            <button key={list.id} type="button" className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-body" onClick={() => onPick(list.id)}>
              <Swatch color={list.color} />
              <span className="min-w-0 flex-1 truncate">{list.name}</span>
              {value === list.id ? <span aria-hidden="true">✓</span> : null}
            </button>
          ))}
          {legacy.map((name) => (
            <button key={name} type="button" className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-body" onClick={() => onPick(name)}>
              <Swatch color={null} />
              <span className="min-w-0 flex-1 truncate">{name}</span>
              {value === name ? <span aria-hidden="true">✓</span> : null}
            </button>
          ))}
          <div className="mt-1 border-t border-line px-2 py-2">
            {composing ? (
              <div className="flex items-center gap-2">
                <button type="button" className="grid h-11 w-11 shrink-0 place-items-center" aria-label="List color" aria-expanded={colorOpen} onClick={onToggleColor}>
                  <Swatch color={color} size={18} />
                </button>
                <input
                  id="new-list-name"
                  value={name}
                  placeholder="List name"
                  inputMode="text"
                  enterKeyHint="done"
                  data-autofocus=""
                  onChange={(event) => onName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (colorOpen) onToggleColor();
                    setComposing(false);
                  }}
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-base"
                  autoComplete="off"
                />
                <button type="button" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-ink px-3 text-body font-medium text-page" onClick={onAdd}>
                  Add
                </button>
              </div>
            ) : (
              <button type="button" className="flex min-h-11 w-full items-center gap-3 px-1 text-left text-body" onClick={() => setComposing(true)}>
                <Icon name="plus" size={16} />
                New list
              </button>
            )}
            {composing && colorOpen ? (
              <>
                <p className="mt-3 px-1 text-meta font-medium">Color</p>
                <Palette value={color} onPick={onColor} />
              </>
            ) : null}
            {error ? <p className="mt-1 px-1 text-meta font-medium text-warn">{error}</p> : null}
          </div>
          <button type="button" className="flex min-h-11 w-full items-center px-3 text-left text-body font-medium" onClick={onManage}>
            Manage lists
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ManageLists({
  lists,
  mode,
  name,
  color,
  error,
  moved,
  wide,
  saving,
  overlay = false,
  offline = false,
  selectedId = "",
  onClose,
  onOpen,
  onName,
  onColor,
  onSave,
  onAskDelete,
  onDelete,
  onBack,
  onNew,
}: {
  lists: TaskList[];
  mode: "home" | "edit" | "delete";
  name: string;
  color: string | null;
  error: string;
  moved: number;
  wide: boolean;
  saving: boolean;
  overlay?: boolean;
  offline?: boolean;
  selectedId?: string;
  onClose: () => void;
  onOpen: (list: TaskList) => void;
  onName: (name: string) => void;
  onColor: (color: string) => void;
  onSave: () => void;
  onAskDelete: () => void;
  onDelete: () => void;
  onBack: () => void;
  onNew: () => void;
}) {
  const homeList = (
    lists.length ? (
      <ul>
        {lists.map((list) => {
          const selected = overlay && mode === "home" && selectedId === list.id;
          return (
            <li key={list.id} className={selected ? "row-selected rounded-2xl" : undefined} aria-current={selected ? "true" : undefined} data-selected={selected ? "true" : undefined}>
              <button
                type="button"
                disabled={offline}
                className="flex min-h-11 w-full items-center gap-3 rounded-2xl px-2 text-left disabled:opacity-50"
                onClick={() => {
                  if (!offline) onOpen(list);
                }}
              >
                <Swatch color={list.color} />
                <span className="min-w-0 flex-1 truncate text-body">{list.name}</span>
                <span className="text-meta text-muted-aa">{list.count || 0}</span>
                <span aria-hidden="true" className="text-muted">›</span>
              </button>
            </li>
          );
        })}
      </ul>
    ) : (
      <div className="px-1 py-8 text-center">
        <p className="text-section font-medium">No lists yet</p>
        <button type="button" disabled={offline} className="mt-6 flex min-h-12 w-full items-center justify-center rounded-xl bg-ink px-4 text-body font-medium text-page disabled:opacity-50" onClick={() => { if (!offline) onNew(); }}>
          New list
        </button>
      </div>
    )
  );
  const editForm = (
    <form
      id="list-edit-form"
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!offline) onSave();
      }}
    >
      <div>
        <label className="block text-meta font-medium" htmlFor="list-name">
          Name
        </label>
        <input
          id="list-name"
          value={name}
          data-autofocus=""
          placeholder="List name"
          inputMode="text"
          enterKeyHint="done"
          disabled={offline}
          onChange={(event) => onName(event.target.value)}
          className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-base outline-none focus:border-2 focus:border-ink disabled:opacity-50"
          autoComplete="off"
        />
      </div>
      {!color ? (
        <div className="flex min-h-11 items-center gap-3" data-list-color="none">
          <Swatch color={null} size={28} />
          <span className="text-body text-muted">No color</span>
        </div>
      ) : null}
      <p className="text-meta font-medium">Color</p>
      <Palette value={color} disabled={offline} onPick={onColor} />
      {error ? <p className="text-meta font-medium text-warn">{error}</p> : null}
      <button type="button" className="flex min-h-11 items-center text-body font-medium text-warn disabled:opacity-50" onClick={() => { if (!offline) onAskDelete(); }} disabled={offline || saving}>
        Delete list
      </button>
    </form>
  );
  if (overlay) {
    const editing = mode === "edit" || mode === "delete";
    return (
      <>
        <OverlayPanel
          wide={wide}
          depth={editing ? 1 : 0}
          title={editing ? "Edit list" : "Lists"}
          onClose={onClose}
          onBack={editing ? onBack : undefined}
          form={editing}
          confirming={mode === "delete"}
          slim={editing}
          sheet={editing}
          action={
            editing ? (
              <button
                type="button"
                disabled={offline || saving}
                className="inline-flex h-11 min-w-11 items-center justify-center bg-transparent p-0 disabled:opacity-50"
                onClick={() => {
                  if (!offline && !saving) onSave();
                }}
              >
                <span className="inline-flex h-8 items-center justify-center rounded-xl bg-ink px-3.5 text-body font-medium text-page">{saving ? "Saving…" : "Save"}</span>
              </button>
            ) : null
          }
        >
          <div className="px-5 py-4">
            {offline ? (
              <p role="status" data-state="offline" className="mb-4 rounded-2xl bg-table-header px-4 py-3 text-left text-body text-ink dark:bg-white/10">
                You are offline.
              </p>
            ) : null}
            {mode === "home" ? homeList : editForm}
          </div>
        </OverlayPanel>
        {mode === "delete" ? (
          <ConfirmDialog
            title="Delete this list?"
            detail={tasksMoveCopy(moved)}
            error={error}
            confirmDisabled={offline || saving}
            onCancel={onBack}
            onConfirm={() => {
              if (!offline) onDelete();
            }}
          />
        ) : null}
      </>
    );
  }
  const title = mode === "delete" ? "Delete list" : mode === "edit" ? "Edit list" : "Lists";
  const formId = mode === "delete" ? "list-delete-form" : mode === "edit" ? "list-edit-form" : undefined;
  return (
    <Sheet
      title={title}
      onClose={mode === "home" ? onClose : onBack}
      frame
      dock={wide ? "panel" : "sheet"}
      header="slim"
      titleClassName="text-section font-medium"
      formId={formId}
      saveLabel={mode === "delete" ? "Delete" : "Save"}
      saveTone={mode === "delete" ? "warn" : "ink"}
      saveDisabled={saving}
      aside={
        wide && mode === "edit" ? (
          <button type="button" className="min-h-11 px-2 text-body font-medium text-warn disabled:opacity-50" onClick={onAskDelete} disabled={saving}>
            Delete
          </button>
        ) : null
      }
      actions={
        wide && formId ? (
          <div className="flex gap-2">
            <button type="button" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-ink px-3 text-body font-medium" onClick={onBack}>
              Cancel
            </button>
            <button
              type="submit"
              form={formId}
              disabled={saving}
              className={`inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-body font-medium disabled:opacity-50 ${mode === "delete" ? "bg-warn text-on-warn" : "bg-ink text-page"}`}
            >
              {mode === "delete" ? "Delete" : "Save"}
            </button>
          </div>
        ) : null
      }
    >
      {mode === "home" ? (
        lists.length ? (
          <ul>
            {lists.map((list) => (
              <li key={list.id}>
                <button type="button" className="flex min-h-11 w-full items-center gap-3 text-left" onClick={() => onOpen(list)}>
                  <Swatch color={list.color} />
                  <span className="min-w-0 flex-1 truncate text-body">{list.name}</span>
                  <span className="text-meta text-muted-aa">{list.count || 0}</span>
                  <span aria-hidden="true" className="text-muted">›</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-1 py-8 text-center">
            <p className="text-section font-medium">No lists yet</p>
            <button type="button" className="mt-6 flex min-h-12 w-full items-center justify-center rounded-xl bg-ink px-4 text-body font-medium text-page" onClick={onNew}>
              New list
            </button>
          </div>
        )
      ) : null}
      {mode === "edit" ? (
        <form id="list-edit-form" className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
          {!wide ? (
            <button type="button" className="flex min-h-11 items-center text-body font-medium text-warn" onClick={onAskDelete}>
              Delete list
            </button>
          ) : null}
          <div>
            <label className="block text-meta font-medium" htmlFor="list-name">
              Name
            </label>
            <input
              id="list-name"
              value={name}
              data-autofocus=""
              placeholder="List name"
              inputMode="text"
              enterKeyHint="done"
              onChange={(event) => onName(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-base outline-none focus:border-2 focus:border-ink"
              autoComplete="off"
            />
          </div>
          {!color ? (
            <div className="flex min-h-11 items-center gap-3" data-list-color="none">
              <Swatch color={null} size={28} />
              <span className="text-body text-muted">No color</span>
            </div>
          ) : null}
          <p className="text-meta font-medium">Color</p>
          <Palette value={color} onPick={onColor} />
          {error ? <p className="text-meta font-medium text-warn">{error}</p> : null}
        </form>
      ) : null}
      {mode === "delete" ? (
        <form id="list-delete-form" onSubmit={(event) => { event.preventDefault(); onDelete(); }}>
          <p className="text-body">{tasksMoveCopy(moved)}</p>
          {error ? <p className="mt-2 text-meta font-medium text-warn">{error}</p> : null}
        </form>
      ) : null}
    </Sheet>
  );
}
