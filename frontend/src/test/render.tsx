import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { Backend, type RecentRepo, type RepoInfo, type Settings } from "../api";
import { FakeTransport, type Handler } from "../api/fake";
import { StoreProvider } from "../state/context";
import { createAppStore } from "../state/store";

export const settings: Settings = {
  diff: {
    viewer: "sideBySide",
    whitespace: "doNotIgnore",
    highlight: "words",
    collapseUnchanged: true,
    syncScroll: true,
    markdown: "renderedSideBySide",
  },
  updates: { check: false },
};

export function recent(name: string, branch: string | null = "main", exists = true): RecentRepo {
  return { path: `/Users/ada/Workspace/${name}`, name, branch, lastOpened: 0, exists };
}

export function repoInfo(name: string, branch = "main"): RepoInfo {
  return {
    path: `/Users/ada/Workspace/${name}`,
    name,
    branch,
    target: "main",
    defaultBranch: "main",
    watchError: null,
    lastTab: "review",
    lastSelection: null,
  };
}

export function fakeCore(handlers: Record<string, Handler> = {}) {
  return new FakeTransport({
    app_info: () => ({ version: "0.1.0", settingsNotice: null, home: "/Users/ada" }),
    get_settings: () => settings,
    recent_repos: () => [],
    current_repo: () => null,
    set_repo_view: () => null,
    get_ui_value: () => null,
    status: () => [],
    prepare_diffs: () => null,
    branch_log: () => ({ entries: [], truncated: false }),
    set_ui_value: () => null,
    set_settings: (args) => (args as { settings: Settings }).settings,
    update_state: () => ({ ready: null, failure: null, page: null }),
    report_env: () => ({ version: "0.2.0", macos: "26.1", arch: "aarch64", git: "2.50.1" }),
    ...handlers,
  });
}

export async function renderWithStore(ui: ReactElement, transport: FakeTransport) {
  const store = createAppStore(new Backend(transport));
  await store.getState().start();
  const view = render(<StoreProvider store={store}>{ui}</StoreProvider>);
  return { store, transport, ...view };
}
