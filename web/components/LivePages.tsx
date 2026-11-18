"use client";

import { createContext, useContext } from "react";

const LivePagesContext = createContext(false);
const SkeletonContext = createContext(false);
const SkeletonHoldContext = createContext(false);

export function LivePagesProvider({
  production,
  skeletons = false,
  holds = false,
  children,
}: {
  production: boolean;
  skeletons?: boolean;
  holds?: boolean;
  children: React.ReactNode;
}) {
  return (
    <LivePagesContext.Provider value={production}>
      <SkeletonContext.Provider value={skeletons}>
        <SkeletonHoldContext.Provider value={holds}>{children}</SkeletonHoldContext.Provider>
      </SkeletonContext.Provider>
    </LivePagesContext.Provider>
  );
}

export function useProductionNav() {
  return useContext(LivePagesContext);
}

export function useSkeletons() {
  return useContext(SkeletonContext);
}

export function useSkeletonHolds() {
  return useContext(SkeletonHoldContext);
}
