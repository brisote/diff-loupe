import { createStore } from "zustand/vanilla";
import type {
  ApiError,
  AppInfo,
  Backend,
  Branches,
  BranchLog,
  CommitDetails,
  CoreEvent,
  FileChange,
  FileDiff,
  MergeOutcome,
  MergeState,
  PushResult,
  RecentRepo,
  RepoInfo,
  Settings,
  ToolTab,
  UpdateCheck,
} from "../api";
import { type ReportEnv, toApiError } from "../api";
import type { DiffSettings } from "../api/generated/DiffSettings";
import type { MergeSide } from "../api/generated/MergeSide";
import { areaFor, inStaged, parseKey } from "../changes/rows";
import {
  addFailure,
  type Call,
  type Context,
  cleanMessage,
  type Failure,
  hidePaths,
  keyOf,
  recorded,
  remember,
  stackOf,
  unhandled,
} from "./reports";
import {
  notNow,
  parseStars,
  repository,
  type StarPrompt,
  due as starDue,
  starKey,
  starred,
  used,
} from "./stars";
import {
  day,
  hour,
  type Later,
  lastCheckKey,
  laterKey,
  offered,
  parseLater,
  parseTime,
  restored,
  type UpdateInstall,
  type UpdateStatus,
} from "./updates";

export type Dialog =
  | "settings"
  | "about"
  | "uninstall"
  | "commit"
  | "rollback"
  | "conflicts"
  | "abortMerge"
  | "merge";

export type SettingsPage = "diff" | "updates";

export type NoticeAction = "pull" | "details" | "log" | "push" | "commit" | "showFiles";

export type NoticePart = { text: string; strong?: boolean };

export type Notice = {
  kind: "success" | "error";
  parts: NoticePart[];
  details?: string;
  files?: string[];
  actions: NoticeAction[];
};

export function namesList(names: string[], limit = 3): NoticePart[] {
  const shown = names.slice(0, limit);
  const more = names.length - shown.length;
  const parts: NoticePart[] = [];
  shown.forEach((name, index) => {
    if (index > 0) parts.push({ text: index === shown.length - 1 && more === 0 ? " and " : ", " });
    parts.push({ text: name, strong: true });
  });
  if (more > 0) parts.push({ text: ` and ${more === 1 ? "1 more file" : `${more} more files`}` });
  return parts;
}

export function mergeNotice(outcome: MergeOutcome, branch: string): Notice | null {
  if (outcome.status === "merged")
    return {
      kind: "success",
      parts: [
        { text: "Merged " },
        { text: outcome.from, strong: true },
        { text: " into " },
        { text: branch, strong: true },
        { text: "." },
      ],
      actions: ["push"],
    };
  if (outcome.status === "upToDate")
    return {
      kind: "success",
      parts: [
        { text: branch, strong: true },
        { text: " already has every commit of " },
        { text: outcome.from, strong: true },
        { text: "." },
      ],
      actions: [],
    };
  if (outcome.status === "blocked")
    return {
      kind: "error",
      parts: [
        { text: "Merge blocked: merging " },
        { text: outcome.from, strong: true },
        { text: " would overwrite your local changes to " },
        ...namesList(outcome.files.map((file) => file.split("/").pop() ?? file)),
        { text: ". Commit them first, then merge again." },
      ],
      files: outcome.files,
      actions: ["commit", "showFiles"],
    };
  return null;
}

export type TerminalGroup = { ids: string[]; active: string | null };

export function withoutTerminal(group: TerminalGroup, id: string): TerminalGroup {
  const index = group.ids.indexOf(id);
  const ids = group.ids.filter((other) => other !== id);
  const active =
    group.active === id ? (ids[Math.min(index, ids.length - 1)] ?? null) : group.active;
  return { ids, active };
}

const endedNotice: ApiError = {
  code: "io",
  message: "The shell stopped right after it started. Check the shell in your login settings.",
  path: null,
};

export type RollbackInput = { files: string[]; deleteAdded: boolean };

export type CommitInput = {
  message: string;
  amend: boolean;
  files: string[];
  staged: string[];
  push: boolean;
};

export function errorNotice(lead: string, error: ApiError): Notice {
  const [first = "", ...rest] = error.message.split("\n");
  return {
    kind: "error",
    parts: [{ text: `${lead} ${first}` }],
    details: rest.length > 0 ? error.message : undefined,
    actions: rest.length > 0 ? ["details"] : [],
  };
}

