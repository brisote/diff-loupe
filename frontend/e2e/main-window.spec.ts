import { expect, test } from "./fixtures";

test("the project dropdown lists recent repositories and switches in place", async ({
  page,
  workspace,
  startApp,
}) => {
  const repos = Array.from({ length: 10 }, (_, i) => workspace.repo(`project-${i}`));
  await startApp({ open: repos });
  await expect(page.getByRole("button", { name: "Recent projects" })).toContainText("project-9");

  await page.getByRole("button", { name: "Recent projects" }).click();
  const popup = page.getByRole("dialog", { name: "Recent projects" });
  const list = popup.getByRole("listbox", { name: "Recent projects" });
  await expect(list.getByRole("option")).toHaveCount(10);
  const scrolls = await list.evaluate((element) => element.scrollHeight > element.clientHeight);
  expect(scrolls).toBe(true);
  await expect(popup.getByRole("button", { name: "Open folder" })).toBeVisible();

  await list.getByRole("option", { name: "project-3" }).click();
  await expect(popup).toBeHidden();
  await expect(page.getByRole("button", { name: "Recent projects" })).toContainText("project-3");
  await expect(page.getByRole("heading", { name: "Welcome to Diffloupe" })).toHaveCount(0);
});

test("each repository remembers its tab", async ({ page, workspace, startApp }) => {
  const first = workspace.repo("first");
  const second = workspace.repo("second");
  const app = await startApp({ open: [second, first] });
  await page.getByRole("tab", { name: "Branch log" }).click();
  await expect(page.getByRole("tab", { name: "Branch log" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("button", { name: "Branch log" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "Recent projects" }).click();
  await page.getByRole("option", { name: "second" }).click();
  await expect(page.getByRole("tab", { name: "Changes" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "Recent projects" }).click();
  await page.getByRole("option", { name: "first" }).click();
  await expect(page.getByRole("tab", { name: "Branch log" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await app.restart();
  await expect(page.getByRole("button", { name: "Recent projects" })).toContainText("first");
  await expect(page.getByRole("tab", { name: "Branch log" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("the tool window keeps its width after a restart", async ({ page, workspace, startApp }) => {
  const app = await startApp({ open: [workspace.repo("acme-billing")] });
  const tool = page.getByRole("region", { name: "Tool window" });
  const before = (await tool.boundingBox())?.width ?? 0;
  const splitter = page.getByRole("separator", { name: "Resize the tool window" });
  const box = await splitter.boundingBox();
  if (!box) throw new Error("no splitter");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await tool.boundingBox())?.width ?? 0)
    .toBeGreaterThan(before + 100);
  const after = (await tool.boundingBox())?.width ?? 0;

  await app.restart();
  await expect
    .poll(async () => Math.round((await tool.boundingBox())?.width ?? 0))
    .toBe(Math.round(after));
});

test("settings keep the diff options after a restart", async ({ page, workspace, startApp }) => {
  const app = await startApp({ open: [workspace.repo("acme-billing")] });
  await page.getByRole("button", { name: "Settings menu" }).click();
  await page.getByRole("menuitem", { name: "Settings…" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByLabel("Viewer").selectOption("unified");
  await dialog.getByText("Synchronize scrolling").click();
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(dialog).toBeHidden();

  await app.restart();
  await page.keyboard.press("Meta+Comma");
  await expect(dialog.getByLabel("Viewer")).toHaveValue("unified");
  await expect(dialog.getByRole("checkbox", { name: "Synchronize scrolling" })).not.toBeChecked();
});

test("the settings menu opens About and Uninstall", async ({ page, workspace, startApp }) => {
  const app = await startApp({ open: [workspace.repo("acme-billing")] });
  await page.getByRole("button", { name: "Settings menu" }).click();
  await page.getByRole("menuitem", { name: "About Diffloupe" }).click();
  const about = page.getByRole("dialog", { name: "About Diffloupe" });
  await expect(about).toContainText("It is open source");
  await expect(about).toContainText("check for a new version on diffloupe.com");
  await about.getByRole("button", { name: "Close" }).click();
  await expect(about).toBeHidden();

  await page.getByRole("button", { name: "Settings menu" }).click();
  await page.getByRole("menuitem", { name: "Uninstall Diffloupe…" }).click();
  const uninstall = page.getByRole("dialog", { name: "Uninstall Diffloupe" });
  await expect(uninstall).toContainText("deletes Diffloupe's own files");
  await expect(uninstall.getByRole("list")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(uninstall).toBeHidden();
  expect(await app.bridge.call("devbridge_uninstalled")).toBe(false);

  await page.getByRole("button", { name: "Settings menu" }).click();
  await page.getByRole("menuitem", { name: "Uninstall Diffloupe…" }).click();
  await uninstall.getByRole("button", { name: "Uninstall" }).click();
  await expect(uninstall.getByRole("button", { name: "Uninstalling…" })).toBeDisabled();
  expect(await app.bridge.call("devbridge_uninstalled")).toBe(true);
});
