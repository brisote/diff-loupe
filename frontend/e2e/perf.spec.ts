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

test("scrolling a 20,000-line diff keeps every frame under 50 ms", async ({
  page,
  workspace,
  startApp,
}) => {
  const changed = (n: number) =>
    n % 10 === 0 ? `line ${n} was edited in this version` : undefined;
  const repo = repoWith(workspace, "huge.txt", lines(20000), lines(20000, changed));
  await startApp({ open: [repo] });
  await open(page, "huge.txt");
  await expect(page.getByText("2000 differences", { exact: true })).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => {
    const store = window as unknown as { frameGaps: number[]; frameWatch: boolean };
    store.frameGaps = [];
    store.frameWatch = true;
    let last = performance.now();
    const tick = (now: number) => {
      store.frameGaps.push(now - last);
      last = now;
      if (store.frameWatch) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const scroller = page.locator(".app-cm.is-left .cm-scroller");
  for (let i = 1; i <= 30; i += 1) {
    await scroller.evaluate((element, step) => {
      element.scrollTop = step * 4000;
    }, i);
    await page.waitForTimeout(16);
  }
  const tasks = await page.evaluate(() => {
    const store = window as unknown as { frameGaps: number[]; frameWatch: boolean };
    store.frameWatch = false;
    return store.frameGaps.slice(2);
  });
  expect(await page.locator(".app-cm .cm-line").count()).toBeLessThan(600);
  const marks = await page.locator(".dl-stripe i").count();
  expect(marks).toBeGreaterThan(0);
  expect(marks).toBeLessThan(100);
  if (process.env.CI) return;
  expect(tasks.length).toBeGreaterThan(20);
  expect(tasks.filter((duration) => duration > 50)).toEqual([]);
});