export function pushNotice(result: PushResult): Notice {
  if (result.status === "pushed" && result.commits === 0) {
    return {
      kind: "success",
      parts: [
        { text: "Nothing to push: " },
        { text: result.remoteBranch, strong: true },
        { text: " is up to date." },
      ],
      actions: [],
    };
  }
  if (result.status === "pushed") {
    const commits = result.commits === 1 ? "1 commit" : `${result.commits} commits`;
    return {
      kind: "success",
      parts: [
        { text: `Pushed ${commits} to ` },
        { text: result.remoteBranch, strong: true },
        { text: "." },
      ],
      actions: ["log"],
    };
  }
  const behind =
    result.behind === null
      ? "has commits"
      : result.behind === 1
        ? "has 1 commit"
        : `has ${result.behind} commits`;
  return {
    kind: "error",
    parts: [
      { text: "Push rejected: " },
      { text: result.remoteBranch, strong: true },
      { text: ` ${behind} that you don't have. Merge them first, then push again.` },
    ],
    details: result.details,
    actions: ["pull", "details"],
  };
}

export type TaskState = {
  id: string;
  label: string;
  progress: number | null;
  cancellable: boolean;
};

export type OpenError = { path: string; error: ApiError };

export type TaskEvent = Extract<CoreEvent, { type: "task" }>;

export const openMark = "open-repo";
export const changesMeasure = "open-to-changes";
export const selectMark = "select-file";
export const diffMeasure = "select-to-diff";

export type AppState = {
  backend: Backend;
  started: boolean;
  startError: ApiError | null;
  info: AppInfo | null;
  settings: Settings | null;
  recent: RecentRepo[];
  repo: RepoInfo | null;
  openError: OpenError | null;
  tasks: TaskState[];
  dialog: Dialog | null;
  changes: FileChange[] | null;
  uncommitted: FileChange[] | null;
  merge: MergeState | null;
  statusError: ApiError | null;
  selectedStaged: boolean;
  diff: FileDiff | null;
  diffError: ApiError | null;
  log: BranchLog | null;
  logError: ApiError | null;
  logCommit: string | null;
  commit: CommitDetails | null;
  commitError: ApiError | null;
  logFile: string | null;
  commitDiff: FileDiff | null;
  commitDiffError: ApiError | null;
  start: () => Promise<void>;
  open: (path: string) => Promise<void>;
  openPicked: () => Promise<void>;
  removeRecent: (path: string) => Promise<void>;
  dismissError: () => void;
  setTab: (tab: ToolTab) => void;
  setTarget: (target: string | null) => Promise<void>;
  loadStatus: () => Promise<void>;
  loadDiff: () => Promise<void>;
  select: (key: string | null) => void;
  loadLog: () => Promise<void>;
  selectCommit: (id: string | null) => void;
  selectLogFile: (path: string | null) => void;
  saveSettings: (settings: Settings) => Promise<void>;
  setDiffSettings: (change: Partial<DiffSettings>) => Promise<void>;
  showDialog: (dialog: Dialog | null) => void;
  notice: Notice | null;
  branches: Branches | null;
  loadBranches: () => Promise<void>;
  switchBranch: (name: string) => Promise<void>;
  fetchRemote: () => Promise<void>;
  commitChanges: (input: CommitInput) => Promise<void>;
  rollbackChanges: (input: RollbackInput) => Promise<void>;
  push: () => Promise<void>;
  pull: () => Promise<void>;
  mergeTarget: () => Promise<void>;
  acceptSide: (files: string[], side: MergeSide) => Promise<void>;
  mergeFile: string | null;
  openMerge: (file: string) => void;
  applyMerge: (file: string, text: string, crlf: boolean) => Promise<void>;
  nextConflict: (after: string) => string | null;
  abortMerge: () => Promise<void>;
  cancelTask: (id: string) => void;
  dismissNotice: () => void;
  settingsPage: SettingsPage;
  updateStatus: UpdateStatus;
  updateOffer: UpdateCheck | null;
  updateLater: Later | null;
  noticeShown: boolean;
  checkForUpdate: (manual: boolean) => Promise<void>;
  laterUpdate: () => Promise<void>;
  updateInstall: UpdateInstall;
  downloadUpdate: (check: UpdateCheck) => Promise<void>;
  restartToUpdate: () => Promise<void>;
  laterInstall: () => void;
  errorReport: {
    failures: Failure[];
    env: ReportEnv | null;
    calls: Call[];
    context: Context;
  } | null;
  boundaryReset: number;
  reportFailure: (failure: {
    command: string;
    code: string;
    message: string;
    detail?: string | null;
  }) => void;
  reportUiError: (error: unknown, componentStack?: string | null) => void;
  closeErrorReport: () => void;
  stars: StarPrompt;
  starShown: boolean;
  starOnGitHub: () => void;
  starNotNow: () => void;
  openUpdates: () => void;
  openLink: (url: string) => void;
  terminalOpen: boolean;
  terminals: Record<string, TerminalGroup>;
  terminalFocus: { id: string | null; request: number };
  toggleTerminal: () => void;
  hideTerminal: () => void;
  newTerminal: () => Promise<void>;
  closeTerminal: (id: string) => Promise<void>;
  dropTerminal: (id: string) => void;
  selectTerminal: (id: string) => void;
  focusTerminal: () => void;
};

