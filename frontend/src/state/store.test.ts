import { describe, expect, it, vi } from "vitest";
import { Backend } from "../api";
import { rowKey } from "../changes/rows";
import { fakeCore, recent, repoInfo, settings } from "../test/render";
import {
  applyTask,
  createAppStore,
  errorNotice,
  mergeNotice,
  type Notice,
  namesList,
  pushNotice,
} from "./store";

describe("applyTask", () => {
  it("adds, updates and removes tasks", () => {
    const started = applyTask([], {
      type: "task",
      id: "open",
      label: "Opening a",
      progress: null,
      done: false,
      cancellable: false,
    });
    expect(started).toEqual([
      { id: "open", label: "Opening a", progress: null, cancellable: false },
    ]);
    const moved = applyTask(started, {
      type: "task",
      id: "open",
      label: "Reading",
      progress: 0.5,
      done: false,
      cancellable: false,
    });
    expect(moved).toEqual([{ id: "open", label: "Reading", progress: 0.5, cancellable: false }]);
    expect(
      applyTask(moved, {
        type: "task",
        id: "open",
        label: "Reading",
        progress: 1,
        done: true,
        cancellable: false,
      }),
    ).toEqual([]);
  });
});

const plain = (notice: Notice | null) => notice?.parts.map((part) => part.text).join("");
const bold = (notice: Notice | null) =>
  notice?.parts.filter((part) => part.strong).map((part) => part.text);

describe("notices", () => {
  it("describes a push and a rejection", () => {
    const pushed = pushNotice({ status: "pushed", remoteBranch: "origin/gs/a", commits: 1 });
    expect(pushed).toMatchObject({ kind: "success", actions: ["log"] });
    expect(plain(pushed)).toBe("Pushed 1 commit to origin/gs/a.");
    expect(bold(pushed)).toEqual(["origin/gs/a"]);
    const rejected = pushNotice({
      status: "rejected",
      remoteBranch: "origin/gs/a",
      behind: 2,
      details: "x",
    });
    expect(rejected).toMatchObject({ kind: "error", actions: ["pull", "details"] });
    expect(plain(rejected)).toBe(
      "Push rejected: origin/gs/a has 2 commits that you don't have. Merge them first, then push again.",
    );
    expect(
      plain(
        pushNotice({ status: "rejected", remoteBranch: "origin/gs/a", behind: null, details: "x" }),
      ),
    ).toContain(" has commits that you don't have.");
  });

  it("says when there was nothing to push", () => {
    const nothing = pushNotice({ status: "pushed", remoteBranch: "origin/gs/a", commits: 0 });
    expect(plain(nothing)).toBe("Nothing to push: origin/gs/a is up to date.");
    expect(nothing.actions).toEqual([]);
  });

  it("keeps a long git message for the details", () => {
    expect(errorNotice("Push failed:", { code: "git", message: "fatal: no", path: null })).toEqual({
      kind: "error",
      parts: [{ text: "Push failed: fatal: no" }],
      details: undefined,
      actions: [],
    });
    const long = errorNotice("Push failed:", { code: "git", message: "a\nb", path: null });
    expect(long.details).toBe("a\nb");
    expect(long.actions).toEqual(["details"]);
  });

  it("describes each merge outcome", () => {
    const merged = mergeNotice({ status: "merged", from: "main" }, "gs/x");
    expect(plain(merged)).toBe("Merged main into gs/x.");
    expect(merged?.actions).toEqual(["push"]);
    expect(plain(mergeNotice({ status: "upToDate", from: "main" }, "gs/x"))).toBe(
      "gs/x already has every commit of main.",
    );
    const blocked = mergeNotice(
      { status: "blocked", from: "main", files: ["src/a.kt", "b.kt"] },
      "gs/x",
    );
    expect(plain(blocked)).toBe(
      "Merge blocked: merging main would overwrite your local changes to a.kt and b.kt. Commit them first, then merge again.",
    );
    expect(bold(blocked)).toEqual(["main", "a.kt", "b.kt"]);
    expect(blocked).toMatchObject({
      files: ["src/a.kt", "b.kt"],
      actions: ["commit", "showFiles"],
    });
    expect(mergeNotice({ status: "conflicts", from: "main", count: 2 }, "gs/x")).toBeNull();
  });

  it("names up to three files and counts the rest", () => {
    const text = (names: string[]) =>
      namesList(names)
        .map((part) => part.text)
        .join("");
    expect(text(["a"])).toBe("a");
    expect(text(["a", "b", "c"])).toBe("a, b and c");
    expect(text(["a", "b", "c", "d", "e"])).toBe("a, b, c and 2 more files");
  });
});

