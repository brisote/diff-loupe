import type { ReactNode } from "react";
import { Icon } from "../lib/icon";

export function Banner({
  kind,
  icon = kind === "info" ? "status-info" : "status-error",
  children,
  actions,
}: {
  kind: "info" | "error";
  icon?: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="app-editor-notice">
      <div className={`dl-banner is-${kind}`} role="status">
        <Icon name={icon} />
        <span className="dl-banner-text">{children}</span>
        <span className="dl-banner-actions">{actions}</span>
      </div>
    </div>
  );
}

export function Action({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button className="app-link" type="button" onClick={onClick}>
      {children}
    </button>
  );
}