export type AppStore = ReturnType<typeof createAppStore>;

export function applyTask(tasks: TaskState[], event: TaskEvent): TaskState[] {
  const rest = tasks.filter((task) => task.id !== event.id);
  if (event.done) return rest;
  const { id, label, progress, cancellable } = event;
  return [...rest, { id, label, progress, cancellable }];
}

export const defaultDiffSettings: DiffSettings = {
  viewer: "sideBySide",
  whitespace: "doNotIgnore",
  highlight: "words",
  collapseUnchanged: true,
  syncScroll: true,
  markdown: "renderedSideBySide",
};

export function diffOrder(changes: FileChange[], selection: string | null): FileChange[] {
  const files = changes.filter((change) => change.kind !== "conflicted");
  const first = files.filter((change) => change.path === selection);
  return [...first, ...files.filter((change) => change.path !== selection)];
}

const emptyLog = {
  log: null,
  logError: null,
  logCommit: null,
  commit: null,
  commitError: null,
  logFile: null,
  commitDiff: null,
  commitDiffError: null,
};

export function createAppStore(backend: Backend) {
  let reading: Promise<void> | null = null;
  let readAgain = false;
  let opening: Promise<void> = Promise.resolve();
  let diffRequest = 0;
  let loggingAgain = false;
  let logging = false;
  let commitRequest = 0;
  let commitDiffRequest = 0;
  let saving: Promise<void> = Promise.resolve();
  let updateTimer: ReturnType<typeof setInterval> | undefined;
  let lastCheck = 0;
  let checkRequest = 0;
  let checking = false;
  let history: Call[] = [];
  const closedReports = new Set<string>();
  let environment: Promise<ReportEnv | null> | null = null;
  let starsLoaded = false;
  let starSaving: Promise<unknown> = Promise.resolve();
  const saveStars = (stars: StarPrompt) => {
    if (!starsLoaded) return;
    starSaving = starSaving
      .then(() => backend.call("set_ui_value", { key: starKey, value: JSON.stringify(stars) }))
      .catch(() => undefined);
  };
  const restoring = new Set<string>();
  const ended = new Set<string>();
  const prepare = (path: string, changes: FileChange[], selection: string | null) => {
    const files = diffOrder(
      changes.filter((change) => !inStaged(change)),
      selection,
    ).map((change) => ({
      file: change.path,
      oldPath: change.oldPath,
    }));
    if (files.length > 0)
      void backend.call("prepare_diffs", { path, files }).catch(() => undefined);
  };
  const store = createStore<AppState>()((set, get) => {
    const countDay = () => {
      if (!starsLoaded) return;
      const stars = used(get().stars, Date.now());
      if (stars === get().stars) return;
      saveStars(stars);
      set({ stars });
    };
    const runMerge = async (command: "pull" | "merge_target", failed: string) => {
      const path = get().repo?.path;
      if (!path) return;
      set({ notice: null });
      try {
        const outcome = await backend.call(command, { path });
        if (get().repo?.path !== path) return;
        await get().loadStatus();
        void get().loadLog();
        if (outcome.status === "conflicts") set({ dialog: "conflicts" });
        else set({ notice: mergeNotice(outcome, get().repo?.branch ?? "HEAD") });
      } catch (error) {
        const failure = toApiError(error);
        if (failure.code !== "cancelled") set({ notice: errorNotice(failed, failure) });
      }
    };
    const focusOn = (id: string | null) => ({ id, request: get().terminalFocus.request + 1 });
    const restoreTerminals = async (path: string) => {
      if (restoring.has(path)) return;
      restoring.add(path);
      try {
        const sessions = await backend.call("terminal_list", { path }).catch(() => []);
        if (get().repo?.path !== path || (get().terminals[path]?.ids.length ?? 0) > 0) return;
        if (sessions.length === 0) {
          await get().newTerminal();
          return;
        }
        const ids = sessions.map((session) => session.id).filter((id) => !ended.has(id));
        set({
          terminals: { ...get().terminals, [path]: { ids, active: ids[ids.length - 1] ?? null } },
          terminalFocus: focusOn(ids[ids.length - 1] ?? null),
        });
      } finally {
        restoring.delete(path);
      }
    };
    const refreshRepo = async (path: string) => {
      const current = await backend.call("current_repo").catch(() => null);
      const repo = get().repo;
      if (!current || !repo || current.path !== path || repo.path !== path) return;
      if (current.branch === repo.branch && current.target === repo.target) return;
      set({
        repo: {
          ...repo,
          branch: current.branch,
          target: current.target,
          defaultBranch: current.defaultBranch,
        },
        branches: null,
      });
    };
    const loadCommit = async () => {
      const { repo, logCommit } = get();
      const request = ++commitRequest;
      if (!repo || !logCommit) return;
      try {
        const commit = await backend.call("commit_details", { path: repo.path, id: logCommit });
        if (request !== commitRequest) return;
        const { logFile, commit: previous } = get();
        const keep = logFile !== null && commit.files.some((f) => f.path === logFile);
        const first = previous?.id === commit.id ? null : (commit.files[0]?.path ?? null);
        set({ commit, commitError: null, logFile: keep ? logFile : first });
        void loadCommitDiff();
      } catch (error) {
        const failure = toApiError(error);
        if (request === commitRequest && failure.code !== "notOpen") set({ commitError: failure });
      }
    };
    const loadCommitDiff = async () => {
      const { repo, commit, logFile } = get();
      const request = ++commitDiffRequest;
      const file = commit?.files.find((f) => f.path === logFile);
      if (!repo || !commit || !file) {
        set({ commitDiff: null, commitDiffError: null });
        return;
      }
      try {
        const commitDiff = await backend.call("diff", {
          path: repo.path,
          file: file.path,
          oldPath: file.oldPath,
          commit: commit.id,
        });
        if (request === commitDiffRequest) set({ commitDiff, commitDiffError: null });
      } catch (error) {
        const failure = toApiError(error);
        if (request === commitDiffRequest && failure.code !== "notOpen")
          set({ commitDiffError: failure });
      }
    };
    return {
      backend,
      started: false,
      startError: null,
      info: null,
      settings: null,
      recent: [],
      repo: null,
      openError: null,
      tasks: [],
      dialog: null,
      changes: null,
      uncommitted: null,
      merge: null,
      statusError: null,
      selectedStaged: false,
      diff: null,
      diffError: null,
      ...emptyLog,

      start: async () => {
        backend.onOutcome((outcome) => {
          if (recorded(outcome.command))
            history = remember(history, {
              at: Date.now(),
              command: outcome.command,
              result: outcome.error?.code ?? "ok",
              ms: outcome.ms,
            });
          if (outcome.error && unhandled(outcome.error))
            get().reportFailure({
              command: outcome.command,
              code: outcome.error.code,
              message: outcome.error.message,
            });
        });
        backend.onEvent((event) => {
          if (event.type === "task") set({ tasks: applyTask(get().tasks, event) });
          else if (event.type === "terminalExit") {
            ended.add(event.id);
            void get().closeTerminal(event.id);
          } else if (event.type === "repoChanged" && event.path === get().repo?.path) {
            void get().loadStatus();
            void refreshRepo(event.path);
            if (get().repo?.lastTab === "log") void get().loadLog();
          }
        });
        backend.onFolderDrop((path) => {
          if (!get().repo) void get().open(path);
        });
        let loaded: [AppInfo, Settings, RecentRepo[], RepoInfo | null, string | null | undefined];
        try {
          loaded = await Promise.all([
            backend.call("app_info"),
            backend.call("get_settings"),
            backend.call("recent_repos"),
            backend.call("current_repo"),
            backend.call("get_ui_value", { key: starKey }).catch(() => undefined),
          ]);
        } catch (error) {
          set({ startError: toApiError(error) });
          return;
        }
        const [info, settings, recent, current, starState] = loaded;
        if (starState !== undefined) {
          starsLoaded = true;
          set({ stars: parseStars(starState) });
          countDay();
        }
        let repo = current;
        let openError: OpenError | null = null;
        const last = recent[0];
        if (!repo && last?.exists) {
          try {
            repo = await backend.call("open_repo", { path: last.path });
          } catch (error) {
            openError = { path: last.path, error: toApiError(error) };
          }
        }
        if (repo) performance.mark(openMark);
        set({ info, settings, recent, repo, openError, started: true });
        const [later, checked, pending] = await Promise.all([
          backend.call("get_ui_value", { key: laterKey }).catch(() => null),
          backend.call("get_ui_value", { key: lastCheckKey }).catch(() => null),
          backend.call("update_state").catch(() => null),
        ]);
        set({
          updateLater: parseLater(later),
          updateInstall: restored(pending, info.version),
        });
        lastCheck = parseTime(checked);
        void get()
          .checkForUpdate(false)
          .finally(() => {
            const state = get();
            set({
              starShown:
                starsLoaded &&
                starDue(state.stars, Date.now()) &&
                !state.noticeShown &&
                !state.updateOffer &&
                state.updateInstall.state === "idle",
            });
          });
        if (!updateTimer) {
          const checkIfDue = () => {
            countDay();
            if (Date.now() - lastCheck >= day) void get().checkForUpdate(false);
          };
          updateTimer = setInterval(checkIfDue, hour);
          window.addEventListener("focus", checkIfDue);
        }
        if (repo) {
          void get().loadStatus();
          void get().loadLog();
        }
      },

      open: (path) => {
        const run = opening.then(async () => {
          performance.mark(openMark);
          try {
            const repo = await backend.call("open_repo", { path });
            set({
              repo,
              openError: null,
              branches: null,
              changes: null,
              uncommitted: null,
              merge: null,
              statusError: null,
              selectedStaged: false,
              diff: null,
              diffError: null,
              ...emptyLog,
              notice: null,
            });
            commitRequest += 1;
            commitDiffRequest += 1;
            void get().loadStatus();
            void get().loadLog();
            set({ recent: await backend.call("recent_repos") });
          } catch (error) {
            set({ openError: { path, error: toApiError(error) } });
          }
        });
        opening = run;
        return run;
      },

      openPicked: async () => {
        const path = await backend.pickFolder();
        if (path) await get().open(path);
      },

      removeRecent: async (path) => {
        set({ recent: await backend.call("remove_recent", { path }) });
      },

      dismissError: () => set({ openError: null }),

      setTab: (tab) => {
        const repo = get().repo;
        if (!repo || repo.lastTab === tab) return;
        set({ repo: { ...repo, lastTab: tab } });
        if (tab === "log") void get().loadLog();
        else void get().loadStatus();
        void backend
          .call("set_repo_view", { path: repo.path, tab, selection: repo.lastSelection })
          .catch(() => undefined);
      },

      setTarget: async (target) => {
        const repo = get().repo;
        if (!repo || repo.target === target) return;
        await backend.call("set_target", { path: repo.path, target });
        const current = get().repo;
        if (current?.path !== repo.path) return;
        set({ repo: { ...current, target } });
        await get().loadStatus();
      },

      loadStatus: () => {
        if (reading) {
          readAgain = true;
          return reading;
        }
        reading = (async () => {
          let quick = get().changes === null;
          do {
            readAgain = false;
            const path = get().repo?.path;
            if (!path) break;
            const first = quick;
            readAgain ||= quick;
            quick = false;
            try {
              const target = get().repo?.lastTab === "review";
              const [listed, merge] = await Promise.all([
                backend.call("status", {
                  path,
                  untracked: first ? "skip" : "all",
                  ...(target ? {} : { target: false }),
                }),
                backend.call("merge_state", { path }).catch(() => null),
              ]);
              if (get().repo?.path === path && !(first && listed.length === 0)) {
                const changes = listed.filter((change) => !change.unchanged);
                const uncommitted = listed.filter((change) => change.staged || change.unstaged);
                set({ changes, uncommitted, merge, statusError: null });
                if (
                  (get().dialog === "conflicts" || get().dialog === "merge") &&
                  merge?.conflicts.length === 0
                )
                  set({ dialog: null });
                void get().loadDiff();
                prepare(path, changes, get().repo?.lastSelection ?? null);
              }
            } catch (error) {
              const failure = toApiError(error);
              if (get().repo?.path === path && failure.code !== "notOpen")
                set({ statusError: failure });
            }
          } while (readAgain);
        })().finally(() => {
          reading = null;
        });
        return reading;
      },

      loadDiff: async () => {
        const { repo, changes } = get();
        const change = changes?.find((c) => c.path === repo?.lastSelection);
        const request = ++diffRequest;
        if (!repo || !change || change.kind === "conflicted") {
          set({ diff: null, diffError: null });
          return;
        }
        try {
          const area = areaFor(change, get().selectedStaged);
          const isLocal = repo.lastTab === "changes";
          const diff = await backend.call("diff", {
            path: repo.path,
            file: change.path,
            oldPath: change.oldPath,
            ...(area ? { area } : {}),
            ...(isLocal ? { local: true } : {}),
          });
          if (request === diffRequest) set({ diff, diffError: null });
        } catch (error) {
          const failure = toApiError(error);
          if (request === diffRequest && failure.code !== "notOpen") set({ diffError: failure });
        }
      },

      select: (key) => {
        const repo = get().repo;
        const { path: selection, staged } =
          key === null ? { path: null, staged: false } : parseKey(key);
        if (!repo || (repo.lastSelection === selection && get().selectedStaged === staged)) return;
        performance.mark(selectMark);
        set({
          repo: { ...repo, lastSelection: selection },
          selectedStaged: staged,
          diff: null,
          diffError: null,
        });
        void get().loadDiff();
        void backend
          .call("set_repo_view", { path: repo.path, tab: repo.lastTab, selection })
          .catch(() => undefined);
      },

      loadLog: async () => {
        if (logging) {
          loggingAgain = true;
          return;
        }
        logging = true;
        try {
          do {
            loggingAgain = false;
            const path = get().repo?.path;
            if (!path) break;
            try {
              const log = await backend.call("branch_log", { path });
              if (get().repo?.path !== path) continue;
              set({ log, logError: null });
              const { logCommit } = get();
              if (logCommit && !log.entries.some((e) => e.id === logCommit))
                get().selectCommit(null);
            } catch (error) {
              const failure = toApiError(error);
              if (get().repo?.path === path && failure.code !== "notOpen")
                set({ logError: failure });
            }
          } while (loggingAgain);
        } finally {
          logging = false;
        }
      },

      selectCommit: (id) => {
        if (get().logCommit === id) return;
        commitDiffRequest += 1;
        set({
          logCommit: id,
          commit: null,
          commitError: null,
          logFile: null,
          commitDiff: null,
          commitDiffError: null,
        });
        void loadCommit();
      },

      selectLogFile: (logFile) => {
        if (get().logFile === logFile) return;
        performance.mark(selectMark);
        set({ logFile, commitDiff: null, commitDiffError: null });
        void loadCommitDiff();
      },

      saveSettings: (settings) => {
        const before = get().settings;
        set({ settings });
        if (!settings.updates.check) set({ updateOffer: null });
        else if (!before?.updates.check) void get().checkForUpdate(false);
        const run = saving.then(async () => {
          const saved = await backend.call("set_settings", { settings });
          if (get().settings === settings) set({ settings: saved });
          set({ info: await backend.call("app_info") });
          const changed =
            before?.diff.whitespace !== saved.diff.whitespace ||
            before?.diff.highlight !== saved.diff.highlight;
          const { repo, changes } = get();
          if (changed && repo && changes) {
            void get().loadDiff();
            prepare(repo.path, changes, repo.lastSelection);
          }
          if (changed && get().commit) void loadCommitDiff();
        });
        saving = run.catch(() => undefined);
        return run;
      },

      setDiffSettings: async (change) => {
        const settings = get().settings;
        if (!settings) return;
        try {
          await get().saveSettings({ ...settings, diff: { ...settings.diff, ...change } });
        } catch (error) {
          const info = get().info;
          const notice = `Settings could not be saved. ${toApiError(error).message}`;
          if (info) set({ info: { ...info, settingsNotice: notice } });
        }
      },

      showDialog: (dialog) =>
        set({
          ...(dialog === "settings" ? { settingsPage: "diff" as const } : {}),
          dialog:
            dialog === "commit" &&
            get().merge?.operation === "merge" &&
            (get().merge?.conflicts.length ?? 0) > 0
              ? "conflicts"
              : dialog,
        }),

      notice: null,
      branches: null,

      loadBranches: async () => {
        const path = get().repo?.path;
        if (!path) return;
        try {
          const branches = await backend.call("branches", { path });
          if (get().repo?.path === path) set({ branches });
        } catch (error) {
          set({ notice: errorNotice("Branches could not be read:", toApiError(error)) });
        }
      },

      switchBranch: async (name) => {
        const repo = get().repo;
        if (!repo) return;
        try {
          const info = await backend.call("switch_branch", { path: repo.path, name });
          if (get().repo?.path !== repo.path) return;
          set({ repo: { ...info, lastTab: repo.lastTab }, notice: null, ...emptyLog });
          commitRequest += 1;
          commitDiffRequest += 1;
          void get().loadStatus();
          void get().loadLog();
          set({ recent: await backend.call("recent_repos") });
        } catch (error) {
          set({ notice: errorNotice("Checkout failed:", toApiError(error)) });
        }
      },

      fetchRemote: async () => {
        const path = get().repo?.path;
        if (!path) return;
        try {
          await backend.call("fetch", { path });
          void get().loadLog();
        } catch (error) {
          const failure = toApiError(error);
          if (failure.code !== "cancelled") set({ notice: errorNotice("Fetch failed:", failure) });
        }
      },

      commitChanges: async ({ message, amend, files, staged, push }) => {
        const path = get().repo?.path;
        if (!path) return;
        await backend.call("commit", { path, message, amend, files, staged });
        set({ dialog: null, notice: null });
        void get().loadStatus();
        void get().loadLog();
        if (push) await get().push();
      },

      rollbackChanges: async ({ files, deleteAdded }) => {
        const path = get().repo?.path;
        if (!path) return;
        await backend.call("rollback", { path, files, deleteAdded });
        set({ dialog: null });
        void get().loadStatus();
      },

      push: async () => {
        const path = get().repo?.path;
        if (!path) return;
        try {
          const result = await backend.call("push", { path });
          if (get().repo?.path === path) set({ notice: pushNotice(result) });
          void get().loadLog();
        } catch (error) {
          const failure = toApiError(error);
          if (failure.code !== "cancelled") set({ notice: errorNotice("Push failed:", failure) });
        }
      },

      pull: () => runMerge("pull", "Fetch and merge failed:"),

      mergeTarget: () => runMerge("merge_target", "Merge failed:"),

      acceptSide: async (files, side) => {
        const path = get().repo?.path;
        if (!path) return;
        try {
          await backend.call("accept_side", { path, files, side });
        } finally {
          await get().loadStatus();
        }
      },

      mergeFile: null,

      openMerge: (file) => set({ mergeFile: file, dialog: "merge" }),

      applyMerge: async (file, text, crlf) => {
        const path = get().repo?.path;
        if (!path) return;
        try {
          await backend.call("apply_merge", { path, file, text, crlf });
        } finally {
          await get().loadStatus();
        }
      },

      nextConflict: (after) => {
        const paths = (get().merge?.conflicts ?? [])
          .map((conflict) => conflict.path)
          .filter((path) => path !== after)
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
        return (
          paths.find((path) => path.localeCompare(after, undefined, { sensitivity: "base" }) > 0) ??
          paths[0] ??
          null
        );
      },

      abortMerge: async () => {
        const path = get().repo?.path;
        if (!path) return;
        try {
          await backend.call("abort_merge", { path });
          set({ dialog: null });
        } catch (error) {
          set({ dialog: null, notice: errorNotice("Abort failed:", toApiError(error)) });
        }
        void get().loadStatus();
        void get().loadLog();
      },

      cancelTask: (id) => void backend.call("cancel", { id }).catch(() => undefined),

      dismissNotice: () => set({ notice: null }),

      settingsPage: "diff",
      updateStatus: { state: "idle" },
      updateOffer: null,
      updateLater: null,
      noticeShown: false,

      checkForUpdate: async (manual) => {
        if (manual ? get().updateStatus.state === "checking" : checking) return;
        if (!manual && !get().settings?.updates.check) return;
        const request = ++checkRequest;
        if (manual) set({ updateStatus: { state: "checking" } });
        else checking = true;
        try {
          const check = await backend.call("check_update");
          if (manual) set({ updateStatus: { state: "done", check } });
          if (request !== checkRequest) return;
          if (!manual && !get().settings?.updates.check) return;
          set({ updateOffer: offered(check, get().updateLater, Date.now()) ? check : null });
        } catch (error) {
          if (manual)
            set({ updateStatus: { state: "failed", message: toApiError(error).message } });
        } finally {
          if (!manual) {
            checking = false;
            lastCheck = Date.now();
            void backend
              .call("set_ui_value", { key: lastCheckKey, value: String(lastCheck) })
              .catch(() => undefined);
          }
        }
      },

      laterUpdate: async () => {
        const offer = get().updateOffer;
        if (!offer) return;
        const later = { version: offer.latest, until: Date.now() + day };
        set({ updateOffer: null, updateLater: later });
        await backend
          .call("set_ui_value", { key: laterKey, value: JSON.stringify(later) })
          .catch(() => undefined);
      },

      openUpdates: () => {
        set({ dialog: "settings", settingsPage: "updates" });
        void get().checkForUpdate(true);
      },

      openLink: (url) => {
        void backend.openLink(url).catch(() => undefined);
      },

      updateInstall: { state: "idle" },

      downloadUpdate: async (check) => {
        if (get().updateInstall.state === "downloading") return;
        set({ updateInstall: { state: "downloading", check }, updateOffer: null });
        try {
          await backend.call("download_update", { version: check.latest });
          set({ updateInstall: { state: "ready", check } });
        } catch (error) {
          const failure = toApiError(error);
          if (failure.code === "cancelled")
            set({ updateInstall: { state: "idle" }, updateOffer: check });
          else set({ updateInstall: { state: "failed", check, message: failure.message } });
        }
      },

      restartToUpdate: async () => {
        const install = get().updateInstall;
        if (install.state !== "ready") return;
        set({ updateInstall: { state: "installing", check: install.check } });
        try {
          await backend.installUpdate();
        } catch (error) {
          set({
            updateInstall: {
              state: "failed",
              check: install.check,
              message: toApiError(error).message,
            },
          });
        }
      },

      errorReport: null,
      boundaryReset: 0,

      reportFailure: (raw) => {
        const state = get();
        const repositories = [state.repo?.path ?? "", ...state.recent.map((recent) => recent.path)];
        const hide = (text: string) => hidePaths(text, state.info?.home ?? null, repositories);
        const failure: Failure = {
          at: Date.now(),
          command: raw.command,
          code: raw.code,
          message: hide(cleanMessage(raw.code, raw.message)),
          detail: raw.detail ? hide(raw.detail) : null,
          count: 1,
        };
        if (closedReports.has(keyOf(failure))) return;
        const open = state.errorReport;
        const screen = [
          state.repo
            ? state.repo.lastTab === "log"
              ? "Commit history"
              : state.repo.lastTab === "review"
                ? "Review"
                : "Local changes"
            : "Welcome",
          state.dialog ? `${state.dialog} dialog` : null,
          state.terminalOpen ? "terminal open" : null,
        ]
          .filter(Boolean)
          .join(", ");
        set({
          errorReport: {
            failures: addFailure(open?.failures ?? [], failure),
            env: open?.env ?? null,
            calls: history,
            context: open?.context ?? { screen, build: `${backend.kind}, ${import.meta.env.MODE}` },
          },
        });
        environment ??= backend.call("report_env").catch(() => null);
        void environment.then((env) => {
          const current = get().errorReport;
          if (current && env) set({ errorReport: { ...current, env } });
        });
      },

      reportUiError: (error, componentStack) =>
        get().reportFailure({
          command: "ui",
          code: "ui",
          message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          detail: stackOf(error, componentStack),
        }),

      closeErrorReport: () => {
        for (const failure of get().errorReport?.failures ?? []) closedReports.add(keyOf(failure));
        set({ errorReport: null, boundaryReset: get().boundaryReset + 1 });
      },

      stars: parseStars(null),
      starShown: false,

      starOnGitHub: () => {
        set({ starShown: false });
        void backend
          .openLink(repository)
          .then(() => {
            const stars = starred(get().stars);
            saveStars(stars);
            set({ stars });
          })
          .catch(() => undefined);
      },

      starNotNow: () => {
        const stars = notNow(get().stars, Date.now());
        saveStars(stars);
        set({ stars, starShown: false });
      },

      laterInstall: () => {
        if (get().updateInstall.state === "failed")
          void backend.call("dismiss_update").catch(() => undefined);
        set({ updateInstall: { state: "idle" } });
      },

      terminalOpen: false,
      terminals: {},
      terminalFocus: { id: null, request: 0 },

      toggleTerminal: () => {
        const { terminalOpen, repo, terminals } = get();
        if (terminalOpen) {
          set({ terminalOpen: false });
          return;
        }
        const active = repo ? (terminals[repo.path]?.active ?? null) : null;
        set({ terminalOpen: true, terminalFocus: focusOn(active) });
        if (repo && !(terminals[repo.path]?.ids.length ?? 0)) void restoreTerminals(repo.path);
      },

      hideTerminal: () => set({ terminalOpen: false }),

      newTerminal: async () => {
        const path = get().repo?.path;
        if (!path) return;
        try {
          const session = await backend.call("terminal_open", { path, cols: 80, rows: 24 });
          if (ended.has(session.id)) {
            set({ notice: errorNotice("The terminal ended:", endedNotice) });
            return;
          }
          const group = get().terminals[path] ?? { ids: [], active: null };
          if (group.ids.includes(session.id)) return;
          set({
            terminalFocus: focusOn(session.id),
            terminals: {
              ...get().terminals,
              [path]: { ids: [...group.ids, session.id], active: session.id },
            },
          });
        } catch (error) {
          set({ notice: errorNotice("The terminal could not start:", toApiError(error)) });
        }
      },

      closeTerminal: async (id) => {
        const open = Object.values(get().terminals).some((group) => group.ids.includes(id));
        get().dropTerminal(id);
        if (open) await backend.call("terminal_close", { id }).catch(() => undefined);
      },

      dropTerminal: (id) => {
        const terminals = { ...get().terminals };
        for (const [path, group] of Object.entries(terminals)) {
          if (group.ids.includes(id)) terminals[path] = withoutTerminal(group, id);
        }
        set({ terminals });
      },

      focusTerminal: () => {
        const repo = get().repo;
        const active = repo ? (get().terminals[repo.path]?.active ?? null) : null;
        set({ terminalOpen: true, terminalFocus: focusOn(active) });
      },

      selectTerminal: (id) => {
        const path = get().repo?.path;
        const group = path ? get().terminals[path] : undefined;
        if (!path || !group?.ids.includes(id)) return;
        set({
          terminals: { ...get().terminals, [path]: { ...group, active: id } },
          terminalFocus: focusOn(id),
        });
      },
    };
  });
  store.subscribe((state) => {
    if (state.notice && !state.noticeShown) store.setState({ noticeShown: true });
    if (
      state.starShown &&
      (state.notice || state.updateOffer || state.updateInstall.state !== "idle")
    )
      store.setState({ starShown: false });
  });
  return store;
}
