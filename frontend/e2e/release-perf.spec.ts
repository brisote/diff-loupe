import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const reference = process.env.DL_PERF_REPO;
const fiveK =
  "src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts";
const twentyK = "src/vscode-dts/vscode.d.ts";

test.skip(!reference, "runs only with DL_PERF_REPO set to the reference repository");

type Probe = (arg: string) => boolean;

async function timed(
  page: Page,
  label: string,
  target: number,
  probe: Probe,
  arg: string,
  action: () => Promise<void>,
): Promise<number> {
  await page.evaluate(
    ({ source, value }) => {
      const state = window as unknown as { perfStart: number | null; perfSeen: number | null };
      state.perfStart = null;
      state.perfSeen = null;
      const check = new Function("arg", `return (${source})(arg);`) as Probe;
      document.addEventListener(
        "click",
        (event) => {
          state.perfStart ??= event.timeStamp;
        },
        { capture: true, once: true },
      );
      const tick = () => {
        if (check(value)) state.perfSeen = performance.now();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    { source: probe.toString(), value: arg },
  );
  await action();
  await page.waitForFunction(
    () => (window as unknown as { perfSeen: number | null }).perfSeen !== null,
    null,
    { timeout: 30000 },
  );
  const took = await page.evaluate(() => {
    const state = window as unknown as { perfStart: number | null; perfSeen: number };
    return state.perfSeen - (state.perfStart ?? state.perfSeen);
  });
  report(label, took, target);
  expect.soft(took, label).toBeLessThanOrEqual(target);
  return took;
}

function report(label: string, took: number, target: number) {
  console.log(
    `${took <= target ? "ok  " : "SLOW"} ${label.padEnd(44)} ${took.toFixed(0).padStart(6)} ms (target ${target} ms)`,
  );
}

async function scrollOnce(page: Page, step: number, steps: number): Promise<number> {
  const scroller = page.locator(".app-cm.is-left .cm-scroller");
  await scroller.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const state = window as unknown as { frameGaps: number[]; frameWatch: boolean };
    state.frameGaps = [];
    state.frameWatch = true;
    let last = performance.now();
    const tick = (now: number) => {
      state.frameGaps.push(now - last);
      last = now;
      if (state.frameWatch) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  for (let index = 1; index <= steps; index += 1) {
    await scroller.evaluate((element, at) => {
      element.scrollTop = at;
    }, index * step);
    await page.waitForTimeout(16);
  }
  const gaps = await page.evaluate(() => {
    const state = window as unknown as { frameGaps: number[]; frameWatch: boolean };
    state.frameWatch = false;
    return state.frameGaps.slice(2);
  });
  return Math.max(...gaps);
}

async function slowestFrame(page: Page, step: number, steps: number): Promise<number> {
  const slowest: number[] = [];
  for (let run = 0; run < 3; run += 1) slowest.push(await scrollOnce(page, step, steps));
  return slowest.sort((a, b) => a - b)[1] ?? 0;
}

const changesShown: Probe = () =>
  document.querySelector('[aria-label="Changed files"] [role="treeitem"][aria-level="2"]') !== null;
const diffShown: Probe = (file) =>
  [...document.querySelectorAll(".dl-filehead")].some((head) =>
    head.textContent?.includes(file.split("/").at(-1) ?? file),
  ) && document.querySelector('[aria-label="After"] .cm-line') !== null;
const logShown: Probe = () =>
  document.querySelector('[aria-label="Branch commits"] [role="option"]') !== null;
const countShown: Probe = (count) =>
  document.querySelector(".dl-statusbar")?.textContent?.includes(`${count} changes`) ?? false;

test("speed targets on the reference repository", async ({ page, startApp }) => {
  test.setTimeout(180000);
  const repo = reference ?? "";
  await startApp({ pick: repo });
  await timed(page, "open repository to Changes list", 300, changesShown, "", () =>
    page.getByRole("button", { name: "Open…" }).click(),
  );

  const tree = page.getByRole("tree", { name: "Changed files" });
  await timed(page, "select a 5,000-line file to diff", 100, diffShown, fiveK, () =>
    tree.getByRole("treeitem", { name: fiveK }).click(),
  );
  await timed(page, "Commit history with 500 commits", 150, logShown, "", () =>
    page.getByRole("tab", { name: "Commit history" }).click(),
  );
  await page.getByRole("tab", { name: "Review" }).click();

  await timed(page, "select the 21,000-line file", 250, diffShown, twentyK, () =>
    tree.getByRole("treeitem", { name: twentyK }).click(),
  );
  const collapse = page.getByRole("button", { name: "Collapse Unchanged Fragments" });
  if ((await collapse.getAttribute("aria-pressed")) === "true") await collapse.click();
  const wheel = await slowestFrame(page, 400, 60);
  report("slowest frame, wheel scrolling (median of 3)", wheel, 50);
  expect.soft(wheel, "wheel scroll frames").toBeLessThanOrEqual(50);
  report("slowest frame, scrollbar drag (median of 3)", await slowestFrame(page, 4000, 40), 50);

  const probe = join(repo, "README.md");
  const original = readFileSync(probe, "utf8");
  const before = await page.locator(".dl-statusbar").textContent();
  const listed = Number(before?.match(/(\d+) changes/)?.[1] ?? 0);
  try {
    await timed(
      page,
      "an edited file shows in Changes",
      1000,
      countShown,
      String(listed + 1),
      async () => {
        await page.evaluate(() => {
          (window as unknown as { perfStart: number }).perfStart = performance.now();
        });
        writeFileSync(probe, `${original}\nedited by the speed check\n`);
      },
    );
  } finally {
    writeFileSync(probe, original);
  }
});
