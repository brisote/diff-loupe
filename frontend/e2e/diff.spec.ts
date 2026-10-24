import type { Page } from "@playwright/test";
import { expect, git, test, type Workspace } from "./fixtures";

function numbered(count: number, change?: (line: number) => string | null): string {
  const lines: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const replaced = change?.(i);
    if (replaced !== null) lines.push(replaced ?? `line ${i} stays the same`);
  }
  return `${lines.join("\n")}\n`;
}

function repoWith(workspace: Workspace, files: Record<string, [string, string]>): string {
  const repo = workspace.repo("acme-billing");
  for (const [path, [before]] of Object.entries(files)) workspace.write(repo, path, before);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Before");
  for (const [path, [, after]] of Object.entries(files)) workspace.write(repo, path, after);
  return repo;
}

async function showAllLines(page: Page) {
  const toggle = page.getByRole("button", { name: "Collapse Unchanged Fragments" });
  if ((await toggle.getAttribute("aria-pressed")) === "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
}

async function rightTop(page: Page): Promise<number> {
  return page.locator(".app-cm.is-right .cm-scroller").evaluate((element) => element.scrollTop);
}

test("selecting a file shows both versions side by side", async ({ page, workspace, startApp }) => {
  const repo = repoWith(workspace, {
    "src/Main.kt": ["fun main() {\n    val sum = 1\n}\n", "fun main() {\n    val count = 1\n}\n"],
  });
  await startApp({ open: [repo] });
  await page.getByRole("treeitem", { name: "src/Main.kt" }).click();
  const diff = page.getByRole("region", { name: "Side-by-side diff" });
  await expect(diff.getByLabel("Before")).toContainText("val sum = 1");
  await expect(diff.getByLabel("After")).toContainText("val count = 1");
  await expect(diff.locator(".dl-w-mod").first()).toBeVisible();
  await expect(page.getByText("1 difference", { exact: true })).toBeVisible();
  await expect(page.locator(".dl-statusbar")).toContainText("LF");
});

test("F7 visits every difference in order and each block has a connector", async ({
  page,
  workspace,
  startApp,
}) => {
  const before = numbered(300);
  const after = numbered(
    300,
    (line) =>
      (line === 20
        ? "changed near the top"
        : line === 150
          ? null
          : line === 280
            ? "changed near the end"
            : undefined) as string | null,
  );
  const repo = repoWith(workspace, { "notes.txt": [before, after] });
  await startApp({ open: [repo] });
  await page.getByRole("treeitem", { name: "notes.txt" }).click();
  await showAllLines(page);
  await expect(page.getByText("3 differences", { exact: true })).toBeVisible();
  await expect(page.locator("path.dl-conn")).toHaveCount(1);

  const tops: number[] = [await rightTop(page)];
  for (let i = 0; i < 2; i += 1) {
    await page.keyboard.press("F7");
    await expect.poll(() => rightTop(page)).toBeGreaterThan(tops[tops.length - 1] ?? 0);
    tops.push(await rightTop(page));
    await expect(page.locator("path.dl-conn")).toHaveCount(1);
  }
  await expect(page.getByRole("button", { name: "Next Difference F7" })).toBeDisabled();
  await expect(page.getByLabel("After")).toContainText("changed near the end");
  await page.keyboard.press("Shift+F7");
  await expect.poll(() => rightTop(page)).toBeLessThan(tops[2] ?? 0);
});

test("scrolling one side keeps the matching lines level", async ({ page, workspace, startApp }) => {
  const before = numbered(400);
  const after = numbered(
    400,
    (line) =>
      (line === 50 ? `${"inserted\n".repeat(40)}line 50 stays the same` : undefined) as
        | string
        | null,
  );
  const repo = repoWith(workspace, { "long.txt": [before, after] });
  await startApp({ open: [repo] });
  await page.getByRole("treeitem", { name: "long.txt" }).click();
  await showAllLines(page);
  await page.getByLabel("After").waitFor();
  await page.locator(".app-cm.is-left .cm-scroller").evaluate((element) => {
    element.scrollTop = 200 * 20;
  });
  await expect.poll(() => rightTop(page)).toBeGreaterThan(200 * 20 + 30 * 20);
});

test("the file counter moves between files", async ({ page, workspace, startApp }) => {
  const repo = repoWith(workspace, {
    "a.txt": ["one\n", "uno\n"],
    "b.txt": ["two\n", "dos\n"],
    "c.txt": ["three\n", "tres\n"],
  });
  await startApp({ open: [repo] });
  await page.getByRole("treeitem", { name: "a.txt" }).click();
  await expect(page.getByText("1/3 files")).toBeVisible();
  await page.getByRole("button", { name: "Compare Next File" }).click();
  await expect(page.getByText("2/3 files")).toBeVisible();
  await expect(page.locator(".app-editor-tabs")).toContainText("b.txt");
  await expect(page.getByLabel("After")).toContainText("dos");
  await page.getByRole("button", { name: "Compare Previous File" }).click();
  await expect(page.getByText("1/3 files")).toBeVisible();
  await page.getByRole("button", { name: "Close tab" }).click();
  await expect(page.getByText("Select a file to see its changes")).toBeVisible();
});

test("binary files and images have no visual diff", async ({ page, workspace, startApp }) => {
  const repo = repoWith(workspace, {
    "data.bin": ["a\u0000b", "a\u0000c"],
    "invoice-logo.png": ["png-ish", "png-ish, changed"],
  });
  await startApp({ open: [repo] });
  await page.getByRole("treeitem", { name: "invoice-logo.png" }).click();
  await expect(page.getByText("No visual diff for this file type")).toBeVisible();
  await expect(
    page.getByText("invoice-logo.png is an image. Diffloupe compares text files only."),
  ).toBeVisible();
  await page.getByRole("treeitem", { name: "data.bin" }).click();
  await expect(
    page.getByText("data.bin is a binary file. Diffloupe compares text files only."),
  ).toBeVisible();
});

test("a 5,000-line file shows its diff quickly", async ({ page, workspace, startApp }) => {
  const before = numbered(5000);
  const after = numbered(
    5000,
    (line) => (line % 250 === 0 ? `line ${line} was edited` : undefined) as string | null,
  );
  const repo = repoWith(workspace, { "big.txt": [before, after], "small.txt": ["a\n", "b\n"] });
  await startApp({ open: [repo] });
  await page.getByRole("treeitem", { name: "small.txt" }).click();
  await page.getByLabel("After").waitFor();
  await page.waitForTimeout(500);
  await page.evaluate(() => performance.clearMeasures("select-to-diff"));
  await page.getByRole("treeitem", { name: "big.txt" }).click();
  await expect(page.getByText("20 differences", { exact: true })).toBeVisible();
  const took = await page.evaluate(
    () => performance.getEntriesByName("select-to-diff")[0]?.duration ?? -1,
  );
  expect(took).toBeGreaterThan(0);
  expect(took).toBeLessThan(process.env.CI ? 1000 : 100);
});

test("a refresh of the open file keeps the place", async ({ page, workspace, startApp }) => {
  const before = numbered(300);
  const change = (line: number) =>
    (line === 20 ? "first change" : line === 250 ? "second change" : undefined) as string | null;
  const repo = repoWith(workspace, { "notes.txt": [before, numbered(300, change)] });
  await startApp({ open: [repo] });
  await page.getByRole("treeitem", { name: "notes.txt" }).click();
  await showAllLines(page);
  await expect(page.getByText("2 differences", { exact: true })).toBeVisible();
  await page.keyboard.press("F7");
  await expect.poll(() => rightTop(page)).toBeGreaterThan(3000);
  const kept = await rightTop(page);
  workspace.write(
    repo,
    "notes.txt",
    numbered(300, (line) => (line === 299 ? "third change" : change(line)) as string | null),
  );
  await expect(page.getByText("3 differences", { exact: true })).toBeVisible();
  expect(Math.abs((await rightTop(page)) - kept)).toBeLessThan(40);
});

test("Kotlin and the other legacy languages get syntax colours in the frozen window", async ({
  page,
  workspace,
  startApp,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const repo = repoWith(workspace, {
    "src/Totals.kt": [
      "class Totals {\n    fun sum(): Int {\n        return 1\n    }\n}\n",
      "class Totals {\n    fun sum(): Int {\n        return 2\n    }\n}\n",
    ],
    "web/total.ts": ["export const total = 1;\n", "export const total = 2;\n"],
    "cmd/main.go": ["package main\n\nfunc main() {}\n", "package main\n\nfunc main() { }\n"],
    "lib/total.rb": ["def total\n  1\nend\n", "def total\n  2\nend\n"],
    "bin/run.sh": ["if true; then echo 1; fi\n", "if true; then echo 2; fi\n"],
  });
  await startApp({ open: [repo] });
  for (const [path, keyword] of [
    ["src/Totals.kt", "fun"],
    ["web/total.ts", "const"],
    ["cmd/main.go", "func"],
    ["lib/total.rb", "def"],
    ["bin/run.sh", "if"],
  ]) {
    await page.getByRole("treeitem", { name: path }).click();
    const after = page.getByRole("region", { name: "Side-by-side diff" }).getByLabel("After");
    await expect(after.locator(".syn-kw", { hasText: keyword }).first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("connectors meet their blocks when long lines need a horizontal scrollbar", async ({
  page,
  workspace,
  startApp,
}) => {
  const wide = `val note = "${"wide ".repeat(120)}"`;
  const repo = repoWith(workspace, {
    "Wide.kt": [
      numbered(30, (n) => (n === 2 ? wide : `line ${n} stays the same`)),
      numbered(30, (n) =>
        n === 2 ? wide : n === 10 ? "line 10 is new" : `line ${n} stays the same`,
      ),
    ],
  });
  await startApp({ open: [repo] });
  await page.getByRole("treeitem", { name: "Wide.kt" }).click();
  await showAllLines(page);
  const offset = await page.evaluate(() => {
    const path = document.querySelector('[aria-label="Side-by-side diff"] .dl-divider path');
    const block = document.querySelector('[aria-label="After"] .cm-diff-modified');
    return path && block
      ? path.getBoundingClientRect().top - block.getBoundingClientRect().top
      : null;
  });
  expect(offset).not.toBeNull();
  expect(Math.abs(offset ?? 99)).toBeLessThan(1);
  const widths = await page.evaluate(() => {
    const divider = document.querySelector('[aria-label="Side-by-side diff"] .dl-divider');
    const path = divider?.querySelector("path");
    return divider && path
      ? { divider: divider.getBoundingClientRect().width, path: path.getBoundingClientRect().width }
      : null;
  });
  expect(widths).toEqual({ divider: 24, path: 24 });
});
