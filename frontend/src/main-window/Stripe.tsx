import { Icon } from "../lib/icon";
import { shortcut, usePlatform } from "../lib/platform";
import { useApp } from "../state/context";

export function Stripe() {
  const platform = usePlatform();
  const workspaceMode = useApp((state) => state.workspaceMode);
  const setWorkspaceMode = useApp((state) => state.setWorkspaceMode);
  const terminalOpen = useApp((state) => state.terminalOpen);
  const toggleTerminal = useApp((state) => state.toggleTerminal);
  return (
    <nav className="app-stripe" aria-label="Tool windows">
      <button
        className={`dl-tbtn app-stripe-button ${workspaceMode === "manual" ? "is-toggled" : ""}`}
        type="button"
        title="Manual review"
        aria-label="Manual review"
        aria-pressed={workspaceMode === "manual"}
        onClick={() => setWorkspaceMode("manual")}
      >
        <Icon name="toolwindows-changes" />
      </button>
      <button
        className={`dl-tbtn app-stripe-button ${workspaceMode === "ai" ? "is-toggled" : ""}`}
        type="button"
        title="AI review"
        aria-label="AI review"
        aria-pressed={workspaceMode === "ai"}
        onClick={() => setWorkspaceMode("ai")}
      >
        <Icon name="diff-magicResolveToolbar" />
      </button>
      <span className="app-stripe-spacer" />
      <button
        className={`dl-tbtn app-stripe-button ${terminalOpen ? "is-toggled" : ""}`}
        type="button"
        aria-label={`Terminal ${shortcut(platform, "Alt+F12")}`}
        title={`Terminal ${shortcut(platform, "Alt+F12")}`}
        aria-pressed={terminalOpen}
        onClick={toggleTerminal}
      >
        <Icon name="toolwindows-terminal" />
      </button>
    </nav>
  );
}
