"use client";

import { createContext, useContext } from "react";

const LivePagesContext = createContext(false);
const SkeletonContext = createContext(false);

export function LivePagesProvider({ production, skeletons = false, children }: { production: boolean; skeletons?: boolean; children: React.ReactNode }) {
  return (
    <LivePagesContext.Provider value={production}>
      <SkeletonContext.Provider value={skeletons}>{children}</SkeletonContext.Provider>
    </LivePagesContext.Provider>
  );
}

export function useProductionNav() {
  return useContext(LivePagesContext);
}

export function useSkeletons() {
  return useContext(SkeletonContext);
}