describe("start", () => {
  it("reopens the newest repository that still exists", async () => {
    const core = fakeCore({
      recent_repos: () => [recent("acme-billing")],
      open_repo: () => repoInfo("acme-billing"),
    });
    const store = createAppStore(new Backend(core));
    await store.getState().start();
    expect(store.getState().repo?.name).toBe("acme-billing");
    expect(core.calls.map((c) => c.cmd)).toContain("open_repo");
  });

  it("shows the welcome screen when the newest repository is gone", async () => {
    const core = fakeCore({ recent_repos: () => [recent("gone", null, false)] });
    const store = createAppStore(new Backend(core));
    await store.getState().start();
    expect(store.getState().repo).toBeNull();
    expect(store.getState().openError).toBeNull();
  });

  it("keeps the error when the newest repository fails to open", async () => {
    const core = fakeCore({
      recent_repos: () => [recent("broken")],
      open_repo: () => {
        throw { code: "notARepository", message: "not a repo" };
      },
    });
    const store = createAppStore(new Backend(core));
    await store.getState().start();
    expect(store.getState().openError?.error.code).toBe("notARepository");
  });
});

describe("actions", () => {
  it("saves a new target and reloads only the changes for it", async () => {
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing"),
      set_target: () => null,
      branch_log: () => ({ entries: [], truncated: false }),
    });
    const store = createAppStore(new Backend(core));
    await store.getState().start();
    await store.getState().setTarget("develop");
    expect(store.getState().repo?.target).toBe("develop");
    const after = core.calls.map((call) => call.cmd);
    const set = after.lastIndexOf("set_target");
    expect(after.slice(set + 1)).toEqual(expect.arrayContaining(["status", "merge_state"]));
    expect(after.slice(set + 1)).not.toContain("branch_log");
  });

  it("reloads the commit diff when the whitespace setting changes", async () => {
    const id = "a".repeat(40);
    const core = fakeCore({
      current_repo: () => ({ ...repoInfo("acme-billing"), lastTab: "log" }),
      branch_log: () => ({
        truncated: false,
        entries: [
          {
            id,
            short: id.slice(0, 8),
            subject: "Edit",
            author: "Ada",
            time: 0,
            files: 1,
          },
        ],
      }),
      commit_details: () => ({
        id,
        short: id.slice(0, 8),
        subject: "Edit",
        body: "",
        author: "Ada",
        email: "ada@example.com",
        time: 0,
        parents: [],
        files: [{ path: "a.txt", oldPath: null, kind: "modified" }],
      }),
      diff: () => new Promise(() => undefined),
    });
    const store = createAppStore(new Backend(core));
    await store.getState().start();
    store.getState().selectCommit(id);
    await vi.waitFor(() => expect(store.getState().logFile).toBe("a.txt"));
    const diffs = () => core.calls.filter((call) => call.cmd === "diff").length;
    const before = diffs();
    await store.getState().setDiffSettings({ whitespace: "ignore" });
    expect(diffs()).toBe(before + 1);
  });

  it("records a failed open without losing the open repository", async () => {
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing"),
      open_repo: () => {
        throw { code: "notFound", message: "missing" };
      },
    });
    const store = createAppStore(new Backend(core));
    await store.getState().start();
    await store.getState().open("/nope");
    expect(store.getState().repo?.name).toBe("acme-billing");
    expect(store.getState().openError).toEqual({
      path: "/nope",
      error: { code: "notFound", message: "missing" },
    });
  });

  it("opens the picked folder and ignores a cancelled picker", async () => {
    const core = fakeCore({ open_repo: () => repoInfo("picked") });
    const store = createAppStore(new Backend(core));
    await store.getState().start();
    await store.getState().openPicked();
    expect(store.getState().repo).toBeNull();
    core.picked = "/Users/ada/Workspace/picked";
    await store.getState().openPicked();
    expect(store.getState().repo?.name).toBe("picked");
  });

  it("saves the tab of the open repository", async () => {
    const core = fakeCore({ current_repo: () => repoInfo("acme-billing") });
    const store = createAppStore(new Backend(core));
    await store.getState().start();
    store.getState().setTab("log");
    expect(store.getState().repo?.lastTab).toBe("log");
    expect(core.calls.at(-1)).toEqual({
      cmd: "set_repo_view",
      args: { path: "/Users/ada/Workspace/acme-billing", tab: "log", selection: null },
    });
  });

  it("shows why the app could not start", async () => {
    const core = fakeCore({
      get_settings: () => {
        throw { code: "store", message: "storage failed: locked", path: null };
      },
    });
    const store = createAppStore(new Backend(core));
    await store.getState().start();
    expect(store.getState().started).toBe(false);
    expect(store.getState().startError?.message).toBe("storage failed: locked");
  });

  it("ignores folder drops while a repository is open", async () => {
    const core = fakeCore({ current_repo: () => repoInfo("acme-billing") });
    const store = createAppStore(new Backend(core));
    await store.getState().start();
    core.drop("/Users/ada/Workspace/other");
    await new Promise((done) => setTimeout(done));
    expect(core.calls.map((c) => c.cmd)).not.toContain("open_repo");
  });

  it("tracks tasks and folder drops from the core", async () => {
    const core = fakeCore({ open_repo: () => repoInfo("dropped") });
    const store = createAppStore(new Backend(core));
    await store.getState().start();
    core.emit({
      type: "task",
      id: "open",
      label: "Opening dropped",
      progress: null,
      done: false,
      cancellable: false,
    });
    expect(store.getState().tasks).toHaveLength(1);
    core.drop("/Users/ada/Workspace/dropped");
    await new Promise((done) => setTimeout(done));
    expect(store.getState().repo?.name).toBe("dropped");
  });

  it("stores the settings the core returns and refreshes the notice", async () => {
    let notice: string | null = "settings.json could not be read";
    const core = fakeCore({
      app_info: () => ({ version: "0.1.0", settingsNotice: notice, home: "/Users/ada" }),
      set_settings: (args) => {
        notice = null;
        return (args as { settings: unknown }).settings;
      },
    });
    const store = createAppStore(new Backend(core));
    await store.getState().start();
    const changed = { ...settings, diff: { ...settings.diff, viewer: "unified" as const } };
    await store.getState().saveSettings(changed);
    expect(store.getState().settings?.diff.viewer).toBe("unified");
    expect(store.getState().info?.settingsNotice).toBeNull();
  });

  it("reads the status after opening and again when the repository changes", async () => {
    const reads: string[] = [];
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing"),
      status: (args) => {
        reads.push((args as { untracked: string }).untracked);
        return [
          {
            path: `file-${reads.length}.txt`,
            oldPath: null,
            kind: "untracked",
            staged: false,
            unstaged: true,
          },
        ];
      },
    });
    const store = createAppStore(new Backend(core));
    await store.getState().start();
    await vi.waitFor(() => expect(store.getState().changes?.[0]?.path).toBe("file-2.txt"));
    core.emit({ type: "repoChanged", path: "/Users/ada/Workspace/other" });
    core.emit({ type: "repoChanged", path: "/Users/ada/Workspace/acme-billing" });
    await vi.waitFor(() => expect(store.getState().changes?.[0]?.path).toBe("file-3.txt"));
    expect(reads).toEqual(["skip", "all", "all"]);
  });

  it("joins status requests that overlap into one more read", async () => {
    let reads = 0;
    let release: () => void = () => undefined;
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing"),
      status: async () => {
        reads += 1;
        await new Promise<void>((done) => {
          release = done;
        });
        return [];
      },
    });
    const store = createAppStore(new Backend(core));
    await store.getState().start();
    void store.getState().loadStatus();
    void store.getState().loadStatus();
    release();
    await vi.waitFor(() => expect(reads).toBe(2));
    release();
    await vi.waitFor(() => expect(store.getState().changes).toEqual([]));
    expect(reads).toBe(2);
  });

  it("drops a status reply that arrives after switching repositories", async () => {
    let release: (value: unknown) => void = () => undefined;
    const core = fakeCore({
      current_repo: () => repoInfo("first"),
      open_repo: () => repoInfo("second"),
      status: () =>
        new Promise((done) => {
          release = done;
        }),
    });
    const store = createAppStore(new Backend(core));
    await store.getState().start();
    const stale = release;
    await store.getState().open("/Users/ada/Workspace/second");
    stale([
      { path: "from-first.txt", oldPath: null, kind: "untracked", staged: false, unstaged: true },
    ]);
    await new Promise((done) => setTimeout(done));
    expect(store.getState().changes).toBeNull();
    release([]);
    await vi.waitFor(() => expect(store.getState().changes).toEqual([]));
  });

  it("opens repositories one after another, so the last choice wins", async () => {
    const finish: (() => void)[] = [];
    const opened: string[] = [];
    const core = fakeCore({
      open_repo: async (args) => {
        const path = (args as { path: string }).path;
        await new Promise<void>((done) => finish.push(done));
        opened.push(path);
        return repoInfo(path.split("/").at(-1) ?? "");
      },
    });
    const store = createAppStore(new Backend(core));
    await store.getState().start();
    const first = store.getState().open("/Users/ada/Workspace/first");
    const second = store.getState().open("/Users/ada/Workspace/second");
    await vi.waitFor(() => expect(finish).toHaveLength(1));
    finish[0]?.();
    await vi.waitFor(() => expect(finish).toHaveLength(2));
    finish[1]?.();
    await Promise.all([first, second]);
    expect(opened).toEqual(["/Users/ada/Workspace/first", "/Users/ada/Workspace/second"]);
    expect(store.getState().repo?.name).toBe("second");
  });

  it("waits for the full read when the quick read finds nothing", async () => {
    const shown: (number | undefined)[] = [];
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing"),
      status: (args) =>
        (args as { untracked: string }).untracked === "skip"
          ? []
          : [{ path: "new.txt", oldPath: null, kind: "untracked", staged: false, unstaged: true }],
    });
    const store = createAppStore(new Backend(core));
    store.subscribe((state) => shown.push(state.changes?.length));
    await store.getState().start();
    await vi.waitFor(() => expect(store.getState().changes?.[0]?.path).toBe("new.txt"));
    expect(shown).not.toContain(0);
  });

  it("does not show an error for a status reply meant for another repository", async () => {
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing"),
      status: () => {
        throw { code: "notOpen", message: "not the open repository", path: null };
      },
    });
    const store = createAppStore(new Backend(core));
    await store.getState().start();
    await new Promise((done) => setTimeout(done));
    expect(store.getState().statusError).toBeNull();
    expect(core.calls.find((call) => call.cmd === "status")?.args).toEqual({
      path: "/Users/ada/Workspace/acme-billing",
      untracked: "skip",
    });
  });

  it("keeps the newest diff when replies arrive out of order", async () => {
    const replies: ((value: unknown) => void)[] = [];
    const change = (path: string) => ({
      path,
      oldPath: null,
      kind: "modified" as const,
      staged: false,
      unstaged: true,
    });
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing"),
      status: () => [change("a.txt"), change("b.txt")],
      diff: () => new Promise((done) => replies.push(done)),
    });
    const store = createAppStore(new Backend(core));
    await store.getState().start();
    await vi.waitFor(() => expect(store.getState().changes).toHaveLength(2));
    store.getState().select("a.txt");
    store.getState().select("b.txt");
    await vi.waitFor(() => expect(replies.length).toBeGreaterThanOrEqual(2));
    const diff = (path: string) => ({
      path,
      oldPath: null,
      content: "text",
      left: {},
      right: {},
      blocks: [],
    });
    replies.at(-1)?.(diff("b.txt"));
    replies.at(-2)?.(diff("a.txt"));
    await new Promise((done) => setTimeout(done));
    expect(store.getState().diff?.path).toBe("b.txt");
  });

  it("asks for the staged or the unstaged part of a staged file", async () => {
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing"),
      status: () => [
        { path: "notes.md", oldPath: null, kind: "added", staged: true, unstaged: true },
        { path: "done.md", oldPath: null, kind: "modified", staged: true, unstaged: false },
        { path: "plain.md", oldPath: null, kind: "modified", staged: false, unstaged: true },
      ],
      diff: () => new Promise(() => undefined),
    });
    const store = createAppStore(new Backend(core));
    await store.getState().start();
    await vi.waitFor(() => expect(store.getState().changes).toHaveLength(3));
    const args = (cmd: string) =>
      core.calls
        .filter((call) => call.cmd === cmd)
        .map((call) => call.args as { area?: string; selection?: string });
    const areas = () => args("diff").map((call) => call.area ?? "none");
    store.getState().select(rowKey("staged", "notes.md"));
    store.getState().select("notes.md");
    store.getState().select("done.md");
    store.getState().select("plain.md");
    await vi.waitFor(() => expect(areas()).toEqual(["staged", "unstaged", "staged", "none"]));
    expect(store.getState().repo?.lastSelection).toBe("plain.md");
    expect(args("set_repo_view").at(-1)?.selection).toBe("plain.md");
    store.getState().select(rowKey("staged", "notes.md"));
    expect(store.getState().selectedStaged).toBe(true);
    expect(args("set_repo_view").at(-1)?.selection).toBe("notes.md");
  });
});
