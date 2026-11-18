"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSkeletonGate, readSkeletonHold } from "../lib/skeleton-gate.mjs";
import { LoadError } from "./Skeleton";

export function useSkeletonPhase(enabled: boolean, hold: string, pending: boolean, cached: boolean) {
  const [phase, setPhase] = useState(enabled ? "idle" : "ready");
  const [refreshing, setRefreshing] = useState(false);
  const gateRef = useRef<ReturnType<typeof createSkeletonGate> | null>(null);
  const pendingRef = useRef(pending);
  const cachedRef = useRef(cached);
  pendingRef.current = pending;
  cachedRef.current = cached;

  useEffect(() => {
    if (!enabled) {
      setPhase("ready");
      setRefreshing(false);
      return;
    }
    const gate = createSkeletonGate();
    gateRef.current = gate;
    const unsub = gate.subscribe((snap: { phase: string }) => setPhase(snap.phase));
    if (hold === "skel") gate.force("skeleton");
    else if (hold === "error") gate.force("error");
    else if (hold === "empty" || hold === "refresh" || cachedRef.current || !pendingRef.current) gate.start({ cached: true });
    else gate.start();
    return () => {
      unsub();
      gate.stop();
      if (gateRef.current === gate) gateRef.current = null;
    };
  }, [enabled, hold]);

  useEffect(() => {
    if (!enabled) return;
    if (hold === "refresh") {
      setRefreshing(true);
      return;
    }
    setRefreshing(Boolean(cached && pending && hold !== "skel" && hold !== "error" && hold !== "empty"));
    if (!hold && !pending) gateRef.current?.resolve();
  }, [enabled, hold, pending, cached]);

  return { phase: enabled ? phase : "ready", refreshing: enabled && (hold === "refresh" || refreshing) };
}

export function HomeRetry() {
  const router = useRouter();
  return <LoadError onRetry={() => router.refresh()} />;
}
