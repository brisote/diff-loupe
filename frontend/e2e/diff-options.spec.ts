import type { Page } from "@playwright/test";
import { expect, git, test, type Workspace } from "./fixtures";

function lines(
  count: number,
  change: (line: number) => string | undefined = () => undefined,
): string {
  return `${Array.from({ length: count }, (_, i) => change(i + 1) ?? `line ${i + 1} stays the same`).join("\n")}\n`;
}

function repoWith(workspace: Workspace, path: string, before: string, after: string): string {
  const repo = workspace.repo("acme-billing");
  workspace.write(repo, path, before);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Before");
  workspace.write(repo, path, after);
  return repo;
}

async function open(page: Page, path: string) {
  await page.getByRole("treeitem", { name: path }).click();
}

test("the viewer toggle switches to a unified diff and back, and is remembered", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = repoWith(workspace, "a.txt", "one\ntwo\nthree\n", "one\nTWO\nthree\n");
  const app = await startApp({ open: [repo] });
  await open(page, "a.txt");
  await page.getByRole("button", { name: "Unified viewer" }).click();
  const unified = page.getByRole("region", { name: "Unified diff" });
  await expect(unified.getByLabel("Unified")).toContainText("two");
  await expect(unified.getByLabel("Unified")).toContainText("TWO");
  await expect(unified.locator(".dl-w-del")).toHaveText("two");
  await expect(unified.locator(".dl-w-ins")).toHaveText("TWO");
  await app.restart();
  await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();
  await page.getByRole("button", { name: "Side-by-side viewer" }).click();
  await expect(page.getByRole("region", { name: "Side-by-side diff" })).toBeVisible();
});

test("unchanged lines fold and a click shows them", async ({ page, workspace, startApp }) => {
  const repo = repoWith(
    workspace,
    "long.txt",
    lines(60),
    lines(60, (n) => (n === 20 ? "changed" : undefined)),
  );
  await startApp({ open: [repo] });
  await open(page, "long.txt");
  const after = page.getByLabel("After");
  await expect(after.getByRole("button", { name: "Show 39 unchanged lines" })).toBeVisible();
  await expect(after).not.toContainText("line 50 stays the same");
  await after.getByRole("button", { name: "Show 39 unchanged lines" }).click();
  await expect(after).toContainText("line 50 stays the same");
  await page.getByRole("button", { name: "Collapse Unchanged Fragments" }).click();
  await expect(page.getByRole("button", { name: /unchanged lines/ })).toHaveCount(0);
  await expect(page.getByLabel("After")).toContainText("line 45 stays the same");
});

