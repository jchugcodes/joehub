"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon } from "../../../../components/Icon";
import { jobDetail } from "../../../../lib/design-fixtures";

const DEMO = "Demo only. Nothing was saved.";
const STAGES = ["Saved", "Applied", "Interviewing", "Offer"] as const;

type Stage = (typeof STAGES)[number];

export default function StagePage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const titleId = useId();
  const changeRef = useRef<HTMLButtonElement>(null);
  const appliedRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(search.get("sheet") === "open");
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<Stage>("Interviewing");
  const [radioFocus, setRadioFocus] = useState<Stage>("Applied");
  const [shown, setShown] = useState<Stage>(search.get("notice") === "saved" ? "Interviewing" : "Applied");
  const [failed, setFailed] = useState(search.get("notice") === "failed");
  const [notice, setNotice] = useState(search.get("notice") === "saved" || search.get("notice") === "failed" ? DEMO : "");
  const timerRef = useRef<number | null>(null);
  const saveEpoch = useRef(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function cancelPending() {
    saveEpoch.current += 1;
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function closeSheet() {
    cancelPending();
    setOpen(false);
    setPending(false);
  }

  function save() {
    if (pending) return;
    const stage = selected;
    const epoch = saveEpoch.current + 1;
    saveEpoch.current = epoch;
    setPending(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (saveEpoch.current !== epoch) return;
      setPending(false);
      setFailed(false);
      setShown(stage);
      setNotice(DEMO);
      setOpen(false);
    }, 300);
  }

  const closeSheetRef = useRef(closeSheet);
  closeSheetRef.current = closeSheet;

  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    appliedRef.current?.focus();
    const focusable = () =>
      [...(node?.querySelectorAll<HTMLElement>("button, a[href], input, textarea") ?? [])].filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
      );
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSheetRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      changeRef.current?.focus();
    };
  }, [open]);

  if (params.id !== jobDetail.id) {
    return (
      <div className="px-5" data-ready={mounted ? "true" : "false"}>
        <Link href="/jobs" className="inline-flex min-h-11 items-center gap-2 font-semibold">
          <Icon name="back" size={22} /> Back to pipeline
        </Link>
        <h1 className="mt-4 text-ui-22 font-bold">No stage screen for this role</h1>
      </div>
    );
  }

  function undo() {
    setShown("Applied");
    setNotice(DEMO);
    changeRef.current?.focus();
  }

  function retry() {
    setFailed(false);
    setSelected("Interviewing");
    setRadioFocus("Applied");
    setNotice(DEMO);
    setOpen(true);
  }

  function onRadioKey(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const delta = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
    const next = STAGES[(index + delta + STAGES.length) % STAGES.length];
    setSelected(next);
    setRadioFocus(next);
    const group = event.currentTarget.parentElement;
    const buttons = group ? [...group.querySelectorAll<HTMLButtonElement>("[role='radio']")] : [];
    buttons[STAGES.indexOf(next)]?.focus();
  }

  return (
    <div className="min-w-0" data-ready={mounted ? "true" : "false"}>
      <header className="flex items-center gap-3 px-5">
        <Link href="/jobs/globex" className="grid h-11 w-11 place-items-center" aria-label="Back to job">
          <Icon name="back" size={22} />
        </Link>
        <div>
          <p className="text-ui-13 text-muted">Jobs</p>
          <h1 className="text-ui-22 font-bold">Globex</h1>
        </div>
      </header>
      <p className="mt-3 px-5 text-ui-20 font-bold">{jobDetail.title}</p>
      <section className="card mx-4 mt-4 p-4">
        <div className="flex items-center justify-between gap-4 border-b border-line py-3 text-ui-14">
          <span className="text-muted">Current stage</span>
          <span className="text-right font-semibold">{shown}</span>
        </div>
        <p className="mt-3 text-ui-13 text-muted">
          {shown === "Interviewing" ? "Stage saved. Your notes and next-step date are unchanged." : "Choose a stage when your application moves forward."}
        </p>
        <button
          ref={changeRef}
          type="button"
          className="mt-4 flex min-h-11 w-full items-center justify-center rounded-xl bg-support-linkBlue px-4 text-ui-14 font-bold text-white"
          onClick={() => {
            setSelected("Interviewing");
            setRadioFocus("Applied");
            setOpen(true);
          }}
        >
          Change stage
        </button>
      </section>
      {shown === "Interviewing" ? (
        <div className="card mx-4 mt-4 flex items-center justify-between p-4">
          <span className="text-ui-13">Moved to Interviewing</span>
          <button type="button" className="min-h-11 px-2 text-ui-14 font-semibold text-support-linkBlue" onClick={undo}>
            Undo
          </button>
        </div>
      ) : null}
      {failed ? (
        <section className="card mx-4 mt-4 p-4" role="alert">
          <h2 className="text-ui-16 font-bold">Stage wasn’t saved</h2>
          <p className="mt-2 text-ui-14 text-muted">Still Applied. Your notes are safe.</p>
          <button
            type="button"
            className="mt-4 flex min-h-11 w-full items-center justify-center rounded-xl bg-support-linkBlue px-4 text-ui-14 font-bold text-white"
            onClick={retry}
          >
            Retry stage change
          </button>
        </section>
      ) : null}
      {notice ? (
        <p className="mx-5 mt-4 text-ui-13 font-semibold text-support-linkBlue" role="status">
          {notice}
        </p>
      ) : null}
      <p className="mb-4 mt-6 text-center text-ui-10 text-muted">SYNTHETIC DATA · design reference</p>
      {open ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onMouseDown={(event) => event.target === event.currentTarget && closeSheet()}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            ref={dialogRef}
            className="max-h-[90vh] w-full max-w-phone overflow-y-auto rounded-t-[28px] bg-white p-5"
          >
            <div className="mx-auto h-1.5 w-10 rounded-full bg-support-handle" />
            <div className="mt-4 flex items-center justify-between">
              <h2 id={titleId} className="text-ui-20 font-bold">
                Move to stage
              </h2>
              <button type="button" className="grid h-11 w-11 place-items-center" aria-label="Close stage sheet" onClick={closeSheet}>
                <Icon name="close" size={22} />
              </button>
            </div>
            <p className="mt-2 text-ui-13 text-muted">Globex · currently {shown}</p>
            <div role="radiogroup" aria-label="Stage" className="mt-4">
              {STAGES.map((stage, index) => (
                <button
                  key={stage}
                  ref={stage === "Applied" ? appliedRef : undefined}
                  type="button"
                  role="radio"
                  aria-checked={selected === stage}
                  tabIndex={radioFocus === stage ? 0 : -1}
                  className="flex min-h-11 w-full items-center justify-between border-b border-line py-3 text-left text-ui-15"
                  onClick={() => {
                    setSelected(stage);
                    setRadioFocus(stage);
                  }}
                  onKeyDown={(event) => onRadioKey(event, index)}
                >
                  <span>{stage}</span>
                  {selected === stage ? <Icon name="check" size={20} className="text-jobs" /> : null}
                </button>
              ))}
            </div>
            <div className="mt-5 space-y-2">
              <button
                type="button"
                className="flex min-h-11 w-full items-center justify-center rounded-xl bg-support-linkBlue px-4 text-ui-14 font-bold text-white disabled:opacity-60"
                onClick={save}
                disabled={pending}
              >
                {pending ? "Saving…" : "Save stage"}
              </button>
              <button
                type="button"
                className="flex min-h-11 w-full items-center justify-center rounded-xl border border-support-linkBlue px-4 text-ui-14 font-bold text-support-linkBlue"
                onClick={closeSheet}
                disabled={pending}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
