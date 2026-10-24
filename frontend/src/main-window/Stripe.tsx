import type { ToolTab } from "../api";
import { Icon } from "../lib/icon";
import { useApp } from "../state/context";

const buttons: { tab: ToolTab; label: string; icon: string }[] = [
  { tab: "changes", label: "Changes", icon: "toolwindows-changes" },
  { tab: "log", label: "Branch log", icon: "toolwindows-vcs" },
];

export function Stripe() {
  const tab = useApp((state) => state.repo?.lastTab);
  const setTab = useApp((state) => state.setTab);
  const terminalOpen = useApp((state) => state.terminalOpen);
  const toggleTerminal = useApp((state) => state.toggleTerminal);
  return (
    <nav className="app-stripe" aria-label="Tool windows">
      {buttons.map((button) => (
        <button
          key={button.tab}
          className={`dl-tbtn app-stripe-button ${tab === button.tab ? "is-toggled" : ""}`}
          type="button"
          aria-label={button.label}
          aria-pressed={tab === button.tab}
          onClick={() => setTab(button.tab)}
        >
          <Icon name={button.icon} />
        </button>
      ))}
      <span className="app-stripe-spacer" />
      <button
        className={`dl-tbtn app-stripe-button ${terminalOpen ? "is-toggled" : ""}`}
        type="button"
        aria-label="Terminal ⌥F12"
        title="Terminal ⌥F12"
        aria-pressed={terminalOpen}
        onClick={toggleTerminal}
      >
        <Icon name="toolwindows-terminal" />
      </button>
    </nav>
  );
}