test("the whitespace and highlighting settings change the diff and survive a restart", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = repoWith(
    workspace,
    "a.kt",
    "fun a() {\n  x = 1\n  y = 2\n}\n",
    "fun a() {\n    x  =  1\n  y = 3\n}\n",
  );
  const app = await startApp({ open: [repo] });
  await open(page, "a.kt");
  await expect(page.getByText("1 difference", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Diff settings" }).click();
  await page.getByRole("menuitem", { name: "Ignore whitespaces", exact: true }).click();
  await expect(page.locator(".dl-w-mod")).toHaveText(["2", "3"]);
  await page.getByRole("button", { name: "Diff settings" }).click();
  await page.getByRole("menuitem", { name: "Highlight lines" }).click();
  await expect(page.locator(".dl-w-mod")).toHaveCount(0);
  await expect(page.locator(".cm-diff-modified").first()).toBeVisible();
  await page.getByRole("button", { name: "Diff settings" }).click();
  await page.getByRole("menuitem", { name: "Synchronize scrolling" }).click();

  await app.restart();
  await open(page, "a.kt");
  await page.getByRole("button", { name: "Diff settings" }).click();
  const menu = page.getByRole("menu", { name: "Diff settings" });
  await expect(
    menu.getByRole("menuitem", { name: "Ignore whitespaces", exact: true }).locator("svg"),
  ).toHaveCount(1);
  await expect(menu.getByRole("menuitem", { name: "Highlight lines" }).locator("svg")).toHaveCount(
    1,
  );
  await expect(
    menu.getByRole("menuitem", { name: "Synchronize scrolling" }).locator("svg"),
  ).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Do not highlight" }).click();
  await expect(page.locator(".cm-diff-modified")).toHaveCount(0);
});

test("each fold expands on its own, in both views", async ({ page, workspace, startApp }) => {
  const change = (n: number) => (n === 20 || n === 60 ? `line ${n} changed` : undefined);
  const repo = repoWith(workspace, "folds.txt", lines(100), lines(100, change));
  await startApp({ open: [repo] });
  await open(page, "folds.txt");
  const after = page.getByLabel("After");
  await after.getByRole("button", { name: "Show 38 unchanged lines" }).click();
  await expect(after).toContainText("line 40 stays the same");
  await after.getByRole("button", { name: "Show 19 unchanged lines" }).click();
  await expect(after).toContainText("line 5 stays the same");
  await expect(after.getByRole("button", { name: /unchanged lines/ })).toHaveCount(1);

  await page.getByRole("button", { name: "Unified viewer" }).click();
  const unified = page.getByLabel("Unified");
  await expect(unified.getByRole("button", { name: /unchanged lines/ })).toHaveCount(3);
  await unified.getByRole("button", { name: "Show 39 unchanged lines" }).click();
  await expect(unified.getByRole("button", { name: /unchanged lines/ })).toHaveCount(2);
  await expect(unified.getByRole("button", { name: "Show 39 unchanged lines" })).toHaveCount(0);
});

test("F7 works in the unified view and the current change survives a view switch", async ({
  page,
  workspace,
  startApp,
}) => {
  const change = (n: number) => (n === 20 || n === 250 ? `line ${n} changed` : undefined);
  const repo = repoWith(workspace, "notes.txt", lines(300), lines(300, change));
  await startApp({ open: [repo] });
  await open(page, "notes.txt");
  await page.getByRole("button", { name: "Collapse Unchanged Fragments" }).click();
  await page.getByRole("button", { name: "Unified viewer" }).click();
  const scroller = page.locator(".app-cm.is-unified .cm-scroller");
  await expect(page.getByText("2 differences", { exact: true })).toBeVisible();
  await page.keyboard.press("F7");
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(4000);
  await page.getByRole("button", { name: "Side-by-side viewer" }).click();
  const right = page.locator(".app-cm.is-right .cm-scroller");
  await expect.poll(() => right.evaluate((element) => element.scrollTop)).toBeGreaterThan(4000);
});

test("turning off synchronised scrolling lets each side scroll alone", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = repoWith(
    workspace,
    "long.txt",
    lines(400),
    lines(400, (n) => (n === 5 ? "changed" : undefined)),
  );
  await startApp({ open: [repo] });
  await open(page, "long.txt");
  await page.getByRole("button", { name: "Collapse Unchanged Fragments" }).click();
  await page.getByRole("button", { name: "Diff settings" }).click();
  await page.getByRole("menuitem", { name: "Synchronize scrolling" }).click();
  await page.locator(".app-cm.is-left .cm-scroller").evaluate((element) => {
    element.scrollTop = 3000;
  });
  await page.waitForTimeout(300);
  expect(
    await page.locator(".app-cm.is-right .cm-scroller").evaluate((element) => element.scrollTop),
  ).toBeLessThan(100);
});

test("the collapse button folds every unchanged part again, in both views", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = repoWith(
    workspace,
    "long.txt",
    lines(80),
    lines(80, (n) => (n === 40 ? "changed" : undefined)),
  );
  await startApp({ open: [repo] });
  await open(page, "long.txt");
  const collapse = page.getByRole("button", { name: "Collapse Unchanged Fragments" });
  for (const viewer of ["Side-by-side", "Unified"]) {
    if (viewer === "Unified") await page.getByRole("button", { name: "Unified viewer" }).click();
    const pane =
      viewer === "Unified"
        ? page.getByRole("region", { name: "Unified diff" })
        : page.getByLabel("After");
    const folds = pane.getByRole("button", { name: /Show \d+ unchanged lines/ });
    await expect(folds).toHaveCount(2);
    await expect(collapse).toHaveAttribute("aria-pressed", "true");
    await folds.first().click();
    await expect(folds).toHaveCount(1);
    await collapse.click();
    await expect(collapse).toHaveAttribute("aria-pressed", "false");
    await expect(folds).toHaveCount(0);
    await expect(pane).toContainText("line 2 stays the same");
    await collapse.click();
    await expect(collapse).toHaveAttribute("aria-pressed", "true");
    await expect(folds).toHaveCount(2);
  }
});
