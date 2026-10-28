import { useEffect, useState } from "react";
import { isApiError } from "./api";
import { AboutDialog } from "./dialogs/AboutDialog";
import { CommitDialog } from "./dialogs/CommitDialog";
import { ErrorReportDialog } from "./dialogs/ErrorReportDialog";
import { RollbackDialog } from "./dialogs/RollbackDialog";
import { SettingsDialog } from "./dialogs/SettingsDialog";
import { UninstallDialog } from "./dialogs/UninstallDialog";
import { Boundary } from "./lib/boundary";
import { Icon } from "./lib/icon";
import { hasModifier, usePlatform } from "./lib/platform";
import { AbortMergeDialog, ConflictsDialog } from "./merge/ConflictsDialog";
import { MergeDialog } from "./merge/MergeHost";
import { MainWindow } from "./screens/MainWindow";
import { Welcome } from "./screens/Welcome";
import { useApp } from "./state/context";
import { clearScreen, disposeScreen, writeScreen } from "./terminal/sessions";

function inTerminal(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(".app-terminal") !== null;
}

export function App() {
  const platform = usePlatform();
  const started = useApp((state) => state.started);
  const startError = useApp((state) => state.startError);
  const hasRepo = useApp((state) => state.repo !== null);
  const dialog = useApp((state) => state.dialog);
  const notice = useApp((state) => state.info?.settingsNotice);
  const showDialog = useApp((state) => state.showDialog);
  const reportUiError = useApp((state) => state.reportUiError);
  const boundaryReset = useApp((state) => state.boundaryReset);
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (!event.error && /ResizeObserver|^Script error/.test(event.message)) return;
      reportUiError(event.error ?? event.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      if (!isApiError(event.reason)) reportUiError(event.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [reportUiError]);
  const push = useApp((state) => state.push);
  const backend = useApp((state) => state.backend);
  const toggleTerminal = useApp((state) => state.toggleTerminal);
  const hideTerminal = useApp((state) => state.hideTerminal);
  const terminalOpen = useApp((state) => state.terminalOpen);
  const focusTerminal = useApp((state) => state.focusTerminal);
  const activeTerminal = useApp((state) =>
    state.repo ? (state.terminals[state.repo.path]?.active ?? null) : null,
  );

  useEffect(
    () =>
      backend.onEvent((event) => {
        if (event.type === "terminalOutput")
          writeScreen(event.id, event.data, (bytes) => {
            void backend.call("terminal_ack", { id: event.id, bytes }).catch(() => undefined);
          });
        else if (event.type === "terminalExit") disposeScreen(event.id);
      }),
    [backend],
  );
  const [closedNotice, setClosedNotice] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = hasModifier(platform, event);
      if (mod && event.key === ",") {
        event.preventDefault();
        showDialog("settings");
      } else if (event.altKey && event.key === "F12" && hasRepo && !dialog) {
        event.preventDefault();
        event.stopPropagation();
        if (terminalOpen && !inTerminal(event.target)) focusTerminal();
        else toggleTerminal();
      } else if (mod && event.key.toLowerCase() === "k" && inTerminal(event.target)) {
        if (event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          void push();
        } else if (platform === "macos") {
          event.preventDefault();
          event.stopPropagation();
          if (activeTerminal) clearScreen(activeTerminal);
        }
      } else if (event.shiftKey && event.key === "Escape" && terminalOpen && !dialog) {
        event.preventDefault();
        event.stopPropagation();
        hideTerminal();
      } else if (mod && event.key.toLowerCase() === "k" && hasRepo && !dialog) {
        event.preventDefault();
        if (event.shiftKey) void push();
        else showDialog("commit");
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [
    platform,
    showDialog,
    push,
    hasRepo,
    dialog,
    toggleTerminal,
    hideTerminal,
    terminalOpen,
    focusTerminal,
    activeTerminal,
  ]);

  if (startError) {
    return (
      <div className="app">
        <div className="dl-empty app-fill" role="alert">
          <span className="dl-empty-title">Diffloupe could not start</span>
          <span>{startError.message}</span>
        </div>
        <ErrorReportDialog />
      </div>
    );
  }
  if (!started) return <div className="app" />;
  return (
    <>
      <Boundary key={boundaryReset} onError={reportUiError}>
        {hasRepo ? <MainWindow /> : <Welcome />}
        {notice && notice !== closedNotice && (
          <div className="app-notice" role="status">
            <div className="dl-banner is-warning">
              <Icon name="status-warning" />
              <span className="dl-banner-text">{notice}</span>
              <span className="dl-banner-actions">
                <button className="app-link" type="button" onClick={() => setClosedNotice(notice)}>
                  Close
                </button>
              </span>
            </div>
          </div>
        )}
        {dialog === "settings" && <SettingsDialog />}
        {dialog === "about" && <AboutDialog />}
        {dialog === "uninstall" && <UninstallDialog />}
        {dialog === "commit" && hasRepo && <CommitDialog />}
        {dialog === "rollback" && hasRepo && <RollbackDialog />}
        {dialog === "conflicts" && hasRepo && <ConflictsDialog />}
        {dialog === "abortMerge" && hasRepo && <AbortMergeDialog />}
        {dialog === "merge" && hasRepo && <MergeDialog />}
      </Boundary>
      <ErrorReportDialog />
    </>
  );
}
