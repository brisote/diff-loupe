import { type ReactNode, useEffect, useRef, useState } from "react";
import type { WindowAction } from "../api/transport";
import { usePlatform } from "../lib/platform";
import { useApp } from "../state/context";

function WindowControls() {
  const backend = useApp((state) => state.backend);
  const [maximized, setMaximized] = useState(false);
  const version = useRef(0);
  useEffect(() => {
    const ask = () => {
      const asked = version.current;
      void backend
        .windowMaximized()
        .then((value) => {
          if (version.current === asked) setMaximized(value);
        })
        .catch(() => undefined);
    };
    ask();
    const stop = backend.onWindowMaximized((value) => {
      version.current += 1;
      setMaximized(value);
    });
    return stop;
  }, [backend]);
  const act = (action: WindowAction) => () => {
    const asked = version.current;
    void backend
      .windowControl(action)
      .then(() => backend.windowMaximized())
      .then((value) => {
        if (action === "toggleMaximize" && version.current === asked) setMaximized(value);
      })
      .catch(() => undefined);
  };
  return (
    <span className="dl-winctl">
      <button className="dl-wbtn" type="button" aria-label="Minimize" onClick={act("minimize")}>
        <span className="dl-wglyph-min" />
      </button>
      <button
        className="dl-wbtn"
        type="button"
        aria-label={maximized ? "Restore" : "Maximize"}
        onClick={act("toggleMaximize")}
      >
        <span className={maximized ? "dl-wglyph-restore" : "dl-wglyph-max"} />
      </button>
      <button className="dl-wbtn is-close" type="button" aria-label="Close" onClick={act("close")}>
        <span className="dl-wglyph-close" />
      </button>
    </span>
  );
}

export function WindowToolbar({ children }: { children?: ReactNode }) {
  const native = useApp((state) => state.backend.kind === "tauri");
  const platform = usePlatform();
  return (
    <header
      className={`dl-toolbar app-toolbar ${platform === "windows" ? "has-window-controls" : ""}`}
      data-tauri-drag-region="deep"
    >
      {platform === "macos" && (
        <div className={`app-lights ${native ? "is-native" : ""}`} aria-hidden="true">
          <span className="is-close" />
          <span className="is-minimize" />
          <span className="is-zoom" />
        </div>
      )}
      {children}
      {platform === "windows" && <WindowControls />}
    </header>
  );
}
