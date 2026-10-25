import { act, fireEvent, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CommitDetails, LogEntry } from "../api";
import { fakeCore, renderWithStore, repoInfo } from "../test/render";
import { BranchLogView, commitClass, commitCount, matches } from "./BranchLogView";

const clock = new Date(2026, 9, 22, 18, 0);
const now = Math.floor(clock.getTime() / 1000);

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
});

afterAll(() => {
  vi.useRealTimers();
});

const entry = (id: string, subject: string, merge = false): LogEntry => ({
  id: id.repeat(40).slice(0, 40),
  short: id.repeat(8).slice(0, 8),
  subject,
  author: "Ada Lovelace",
  time: now - 7200,
  merge,
});

const details = (log: LogEntry): CommitDetails => ({
  id: log.id,
  short: log.short,
  subject: log.subject,
  body: "",
  author: log.author,
  email: "ada@example.com",
  time: log.time,
  parents: [],
  files: [],
});

const skip = entry("a", "Skip empty invoices before export");
const merge = entry("b", "Merge branch 'main' into gs/invoice-export", true);

function core(entries: () => LogEntry[]) {
  return fakeCore({
    current_repo: () => ({ ...repoInfo("acme-billing", "gs/invoice-export"), lastTab: "log" }),
    branch_log: () => ({ entries: entries(), truncated: false }),
    commit_details: (args) => {
      const id = (args as { id: string }).id;
      const found = entries().find((e) => e.id === id);
      if (!found) throw { code: "invalidArgs", message: "gone" };
      return details(found);
    },
  });
}

describe("matches", () => {
  it("finds commits by subject, hash or author", () => {
    expect(matches(skip, "EMPTY")).toBe(true);
    expect(matches(skip, "aaaa")).toBe(true);
    expect(matches(skip, "lovelace")).toBe(true);
    expect(matches(skip, "grace")).toBe(false);
    expect(matches(merge, "merge branch")).toBe(true);
    expect(matches(merge, "")).toBe(true);
  });

  it("marks the first, last and merge rows for the graph", () => {
    expect(commitClass(skip, skip.id, merge.id)).toBe("is-first");
    expect(commitClass(merge, skip.id, merge.id)).toBe("is-last is-merge");
    expect(commitClass(merge, skip.id, undefined)).toBe("is-merge");
  });

  it("counts commits", () => {
    expect(commitCount(1)).toBe("1 commit");
    expect(commitCount(4)).toBe("4 commits");
  });
});

describe("BranchLogView", () => {
  it("shows the loading state until the log arrives", async () => {
    const transport = fakeCore({
      current_repo: () => ({ ...repoInfo("acme-billing"), lastTab: "log" }),
      branch_log: () => new Promise(() => undefined),
    });
    await renderWithStore(<BranchLogView />, transport);
    expect(screen.getByText("Loading the branch history")).toBeInTheDocument();
  });

  it("lists every commit, merges included, as a plain row", async () => {
    await renderWithStore(
      <BranchLogView />,
      core(() => [skip, merge]),
    );
    expect(await screen.findByText("2 commits")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Merge branch 'main' into gs/invoice-export" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("2 hours ago")).toHaveLength(2);
    expect(screen.getAllByText("Ada Lovelace")).toHaveLength(2);
    expect(screen.queryByText(skip.short)).not.toBeInTheDocument();
    expect(screen.queryByText("2 files")).not.toBeInTheDocument();
  });

  it("copies the full commit id from the row's context menu", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await renderWithStore(
      <BranchLogView />,
      core(() => [skip, merge]),
    );
    const row = await screen.findByRole("option", { name: skip.subject });
    fireEvent.contextMenu(row, { clientX: 20, clientY: 30 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy Revision Number" }));
    expect(writeText).toHaveBeenCalledWith(skip.id);
    expect(screen.queryByRole("menu", { name: "Commit actions" })).not.toBeInTheDocument();
  });

  it("opens the commit menu from the keyboard and closes it on scroll", async () => {
    await renderWithStore(
      <BranchLogView />,
      core(() => [skip, merge]),
    );
    const list = await screen.findByRole("listbox", { name: "Branch commits" });
    fireEvent.click(screen.getByRole("option", { name: skip.subject }));
    fireEvent.keyDown(list, { key: "F10", shiftKey: true });
    expect(await screen.findByRole("menu", { name: "Commit actions" })).toBeInTheDocument();
    fireEvent.scroll(list);
    expect(screen.queryByRole("menu", { name: "Commit actions" })).not.toBeInTheDocument();
  });

  it("says when the branch has no commits", async () => {
    const transport = fakeCore({
      current_repo: () => ({ ...repoInfo("acme-billing", "main"), lastTab: "log" }),
      branch_log: () => ({ entries: [], truncated: false }),
    });
    await renderWithStore(<BranchLogView />, transport);
    expect(await screen.findByText("No commits yet")).toBeInTheDocument();
    expect(screen.getByText("The branch has no commits.")).toBeInTheDocument();
  });

  it("says when it shows only the latest commits", async () => {
    const transport = fakeCore({
      current_repo: () => ({ ...repoInfo("acme-billing", "main"), target: null, lastTab: "log" }),
      branch_log: () => ({ entries: [skip, merge], truncated: true }),
    });
    await renderWithStore(<BranchLogView />, transport);
    expect(await screen.findByText("Latest 2 commits")).toBeInTheDocument();
  });

  it("drops the selection when the commit leaves the history", async () => {
    let entries = [skip, merge];
    const { store } = await renderWithStore(
      <BranchLogView />,
      core(() => entries),
    );
    await screen.findByText("2 commits");
    act(() => store.getState().selectCommit(skip.id));
    await screen.findByText("This commit changes no files");
    entries = [merge];
    await act(() => store.getState().loadLog());
    expect(store.getState().logCommit).toBeNull();
    expect(screen.getByText("Pick a commit")).toBeInTheDocument();
  });

  it("ignores a diff that arrives for a commit that is no longer selected", async () => {
    const other = entry("c", "Round totals half-even");
    const file = { path: "README.md", oldPath: null, kind: "modified" as const };
    const late: ((value: unknown) => void)[] = [];
    const pending: (() => void)[] = [];
    const transport = fakeCore({
      current_repo: () => ({ ...repoInfo("acme-billing"), lastTab: "log" }),
      branch_log: () => ({ entries: [skip, other], truncated: false }),
      commit_details: (args) => {
        const id = (args as { id: string }).id;
        const found = { ...details(id === skip.id ? skip : other), files: [file] };
        if (id === skip.id) return found;
        return new Promise((done) => pending.push(() => done(found)));
      },
      diff: (args) => {
        const commit = (args as { commit: string }).commit;
        if (commit === skip.id) return new Promise((done) => late.push(done));
        return new Promise(() => undefined);
      },
    });
    const { store } = await renderWithStore(<BranchLogView />, transport);
    await screen.findByText("2 commits");
    await act(async () => store.getState().selectCommit(skip.id));
    await vi.waitFor(() => expect(late).toHaveLength(1));
    await act(async () => store.getState().selectCommit(other.id));
    await act(async () => late[0]?.({ path: "README.md", stale: true }));
    await act(async () => pending[0]?.());
    await vi.waitFor(() => expect(store.getState().logFile).toBe("README.md"));
    expect(store.getState().commitDiff).toBeNull();
  });
});
