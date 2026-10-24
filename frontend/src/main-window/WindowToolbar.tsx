import type { ReactNode } from "react";
import { useApp } from "../state/context";

export function WindowToolbar({ children }: { children?: ReactNode }) {
  const native = useApp((state) => state.backend.kind === "tauri");
  return (
    <header className="dl-toolbar app-toolbar" data-tauri-drag-region="deep">
      <div className={`app-lights ${native ? "is-native" : ""}`} aria-hidden="true">
        <span className="is-close" />
        <span className="is-minimize" />
        <span className="is-zoom" />
      </div>
      {children}
    </header>
  );
}
