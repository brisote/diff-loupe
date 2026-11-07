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
import type { CloudAccount } from "../api/generated/CloudAccount";
import type { DiffSettings } from "../api/generated/DiffSettings";
import type { MergeSide } from "../api/generated/MergeSide";
import type { ModelsCatalog } from "../api/generated/ModelsCatalog";
import type { StoredAiChatMessage } from "../api/generated/StoredAiChatMessage";
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
  skipKey,
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

export type SettingsPage = "diff" | "updates" | "ai";

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
export const tabsKey = (path: string) => `repo.tabs:${path}`;
export const modeKey = (path: string) => `repo.mode:${path}`;

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
  openTabs: string[];
  activeTab: string | null;
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
  loadRecent: () => Promise<void>;
  dismissError: () => void;
  setTab: (tab: ToolTab) => void;
  setTarget: (target: string | null) => Promise<void>;
  loadStatus: () => Promise<void>;
  loadDiff: () => Promise<void>;
  select: (key: string | null) => void;
  openInNewTab: (path: string) => void;
  selectTab: (path: string) => void;
  closeTab: (path: string) => void;
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
  updateSkipped: string | null;
  noticeShown: boolean;
  checkForUpdate: (manual: boolean) => Promise<void>;
  laterUpdate: () => Promise<void>;
  skipVersion: (version?: string) => Promise<void>;
  updateInstall: UpdateInstall;
  updateAndRestart: (check: UpdateCheck) => Promise<void>;
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
  searchOpen: boolean;
  searchQuery: string;
  searchCase: boolean;
  searchMatch: { current: number; total: number };
  openSearch: () => void;
  closeSearch: () => void;
  toggleSearch: () => void;
  setSearchQuery: (query: string) => void;
  toggleSearchCase: () => void;
  setSearchMatch: (match: { current: number; total: number }) => void;
  workspaceMode: "manual" | "ai";
  setWorkspaceMode: (mode: "manual" | "ai") => void;
  consentAccepted: boolean;
  account: CloudAccount | null;
  authPending: { userCode: string; verificationUrl: string } | null;
  activeRun: {
    runId: string;
    stage: string;
    message: string;
    thoughts?: string[];
    cancellable: boolean;
  } | null;
  reportMarkdown: string | null;
  reviewCostUsd: string | null;
  chatMessages: StoredAiChatMessage[];
  streamingChat: string | null;
  quotedSelection: { text: string; heading?: string } | null;
  inlineError: string | null;
  isChatOpen: boolean;
  modelsCatalog: ModelsCatalog | null;
  selectedModel: string | null;
  selectedEffort: string | null;
  loadAiState: () => Promise<void>;
  loadAiModels: () => Promise<void>;
  setSelectedModel: (model: string) => void;
  setSelectedEffort: (effort: string) => void;
  setAiConsent: (accepted: boolean) => Promise<void>;
  aiSignIn: () => Promise<void>;
  cancelAiSignIn: () => void;
  aiSignOut: () => Promise<void>;
  aiRefreshAccount: () => Promise<void>;
  aiAddFunds: (amount: number) => Promise<void>;
  startAiReview: () => Promise<void>;
  cancelAiReview: () => void;
  toggleAiChat: () => void;
  setAiChatOpen: (open: boolean) => void;
  setQuotedSelection: (quote: { text: string; heading?: string } | null) => void;
  aiSendFollowup: (args: {
    prompt: string;
    quotedText?: string;
    sectionHeading?: string;
  }) => Promise<void>;
  aiClearThread: () => Promise<void>;
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
  let recentRequest = 0;
  let diffRequest = 0;
  let loggingAgain = false;
  let logging = false;
  let commitRequest = 0;
  let commitDiffRequest = 0;
  let aiStateRequest = 0;
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
    const saveTabs = (repoPath: string, tabs: string[]) => {
      void backend
        .call("set_ui_value", { key: tabsKey(repoPath), value: JSON.stringify(tabs) })
        .catch(() => undefined);
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
      openTabs: [],
      activeTab: null,
      ...emptyLog,
      workspaceMode: "manual",
      consentAccepted: false,
      account: null,
      authPending: null,
      activeRun: null,
      reportMarkdown: null,
      reviewCostUsd: null,
      chatMessages: [],
      streamingChat: null,
      quotedSelection: null,
      inlineError: null,
      isChatOpen: false,
      modelsCatalog: null,
      selectedModel: null,
      selectedEffort: null,

      start: async () => {
        backend.onOutcome((outcome) => {
          if (recorded(outcome.command))
            history = remember(history, {
              at: Date.now(),
              command: outcome.tag ? `${outcome.command} (${outcome.tag})` : outcome.command,
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
          if (event.type === "task") {
            set({ tasks: applyTask(get().tasks, event) });
            if (event.id === "ai_sign_in" && event.done) {
              set({ authPending: null });
              void get().loadAiState();
            }
            if (get().activeRun?.runId === event.id && event.done) {
              set({ activeRun: null });
            }
          } else if (event.type === "terminalExit") {
            ended.add(event.id);
            void get().closeTerminal(event.id);
          } else if (event.type === "repoChanged" && event.path === get().repo?.path) {
            void get().loadStatus();
            void refreshRepo(event.path);
            if (get().repo?.lastTab === "log") void get().loadLog();
            void get().loadAiState();
          } else if (event.type === "aiReviewStream") {
            const repo = get().repo;
            if (!repo || repo.path !== event.repo) return;
            const payload = event.event;
            if (payload.kind === "stage") {
              set((s) => {
                const currentThoughts = s.activeRun?.thoughts ?? [];
                const thought = payload.thought;
                const newThoughts =
                  thought && !currentThoughts.includes(thought)
                    ? [...currentThoughts, thought]
                    : currentThoughts;
                return {
                  activeRun: {
                    runId: event.runId,
                    stage: payload.stage,
                    message: payload.message,
                    thoughts: newThoughts,
                    cancellable: true,
                  },
                };
              });
            } else if (payload.kind === "reportDelta") {
              set((s) => ({
                reportMarkdown: (s.reportMarkdown ?? "") + payload.delta,
              }));
            } else if (payload.kind === "reportUpdate") {
              set({ reportMarkdown: payload.reportMarkdown });
            } else if (payload.kind === "chatDelta") {
              set((s) => ({
                streamingChat: (s.streamingChat ?? "") + payload.delta,
              }));
            } else if (payload.kind === "billing") {
              set((s) => ({
                account: s.account ? { ...s.account, balanceUsd: payload.balanceUsd } : s.account,
                reviewCostUsd: payload.costUsd,
              }));
            } else if (payload.kind === "done") {
              set((s) => ({
                activeRun: null,
                streamingChat: null,
                reportMarkdown: payload.reportMarkdown || s.reportMarkdown,
                reviewCostUsd: payload.costUsd || s.reviewCostUsd,
                account: s.account ? { ...s.account, balanceUsd: payload.balanceUsd } : s.account,
              }));
              void get().loadAiState();
            } else if (payload.kind === "error") {
              set({
                activeRun: null,
                streamingChat: null,
                inlineError: payload.message,
              });
            }
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
        const initialTabs = repo?.lastSelection ? [repo.lastSelection] : [];
        set({
          info,
          settings,
          recent,
          repo,
          openError,
          started: true,
          openTabs: initialTabs,
          activeTab: repo?.lastSelection ?? null,
        });
        if (repo) {
          const repoPath = repo.path;
          const lastSelection = repo.lastSelection;
          void backend
            .call("get_ui_value", { key: modeKey(repoPath) })
            .then((val) => {
              if (get().repo?.path !== repoPath) return;
              if (val === "ai" || val === "manual") set({ workspaceMode: val });
            })
            .catch(() => undefined);
          void backend
            .call("get_ui_value", { key: tabsKey(repoPath) })
            .then((val) => {
              if (!val || get().repo?.path !== repoPath) return;
              try {
                const parsed = JSON.parse(val);
                if (Array.isArray(parsed) && parsed.length > 0) {
                  const merged =
                    lastSelection && !parsed.includes(lastSelection)
                      ? [...parsed, lastSelection]
                      : parsed;
                  set({ openTabs: merged, activeTab: lastSelection ?? merged[0] });
                }
              } catch {}
            })
            .catch(() => undefined);
        }
        const [later, skipped, checked, pending] = await Promise.all([
          backend.call("get_ui_value", { key: laterKey }).catch(() => null),
          backend.call("get_ui_value", { key: skipKey }).catch(() => null),
          backend.call("get_ui_value", { key: lastCheckKey }).catch(() => null),
          backend.call("update_state").catch(() => null),
        ]);
        set({
          updateLater: parseLater(later),
          updateSkipped: typeof skipped === "string" && skipped.length > 0 ? skipped : null,
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
          void get().loadAiState();
        }
      },

      open: (path) => {
        const run = opening.then(async () => {
          performance.mark(openMark);
          try {
            const repo = await backend.call("open_repo", { path });
            const initialTabs = repo.lastSelection ? [repo.lastSelection] : [];
            set({
              repo,
              workspaceMode: "manual",
              openTabs: initialTabs,
              activeTab: repo.lastSelection,
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
              searchOpen: false,
              searchQuery: "",
              searchMatch: { current: 0, total: 0 },
              authPending: null,
              activeRun: null,
              inlineError: null,
            });
            const repoPath = repo.path;
            const lastSelection = repo.lastSelection;
            void backend
              .call("get_ui_value", { key: modeKey(repoPath) })
              .then((val) => {
                if (get().repo?.path !== repoPath) return;
                if (val === "ai" || val === "manual") set({ workspaceMode: val });
              })
              .catch(() => undefined);
            void backend
              .call("get_ui_value", { key: tabsKey(repoPath) })
              .then((val) => {
                if (!val || get().repo?.path !== repoPath) return;
                try {
                  const parsed = JSON.parse(val);
                  if (Array.isArray(parsed) && parsed.length > 0) {
                    const merged =
                      lastSelection && !parsed.includes(lastSelection)
                        ? [...parsed, lastSelection]
                        : parsed;
                    set({ openTabs: merged, activeTab: lastSelection ?? merged[0] });
                  }
                } catch {}
              })
              .catch(() => undefined);
            commitRequest += 1;
            commitDiffRequest += 1;
            recentRequest += 1;
            void get().loadStatus();
            void get().loadLog();
            void get().loadAiState();
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
        recentRequest += 1;
        set({ recent: await backend.call("remove_recent", { path }) });
      },

      loadRecent: async () => {
        const request = ++recentRequest;
        try {
          const recent = await backend.call("recent_repos");
          if (request === recentRequest) set({ recent });
        } catch {}
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
        void get().loadAiState();
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
        let nextTabs = get().openTabs;
        let nextActive = selection;
        if (selection !== null) {
          if (nextTabs.includes(selection)) {
            nextActive = selection;
          } else {
            const currentActive = get().activeTab;
            const idx = currentActive ? nextTabs.indexOf(currentActive) : -1;
            if (idx >= 0) {
              nextTabs = [...nextTabs];
              nextTabs[idx] = selection;
            } else {
              nextTabs = [...nextTabs, selection];
            }
            nextActive = selection;
          }
          saveTabs(repo.path, nextTabs);
        } else {
          nextActive = null;
        }
        set({
          repo: { ...repo, lastSelection: selection },
          openTabs: nextTabs,
          activeTab: nextActive,
          selectedStaged: staged,
          diff: null,
          diffError: null,
          searchMatch: { current: 0, total: 0 },
        });
        void get().loadDiff();
        void backend
          .call("set_repo_view", { path: repo.path, tab: repo.lastTab, selection })
          .catch(() => undefined);
      },

      openInNewTab: (path) => {
        const repo = get().repo;
        if (!repo) return;
        const currentTabs = get().openTabs;
        if (currentTabs.includes(path)) {
          get().select(path);
          return;
        }
        const active = get().activeTab;
        const currentIdx = active ? currentTabs.indexOf(active) : -1;
        const nextTabs = [...currentTabs];
        if (currentIdx >= 0) {
          nextTabs.splice(currentIdx + 1, 0, path);
        } else {
          nextTabs.push(path);
        }
        saveTabs(repo.path, nextTabs);
        performance.mark(selectMark);
        set({
          repo: { ...repo, lastSelection: path },
          openTabs: nextTabs,
          activeTab: path,
          selectedStaged: false,
          diff: null,
          diffError: null,
          searchMatch: { current: 0, total: 0 },
        });
        void get().loadDiff();
        void backend
          .call("set_repo_view", { path: repo.path, tab: repo.lastTab, selection: path })
          .catch(() => undefined);
      },

      selectTab: (path) => {
        const repo = get().repo;
        if (!repo || get().activeTab === path) return;
        get().select(path);
      },

      closeTab: (path) => {
        const repo = get().repo;
        if (!repo) return;
        const currentTabs = get().openTabs;
        const index = currentTabs.indexOf(path);
        if (index === -1) return;
        const nextTabs = currentTabs.filter((t) => t !== path);
        saveTabs(repo.path, nextTabs);
        if (get().activeTab === path) {
          if (nextTabs.length === 0) {
            set({
              repo: { ...repo, lastSelection: null },
              openTabs: [],
              activeTab: null,
              diff: null,
              diffError: null,
              searchMatch: { current: 0, total: 0 },
            });
            void backend
              .call("set_repo_view", { path: repo.path, tab: repo.lastTab, selection: null })
              .catch(() => undefined);
          } else {
            const nextIndex = Math.min(index, nextTabs.length - 1);
            const nextActive = nextTabs[nextIndex] ?? null;
            set({ openTabs: nextTabs, activeTab: nextActive });
            get().select(nextActive);
          }
        } else {
          set({ openTabs: nextTabs });
        }
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
        set({
          logFile,
          commitDiff: null,
          commitDiffError: null,
          searchMatch: { current: 0, total: 0 },
        });
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
          recentRequest += 1;
          void get().loadStatus();
          void get().loadLog();
          void get().loadAiState();
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
      updateSkipped: null,
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
          set({
            updateOffer: offered(check, get().updateLater, Date.now(), get().updateSkipped)
              ? check
              : null,
          });
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

      skipVersion: async (version?: string) => {
        const target = version ?? get().updateOffer?.latest;
        if (!target) return;
        set({ updateOffer: null, updateSkipped: target });
        await backend.call("set_ui_value", { key: skipKey, value: target }).catch(() => undefined);
      },

      openUpdates: () => {
        set({ dialog: "settings", settingsPage: "updates" });
        void get().checkForUpdate(true);
      },

      openLink: (url) => {
        void backend.openLink(url).catch(() => undefined);
      },

      updateInstall: { state: "idle" },

      updateAndRestart: async (check) => {
        await get().downloadUpdate(check);
        if (get().updateInstall.state === "ready") {
          await get().restartToUpdate();
        }
      },

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
            ? state.workspaceMode === "ai"
              ? "AI review"
              : state.repo.lastTab === "log"
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
        const stateSummary = [
          state.settings?.diff?.viewer ? `${state.settings.diff.viewer} diff` : null,
          state.settings?.diff?.whitespace && state.settings.diff.whitespace !== "doNotIgnore"
            ? `${state.settings.diff.whitespace} whitespace`
            : null,
          state.openTabs.length > 0
            ? `${state.openTabs.length} tab${state.openTabs.length === 1 ? "" : "s"} open`
            : null,
          state.activeTab ? `active: ${hide(state.activeTab)}` : null,
          state.selectedStaged ? "staged" : null,
        ]
          .filter(Boolean)
          .join(", ");
        const repoSummary = state.repo
          ? [
              state.changes !== null
                ? `${state.changes.length} changed file${state.changes.length === 1 ? "" : "s"}`
                : null,
              state.uncommitted !== null &&
              state.uncommitted.length !== (state.changes?.length ?? 0)
                ? `${state.uncommitted.length} uncommitted`
                : null,
              state.merge
                ? state.merge.conflicts.length > 0
                  ? `${state.merge.conflicts.length} conflict${state.merge.conflicts.length === 1 ? "" : "s"}`
                  : "merging"
                : "merge: clean",
              state.branches?.current
                ? `branch: ${state.branches.current}`
                : state.repo.branch
                  ? `branch: ${state.repo.branch}`
                  : null,
              state.repo.target ? `target: ${state.repo.target}` : null,
            ]
              .filter(Boolean)
              .join(", ")
          : null;
        set({
          errorReport: {
            failures: addFailure(open?.failures ?? [], failure),
            env: open?.env ?? null,
            calls: history,
            context: open?.context ?? {
              screen,
              build: `${backend.kind}, ${import.meta.env.MODE}`,
              state: stateSummary || null,
              repo: repoSummary || null,
            },
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

      searchOpen: false,
      searchQuery: "",
      searchCase: false,
      searchMatch: { current: 0, total: 0 },
      openSearch: () => set({ searchOpen: true }),
      closeSearch: () => set({ searchOpen: false }),
      toggleSearch: () => set((state) => ({ searchOpen: !state.searchOpen })),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      toggleSearchCase: () => set((state) => ({ searchCase: !state.searchCase })),
      setSearchMatch: (searchMatch) => set({ searchMatch }),

      setWorkspaceMode: (mode) => {
        set({ workspaceMode: mode });
        const repo = get().repo;
        if (repo) {
          void backend
            .call("set_ui_value", { key: modeKey(repo.path), value: mode })
            .catch(() => undefined);
          if (mode === "ai") {
            void get().loadAiState();
          }
        }
      },

      loadAiState: async () => {
        const repo = get().repo;
        if (!repo) {
          set({
            consentAccepted: false,
            account: null,
            reportMarkdown: null,
            reviewCostUsd: null,
            chatMessages: [],
            inlineError: null,
          });
          return;
        }
        const path = repo.path;
        const branch = repo.branch ?? undefined;
        const targetBranch = repo.target ?? undefined;
        const request = ++aiStateRequest;
        try {
          const result = await backend.call("ai_get_state", {
            repo: path,
            branch,
            targetBranch,
          });
          if (request !== aiStateRequest || get().repo?.path !== path) return;
          set({
            consentAccepted: result.consentAccepted,
            account: result.account,
            reportMarkdown: result.review?.reportMarkdown ?? null,
            reviewCostUsd: result.review?.costUsd ?? null,
            chatMessages: result.chatMessages ?? [],
            inlineError: null,
          });
          if (result.consentAccepted && !get().modelsCatalog) {
            void get().loadAiModels();
          }
        } catch (err) {
          if (request !== aiStateRequest || get().repo?.path !== path) return;
          const apiError = toApiError(err);
          set({ inlineError: apiError.message });
        }
      },

      loadAiModels: async () => {
        if (!get().consentAccepted) return;
        try {
          const catalog = await backend.call("ai_get_models");
          const currentModel = get().selectedModel;
          const currentEffort = get().selectedEffort;
          set({
            modelsCatalog: catalog,
            selectedModel: currentModel ?? catalog.defaultModel,
            selectedEffort: currentEffort ?? catalog.defaultEffort,
          });
        } catch {
          // ignore when cloud service is not running
        }
      },

      setSelectedModel: (model) => {
        set({ selectedModel: model });
      },

      setSelectedEffort: (effort) => {
        set({ selectedEffort: effort });
      },

      setAiConsent: async (accepted: boolean) => {
        set({ inlineError: null });
        try {
          await backend.call("ai_set_consent", { accepted });
          set({ consentAccepted: accepted });
          if (accepted) {
            void get().loadAiState();
            void get().loadAiModels();
          }
        } catch (err) {
          const apiError = toApiError(err);
          set({ inlineError: apiError.message });
        }
      },

      aiSignIn: async () => {
        set({ inlineError: null });
        try {
          const result = await backend.call("ai_sign_in", {});
          set({
            authPending: {
              userCode: result.userCode,
              verificationUrl: result.verificationUrl,
            },
          });
          void backend.openLink(result.verificationUrl).catch(() => undefined);
        } catch (err) {
          const apiError = toApiError(err);
          set({ inlineError: apiError.message, authPending: null });
        }
      },

      cancelAiSignIn: () => {
        get().cancelTask("ai_sign_in");
        set({ authPending: null });
      },

      aiSignOut: async () => {
        try {
          await backend.call("ai_sign_out");
        } finally {
          set({ account: null, authPending: null });
        }
      },

      aiRefreshAccount: async () => {
        try {
          const account = await backend.call("ai_refresh_account");
          set({ account });
        } catch (err) {
          const apiError = toApiError(err);
          if (apiError.code === "authRequired") {
            set({ account: null });
          }
        }
      },

      aiAddFunds: async (amount: number) => {
        set({ inlineError: null });
        try {
          const result = await backend.call("ai_add_funds", {
            amountUsd: amount as unknown as bigint,
          });
          void backend.openLink(result.checkoutUrl).catch(() => undefined);
          await get().aiRefreshAccount();
        } catch (err) {
          const apiError = toApiError(err);
          set({ inlineError: apiError.message });
        }
      },

      startAiReview: async () => {
        const repo = get().repo;
        if (!repo?.target) return;
        set({
          inlineError: null,
          activeRun: {
            runId: "starting",
            stage: "upload",
            message: "Starting review…",
            thoughts: ["Preparing repository snapshot and diff…"],
            cancellable: true,
          },
        });
        try {
          await backend.call("ai_start_review", {
            repo: repo.path,
            branch: repo.branch ?? undefined,
            targetBranch: repo.target,
            model: get().selectedModel ?? undefined,
            effort: get().selectedEffort ?? undefined,
          });
        } catch (err) {
          const apiError = toApiError(err);
          set({ inlineError: apiError.message, activeRun: null });
        }
      },

      cancelAiReview: () => {
        const run = get().activeRun;
        if (run) {
          get().cancelTask(run.runId);
          set({ activeRun: null });
        }
      },

      toggleAiChat: () => {
        set((s) => ({ isChatOpen: !s.isChatOpen }));
      },

      setAiChatOpen: (open: boolean) => {
        set({ isChatOpen: open });
      },

      setQuotedSelection: (quote) => {
        set({ quotedSelection: quote });
      },

      aiSendFollowup: async ({ prompt, quotedText, sectionHeading }) => {
        const repo = get().repo;
        if (!repo?.target) return;
        set({
          inlineError: null,
          streamingChat: "",
          activeRun: {
            runId: "ai_followup",
            stage: "followup",
            message: "Analyzing follow-up question…",
            thoughts: [],
            cancellable: true,
          },
          chatMessages: [
            ...get().chatMessages,
            {
              id: Date.now(),
              repo: repo.path,
              branch: repo.branch ?? "",
              targetBranch: repo.target,
              role: "user",
              content: prompt,
              quotedText: quotedText ?? null,
              costUsd: null,
              createdAt: Date.now(),
            },
          ],
        });
        try {
          await backend.call("ai_send_followup", {
            repo: repo.path,
            branch: repo.branch ?? undefined,
            targetBranch: repo.target,
            prompt,
            quotedText,
            sectionHeading,
          });
          await get().loadAiState();
        } catch (err) {
          const apiError = toApiError(err);
          set({ inlineError: apiError.message, activeRun: null, streamingChat: null });
        } finally {
          set({ streamingChat: null });
        }
      },

      aiClearThread: async () => {
        const repo = get().repo;
        if (!repo?.target || !repo.branch) return;
        try {
          await backend.call("ai_clear_thread", {
            repo: repo.path,
            branch: repo.branch,
            targetBranch: repo.target,
          });
          set({ chatMessages: [] });
        } catch (err) {
          const apiError = toApiError(err);
          set({ inlineError: apiError.message });
        }
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
