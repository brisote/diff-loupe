import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { Backend, type Platform, type RecentRepo, type RepoInfo, type Settings } from "../api";
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
    watchPolling: false,
    lastTab: "review",
    lastSelection: null,
  };
}

export function fakeCore(handlers: Record<string, Handler> = {}, platform: Platform = "macos") {
  return new FakeTransport({
    app_info: () => ({
      version: "0.1.0",
      settingsNotice: null,
      home: "/Users/ada",
      platform,
    }),
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
    report_env: () => ({ version: "0.2.0", os: "macOS 26.1", arch: "aarch64", git: "2.50.1" }),
    ai_get_state: () => ({
      consentAccepted: false,
      account: null,
      review: null,
      reviews: [],
      activeReviewId: null,
      chatMessages: [],
    }),
    ai_set_consent: () => null,
    ai_sign_in: () => ({
      userCode: "ABCD-1234",
      verificationUrl: "https://cloud.diffloupe.com/device",
    }),
    ai_sign_out: () => null,
    ai_refresh_account: () => null,
    ai_add_funds: () => ({ checkoutUrl: "https://checkout.stripe.com/pay" }),
    ai_get_models: () => ({
      models: [
        { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet", description: "Best" },
        { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", description: "Balanced" },
        { id: "claude-3-5-haiku", name: "Claude 3.5 Haiku", description: "Fast" },
      ],
      efforts: [
        { id: "low", name: "Low" },
        { id: "medium", name: "Medium" },
        { id: "high", name: "High" },
      ],
      defaultModel: "claude-3-5-sonnet",
      defaultEffort: "medium",
    }),
    ai_start_review: () => null,
    ai_send_followup: () => null,
    ai_clear_thread: () => null,
    ai_delete_review: () => null,
    ai_revert_version: () => null,
    ...handlers,
  });
}

export async function renderWithStore(ui: ReactElement, transport: FakeTransport) {
  const store = createAppStore(new Backend(transport));
  await store.getState().start();
  const view = render(<StoreProvider store={store}>{ui}</StoreProvider>);
  return { store, transport, ...view };
}
