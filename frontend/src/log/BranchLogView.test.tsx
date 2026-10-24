import { act, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CommitDetails, LogEntry } from "../api";
import { fakeCore, renderWithStore, repoInfo } from "../test/render";
import { BranchLogView, commitCount, matches } from "./BranchLogView";

const clock = new Date(2026, 9, 22, 18, 0);
const now = Math.floor(clock.getTime() / 1000);

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
});

afterAll(() => {
  vi.useRealTimers();
});

const entry = (id: string, subject: string, merged = false): LogEntry => ({
  id: id.repeat(40).slice(0, 40),
  short: id.repeat(8).slice(0, 8),
  subject,
  author: "Ada Lovelace",
  time: now - 7200,
  files: 2,
  merged,
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
  merged: log.merged,
  files: [],
});

const skip = entry("a", "Skip empty invoices before export");
const merge = entry("b", "Merge branch 'main' into gs/invoice-export", true);

function core(entries: () => LogEntry[]) {
  return fakeCore({
    current_repo: () => ({ ...repoInfo("acme-billing", "gs/invoice-export"), lastTab: "log" }),
    branch_log: () => ({ target: "main", entries: entries() }),
    commit_details: (args) => {
      const id = (args as { id: string }).id;
      const found = entries().find((e) => e.id === id);
      if (!found) throw { code: "invalidArgs", message: "gone" };
      return details(found);
    },
  });
}

describe("matches", () => {
  it("finds commits by subject, hash or author, and merge rows by their label", () => {
    expect(matches(skip, "EMPTY", "main")).toBe(true);
    expect(matches(skip, "aaaa", "main")).toBe(true);
    expect(matches(skip, "lovelace", "main")).toBe(true);
    expect(matches(skip, "grace", "main")).toBe(false);
    expect(matches(merge, "merged main", "main")).toBe(true);
    expect(matches(merge, "", "main")).toBe(true);
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

  it("counts only commit rows and labels the merge row with the target", async () => {
    await renderWithStore(
      <BranchLogView />,
      core(() => [skip, merge]),
    );
    expect(await screen.findByText("1 commit")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Merged main" })).toBeInTheDocument();
    expect(screen.getAllByText("2 hours ago")).toHaveLength(2);
  });

  it("drops the selection when the commit leaves the history", async () => {
    let entries = [skip, merge];
    const { store } = await renderWithStore(
      <BranchLogView />,
      core(() => entries),
    );
    await screen.findByText("1 commit");
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
      branch_log: () => ({ target: "main", entries: [skip, other] }),
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
