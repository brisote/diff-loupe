import type { Page } from "@playwright/test";
import { type App, expect, test } from "./fixtures";

const day = 24 * 60 * 60 * 1000;
const start = new Date(2026, 9, 1, 10).getTime();
const repository = "https://github.com/brisote/diff-loupe";

function dayOf(time: number) {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function seed(page: Page, app: App) {
  await expect(page.getByRole("button", { name: "Settings menu" })).toBeVisible();
  await expect
    .poll(async () => app.bridge.call("get_ui_value", { key: "star.prompt" }), { timeout: 10_000 })
    .toContain('"days":1');
  await app.bridge.call("set_ui_value", { key: "star.prompt", value: sixDays });
}

async function startedOn(app: App, time: number) {
  await expect
    .poll(async () => app.bridge.call("get_ui_value", { key: "star.prompt" }))
    .toContain(`"lastDay":"${dayOf(time)}"`);
}

const sixDays = JSON.stringify({
  days: 6,
  lastDay: dayOf(start - day),
  declined: 0,
  declinedAt: null,
  done: false,
});

test("the star prompt comes after seven days, once more after Not now, then never", async ({
  page,
  workspace,
  startApp,
}) => {
  await page.clock.setFixedTime(start - day);
  const app = await startApp({ open: [workspace.repo("acme-billing")] });
  await seed(page, app);
  const prompt = page.getByRole("status").filter({ hasText: "Give us a star on GitHub." });

  await page.clock.setFixedTime(start);
  await app.restart();
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Not now" }).click();
  await expect(prompt).toBeHidden();

  await page.clock.setFixedTime(start + 29 * day);
  await app.restart();
  await startedOn(app, start + 29 * day);
  await expect(prompt).toBeHidden();

  await page.clock.setFixedTime(start + 31 * day);
  await app.restart();
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Not now" }).click();
  await expect(prompt).toBeHidden();

  await page.clock.setFixedTime(start + 400 * day);
  await app.restart();
  await startedOn(app, start + 400 * day);
  await expect(prompt).toBeHidden();
  expect(
    JSON.parse(String(await app.bridge.call("get_ui_value", { key: "star.prompt" }))).done,
  ).toBe(true);
});

test("Star on GitHub opens the repository and ends the prompts", async ({
  page,
  workspace,
  startApp,
}) => {
  await page.clock.setFixedTime(start - day);
  const app = await startApp({ open: [workspace.repo("acme-billing")] });
  await seed(page, app);
  await page.clock.setFixedTime(start);
  await app.restart();
  const prompt = page.getByRole("status").filter({ hasText: "Give us a star on GitHub." });
  await prompt.getByRole("button", { name: "Star on GitHub" }).click();
  await expect(prompt).toBeHidden();
  await expect.poll(() => app.bridge.call("devbridge_opened")).toEqual([repository]);
  await page.clock.setFixedTime(start + 400 * day);
  await app.restart();
  await startedOn(app, start + 400 * day);
  await expect(prompt).toBeHidden();
});

test("Star on GitHub in the settings menu also ends the prompts", async ({
  page,
  workspace,
  startApp,
}) => {
  await page.clock.setFixedTime(start - day);
  const app = await startApp({ open: [workspace.repo("acme-billing")] });
  await seed(page, app);
  await page.getByRole("button", { name: "Settings menu" }).click();
  await page.getByRole("menuitem", { name: "Star on GitHub" }).click();
  await expect.poll(() => app.bridge.call("devbridge_opened")).toEqual([repository]);
  await page.clock.setFixedTime(start);
  await app.restart();
  await startedOn(app, start);
  await expect(page.getByText("Give us a star on GitHub.")).toBeHidden();
});
