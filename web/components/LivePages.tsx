"use client";

import { createContext, useContext } from "react";

const LivePagesContext = createContext(false);

export function LivePagesProvider({ production, children }: { production: boolean; children: React.ReactNode }) {
  return <LivePagesContext.Provider value={production}>{children}</LivePagesContext.Provider>;
}

export function useProductionNav() {
  return useContext(LivePagesContext);
}
