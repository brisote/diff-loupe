import { useEffect, useRef, useState } from "react";
import { Editor } from "../main-window/Editor";
import { MainToolbar } from "../main-window/MainToolbar";
import { clampWidth, Splitter } from "../main-window/Splitter";
import { StatusBar } from "../main-window/StatusBar";
import { Stripe } from "../main-window/Stripe";
import { ToolWindow } from "../main-window/ToolWindow";
import { useApp } from "../state/context";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { OpenErrorBanner } from "./OpenErrorBanner";

export const toolWidthKey = "toolWindowWidth";
export const terminalHeightKey = "terminalHeight";
const defaultTerminal = 280;
const minTerminal = 120;
const defaultWidth = 400;
const minWidth = 260;
const minEditor = 420;

export function MainWindow() {
  const backend = useApp((state) => state.backend);
  const openError = useApp((state) => state.openError);
  const body = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(defaultWidth);
  const resized = useRef(false);
  const [maxWidth, setMaxWidth] = useState(1000);
  const terminalOpen = useApp((state) => state.terminalOpen);
  const [terminalHeight, setTerminalHeight] = useState(defaultTerminal);
  const [maxHeight, setMaxHeight] = useState(600);

  useEffect(() => {
    void backend
      .call("get_ui_value", { key: toolWidthKey })
      .then((saved) => {
        const value = Number(saved);
        if (saved && Number.isFinite(value) && !resized.current) setWidth(value);
      })
      .catch(() => undefined);
    void backend
      .call("get_ui_value", { key: terminalHeightKey })
      .then((saved) => {
        const value = Number(saved);
        if (saved && Number.isFinite(value)) setTerminalHeight(value);
      })
      .catch(() => undefined);
  }, [backend]);

  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const measure = () => {
      setMaxWidth(element.clientWidth - minEditor);
      setMaxHeight(Math.round(window.innerHeight * 0.7));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const shown = clampWidth(width, minWidth, maxWidth);
  const resize = (value: number) => {
    resized.current = true;
    setWidth(value);
  };
  const save = (value: number) =>
    void backend
      .call("set_ui_value", { key: toolWidthKey, value: String(value) })
      .catch(() => undefined);
  const height = clampWidth(terminalHeight, minTerminal, maxHeight);
  const saveHeight = (value: number) =>
    void backend
      .call("set_ui_value", { key: terminalHeightKey, value: String(value) })
      .catch(() => undefined);

  return (
    <div className="app">
      <MainToolbar />
      {openError && (
        <div className="app-banner-row">
          <OpenErrorBanner closable />
        </div>
      )}
      <div className="app-body">
        <Stripe />
        <div className="app-work">
          <div className="app-panes" ref={body}>
            <ToolWindow width={shown} />
            <Splitter
              width={shown}
              min={minWidth}
              max={maxWidth}
              onResize={resize}
              onResizeEnd={save}
            />
            <Editor />
          </div>
          {terminalOpen && (
            <>
              <Splitter
                vertical
                label="Resize terminal"
                width={height}
                min={minTerminal}
                max={maxHeight}
                onResize={setTerminalHeight}
                onResizeEnd={saveHeight}
              />
              <TerminalPanel height={height} />
            </>
          )}
        </div>
      </div>
      <StatusBar />
    </div>
  );
}
