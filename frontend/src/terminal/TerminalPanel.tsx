import { useEffect, useRef } from "react";
import { Icon } from "../lib/icon";
import { useApp } from "../state/context";
import { disposeScreen, focusOnce, inputQueue, screenFor } from "./sessions";

export function sessionTitle(index: number): string {
  return index === 0 ? "Local" : `Local (${index + 1})`;
}

export function TerminalPanel({ height }: { height: number }) {
  const repo = useApp((state) => state.repo);
  const group = useApp((state) => (state.repo ? state.terminals[state.repo.path] : undefined));
  const newTerminal = useApp((state) => state.newTerminal);
  const closeTerminal = useApp((state) => state.closeTerminal);
  const selectTerminal = useApp((state) => state.selectTerminal);
  const hideTerminal = useApp((state) => state.hideTerminal);
  if (!repo) return null;
  const ids = group?.ids ?? [];
  const active = group?.active ?? null;
  return (
    <section className="dl-island app-terminal" aria-label="Terminal" style={{ height }}>
      <header className="dl-island-header">
        <span className="dl-island-title">Terminal</span>
        <div className="dl-tabs" role="tablist" aria-label="Terminal sessions">
          {ids.map((id, index) => (
            <span
              key={id}
              className={`dl-tab ${id === active ? "is-selected" : ""}`}
              role="tab"
              aria-selected={id === active}
              tabIndex={0}
              onClick={() => selectTerminal(id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") selectTerminal(id);
              }}
            >
              {sessionTitle(index)}
              {id === active && (
                <button
                  className="dl-tbtn app-tab-close"
                  type="button"
                  aria-label="Close session"
                  title="Close session"
                  onClick={(event) => {
                    event.stopPropagation();
                    disposeScreen(id);
                    void closeTerminal(id);
                  }}
                >
                  <Icon name="general-close" />
                </button>
              )}
            </span>
          ))}
        </div>
        <button
          className="dl-tbtn"
          type="button"
          aria-label="New session"
          title="New session"
          onClick={() => void newTerminal()}
        >
          <Icon name="general-add" />
        </button>
        <span className="dl-toolbar-spacer" />
        <button
          className="dl-tbtn"
          type="button"
          aria-label="Hide ⇧Esc"
          title="Hide ⇧Esc"
          onClick={hideTerminal}
        >
          <Icon name="general-hide" />
        </button>
      </header>
      <div className="app-terminal-screens">
        {ids.map((id) => (
          <TerminalScreen key={id} id={id} shown={id === active} />
        ))}
      </div>
    </section>
  );
}

function TerminalScreen({ id, shown }: { id: string; shown: boolean }) {
  const backend = useApp((state) => state.backend);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const screen = screenFor(
      id,
      inputQueue((data) => backend.call("terminal_write", { id, data })),
      (bytes) => void backend.call("terminal_ack", { id, bytes }).catch(() => undefined),
    );
    element.appendChild(screen.host);
    let size = "";
    const resize = () => {
      if (!element.offsetWidth || !element.offsetHeight) return;
      screen.fit.fit();
      const next = `${screen.term.cols}x${screen.term.rows}`;
      if (next === size) return;
      size = next;
      void backend
        .call("terminal_resize", { id, cols: screen.term.cols, rows: screen.term.rows })
        .catch(() => undefined);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => {
      observer.disconnect();
      screen.host.remove();
    };
  }, [backend, id]);

  const focus = useApp((state) => state.terminalFocus);
  useEffect(() => {
    if (shown && focus.id === id) focusOnce(id, focus.request);
  }, [id, shown, focus]);

  return <div ref={box} className="app-terminal-screen" hidden={!shown} />;
}
