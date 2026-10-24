import { bridgeTransport } from "./bridge";
import type { ArgsOf, Command, ResultOf } from "./commands";
import type { ApiError } from "./generated/ApiError";
import type { CoreEvent } from "./generated/CoreEvent";
import { tauriTransport } from "./tauri";
import { type Listener, type Transport, toApiError } from "./transport";

export type { ApiError } from "./generated/ApiError";
export type { AppInfo } from "./generated/AppInfo";
export type { Branches } from "./generated/Branches";
export type { BranchLog } from "./generated/BranchLog";
export type { CommitDetails } from "./generated/CommitDetails";
export type { CommitFile } from "./generated/CommitFile";
export type { Conflict } from "./generated/Conflict";
export type { CoreEvent } from "./generated/CoreEvent";
export type { DiffSide } from "./generated/DiffSide";
export type { FileChange } from "./generated/FileChange";
export type { FileDiff } from "./generated/FileDiff";
export type { LogEntry } from "./generated/LogEntry";
export type { MergeFile } from "./generated/MergeFile";
export type { MergeOutcome } from "./generated/MergeOutcome";
export type { MergeState } from "./generated/MergeState";
export type { PushResult } from "./generated/PushResult";
export type { RecentRepo } from "./generated/RecentRepo";
export type { RepoInfo } from "./generated/RepoInfo";
export type { ReportEnv } from "./generated/ReportEnv";
export type { Settings } from "./generated/Settings";
export type { ToolTab } from "./generated/ToolTab";
export type { UpdateCheck } from "./generated/UpdateCheck";
export type { UpdateReady } from "./generated/UpdateReady";
export type { UpdateState } from "./generated/UpdateState";
export { isApiError, toApiError } from "./transport";

export type CallArgs<C extends Command> = ArgsOf<C> extends null ? [] : [ArgsOf<C>];

export type Outcome = { command: string; ms: number; error: ApiError | null };

export class Backend {
  private readonly watchers = new Set<Listener<Outcome>>();

  constructor(private readonly transport: Transport) {}

  get kind() {
    return this.transport.kind;
  }

  onOutcome(listener: Listener<Outcome>): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  private async run<T>(command: string, action: () => Promise<T>): Promise<T> {
    const started = performance.now();
    const done = (error: ApiError | null) => {
      for (const watcher of this.watchers) {
        try {
          watcher({ command, ms: performance.now() - started, error });
        } catch {}
      }
    };
    let result: T;
    try {
      result = await action();
    } catch (error) {
      const failure = toApiError(error);
      done(failure);
      throw failure;
    }
    done(null);
    return result;
  }

  call<C extends Command>(cmd: C, ...args: CallArgs<C>): Promise<ResultOf<C>> {
    return this.run(
      cmd,
      async () => (await this.transport.send(cmd, args[0] ?? null)) as ResultOf<C>,
    );
  }

  pickFolder(): Promise<string | null> {
    return this.transport.pickFolder();
  }

  openLink(url: string): Promise<void> {
    return this.run("open_link", () => this.transport.openLink(url));
  }

  installUpdate(): Promise<void> {
    return this.run("install_update", () => this.transport.installUpdate());
  }

  uninstall(): Promise<void> {
    return this.run("uninstall", () => this.transport.uninstall());
  }

  onEvent(listener: Listener<CoreEvent>): () => void {
    return this.transport.onEvent(listener);
  }

  onFolderDrop(listener: Listener<string>): () => void {
    return this.transport.onFolderDrop(listener);
  }
}

export const defaultBridgeUrl = "ws://127.0.0.1:7357";

export function createBackend(): Backend {
  if ("__TAURI_INTERNALS__" in window) return new Backend(tauriTransport());
  const url =
    new URLSearchParams(window.location.search).get("bridge") ??
    import.meta.env.VITE_BRIDGE_URL ??
    defaultBridgeUrl;
  return new Backend(bridgeTransport(url));
}
