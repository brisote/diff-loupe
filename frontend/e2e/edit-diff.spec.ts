import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, git, test } from "./fixtures";

test("in Local Changes, right pane is editable, deletes with backspace, types, undos, and auto-saves to disk", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = workspace.repo("edit-test-repo");
  workspace.write(repo, "sample.ts", "export const message = 'world';\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Commit with sample");
  workspace.write(repo, "sample.ts", "export const message = 'updated';\n");

  await startApp({ open: [repo] });
  await page.getByRole("tab", { name: "Local changes" }).click();
  await page.getByRole("treeitem", { name: "sample.ts" }).click();

  const diff = page.getByRole("region", { name: "Side-by-side diff" });
  await expect(diff).toBeVisible();

  const leftEditor = diff.locator(".is-left .cm-content");
  await expect(leftEditor).toHaveAttribute("contenteditable", "false");

  const rightEditor = diff.locator(".is-right .cm-content");
  await expect(rightEditor).toHaveAttribute("contenteditable", "true");

  const filePath = join(repo, "sample.ts");

  await rightEditor.click();
  await page.keyboard.press("End");
  await page.keyboard.type("// note");
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => readFileSync(filePath, "utf8")).toContain("// note");

  await page.keyboard.press("Backspace");
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => readFileSync(filePath, "utf8")).toContain("// not");

  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(() => readFileSync(filePath, "utf8"))
    .toBe("export const message = 'updated';\n");

  const revertBtn = page.getByRole("button", { name: "Revert this change" });
  await expect(revertBtn).toBeVisible();
  await revertBtn.click();
  await expect.poll(() => readFileSync(filePath, "utf8")).toBe("export const message = 'world';\n");

  await page.getByRole("tab", { name: "Commit history" }).click();
  await page.getByRole("option", { name: "Commit with sample" }).click();
  await expect(page.locator(".is-right .cm-content")).toHaveAttribute("contenteditable", "false");
});
