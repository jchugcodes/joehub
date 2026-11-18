"use client";

import { createContext, useContext } from "react";

const LivePagesContext = createContext(false);
const SkeletonContext = createContext(false);
const SkeletonHoldContext = createContext(false);
const OverlayContext = createContext(false);
const OverlayHoldContext = createContext(false);

export function LivePagesProvider({
  production,
  skeletons = false,
  holds = false,
  overlays = false,
  overlayHolds = false,
  children,
}: {
  production: boolean;
  skeletons?: boolean;
  holds?: boolean;
  overlays?: boolean;
  overlayHolds?: boolean;
  children: React.ReactNode;
}) {
  return (
    <LivePagesContext.Provider value={production}>
      <SkeletonContext.Provider value={skeletons}>
        <SkeletonHoldContext.Provider value={holds}>
          <OverlayContext.Provider value={overlays}>
            <OverlayHoldContext.Provider value={overlayHolds}>{children}</OverlayHoldContext.Provider>
          </OverlayContext.Provider>
        </SkeletonHoldContext.Provider>
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

export function useOverlays() {
  return useContext(OverlayContext);
}

export function useOverlayHolds() {
  return useContext(OverlayHoldContext);
}
