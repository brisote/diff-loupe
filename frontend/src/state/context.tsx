import { createContext, type ReactNode, useContext } from "react";
import { useStore } from "zustand";
import type { AppState, AppStore } from "./store";

const StoreContext = createContext<AppStore | null>(null);

export function StoreProvider({ store, children }: { store: AppStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useApp<T>(selector: (state: AppState) => T): T {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useApp needs a StoreProvider");
  return useStore(store, selector);
}
