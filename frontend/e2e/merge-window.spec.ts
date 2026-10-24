import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, git, test, type Workspace } from "./fixtures";

const base = "a\nb\nc\nd\ne\nf\ng\nh\n";
const ours = "a\nB-ours\nc\nd\ne\nours-new\nf\ng\nh\n";
const theirs = "a\nB-theirs\nc\nd\ne\nf\ng\nH-theirs\n";

function conflicting(workspace: Workspace): string {
  const repo = workspace.repo("acme-billing");
  workspace.write(repo, "A.kt", base);
  workspace.write(repo, "B.kt", "one\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Base");
  git(repo, "switch", "-q", "-c", "gs/invoice-export");
  workspace.write(repo, "A.kt", ours);
  workspace.write(repo, "B.kt", "ours\n");
  git(repo, "commit", "-q", "-am", "Ours");
  git(repo, "switch", "-q", "main");
  workspace.write(repo, "A.kt", theirs);
  workspace.write(repo, "B.kt", "theirs\n");
  git(repo, "commit", "-q", "-am", "Theirs");
  git(repo, "switch", "-q", "gs/invoice-export");
  return repo;
}

async function mergeMain(page: Page) {
  await page.getByRole("button", { name: "Current branch" }).click();
  await page.getByRole("menuitem", { name: "Merge main into gs/invoice-export" }).click();
}

const result = (page: Page) => page.getByRole("textbox", { name: "Result" });

test("the merge window accepts chunks, applies the rest, takes edits and opens the next file", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = conflicting(workspace);
  await startApp({ open: [repo] });
  await mergeMain(page);
  await page
    .getByRole("dialog", { name: "Conflicts" })
    .getByRole("button", { name: "Merge…" })
    .click();
  const window = page.getByRole("dialog", { name: "Merge Revisions" });
  await expect(window).toContainText("Merge Revisions for A.kt");
  await expect(window.getByRole("status", { name: "Changes left" })).toHaveText(
    "2 changes · 1 conflict",
  );
  await expect(result(page)).toHaveText("abcdefgh");

  await window.getByRole("button", { name: "Accept left change" }).first().click();
  await expect(result(page)).toContainText("B-ours");
  await result(page).click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(result(page)).toHaveText("abcdefgh");
  await expect(window.getByRole("status", { name: "Changes left" })).toHaveText(
    "2 changes · 1 conflict",
  );
  await result(page).getByText("b", { exact: true }).click();
  await page.keyboard.type("x");
  await expect(window.getByRole("status", { name: "Changes left" })).toHaveText(
    "2 changes · 0 conflicts",
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect(window.getByRole("status", { name: "Changes left" })).toHaveText(
    "2 changes · 1 conflict",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Discard merge changes" })).toHaveCount(0);
  await page
    .getByRole("dialog", { name: "Conflicts" })
    .getByRole("button", { name: "Merge…" })
    .click();
  await expect(result(page)).toHaveText("abcdefgh");

  await window.getByRole("button", { name: "Accept left change" }).first().click();
  await expect(result(page)).toContainText("B-ours");
  await window.getByRole("button", { name: "Accept right change" }).first().click();
  await expect(window.getByRole("status", { name: "Changes left" })).toHaveText(
    "2 changes · 0 conflicts",
  );
  await result(page).click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(result(page)).toContainText("B-ours");
  await expect(result(page)).not.toContainText("B-theirs");
  await window.getByRole("button", { name: "Accept right change" }).first().click();
  await expect(window.getByRole("status", { name: "Changes left" })).toHaveText(
    "2 changes · 0 conflicts",
  );
  await page.keyboard.press("Escape");
  const discard = page.getByRole("dialog", { name: "Discard merge changes" });
  await discard.getByRole("button", { name: "Keep Editing" }).click();
  await expect(window).toBeVisible();
  await window.getByRole("button", { name: "Apply All Non-Conflicting Changes" }).click();
  await expect(window.getByRole("status", { name: "Changes left" })).toHaveText(
    "All changes are processed",
  );
  await expect(window.getByRole("button", { name: /Accept (left|right) change/ })).toHaveCount(0);

  await result(page).getByText("ours-new").click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await window.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(window).toContainText("Merge Revisions for B.kt");
  expect(readFileSync(join(repo, "A.kt"), "utf8")).toBe(
    "a\nB-ours\nB-theirs\nc\nd\ne\nours-new!\nf\ng\nH-theirs\n",
  );
  expect(git(repo, "diff", "--cached", "--name-only")).toContain("A.kt");

  await expect(window.getByRole("status", { name: "Changes left" })).toHaveText(
    "0 changes · 1 conflict",
  );
  await window.getByRole("button", { name: "Apply", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Apply with unresolved changes" });
  await expect(confirm).toContainText("Not resolved yet: 1 conflict.");
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(window).toContainText("Merge Revisions for B.kt");
  await window.getByRole("button", { name: "Apply", exact: true }).click();
  await confirm.getByRole("button", { name: "Apply Anyway" }).click();
  await expect(window).toHaveCount(0);
  await expect(page.locator(".app-editor-notice .dl-banner")).toHaveText(
    /All conflicts are resolved/,
  );
  expect(readFileSync(join(repo, "B.kt"), "utf8")).toBe("one\n");
});

test("a conflicted file opens the same view in the editor", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = conflicting(workspace);
  await startApp({ open: [repo] });
  await mergeMain(page);
  await page
    .getByRole("dialog", { name: "Conflicts" })
    .getByRole("button", { name: "Close" })
    .click();
  await page.getByRole("treeitem", { name: "B.kt" }).click();
  const editor = page.getByRole("region", { name: "Editor" });
  await expect(editor.getByRole("region", { name: "Merge" })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await editor.getByRole("button", { name: "Accept right change" }).click();
  await expect(result(page)).toHaveText("theirs");
  await editor.getByRole("button", { name: "Ignore left change" }).click();
  await expect(editor.getByRole("status", { name: "Changes left" })).toHaveText(
    "All changes are processed",
  );
  await result(page).click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor.getByRole("status", { name: "Changes left" })).toHaveText(
    "0 changes · 1 conflict",
  );
  await expect(result(page)).toHaveText("theirs");
  await editor.getByRole("button", { name: "Ignore left change" }).click();
  await editor.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(editor.getByRole("region", { name: "Merge" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "A.kt" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await editor.getByRole("button", { name: "Accept Left", exact: true }).click();
  await expect(page.locator(".app-editor-notice .dl-banner")).toHaveText(
    /All conflicts are resolved/,
  );
  expect(readFileSync(join(repo, "A.kt"), "utf8")).toBe(ours);
  expect(readFileSync(join(repo, "B.kt"), "utf8")).toBe("theirs\n");
});

test("a failed accept shows git's error and keeps the merge window open", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = conflicting(workspace);
  await startApp({ open: [repo] });
  await mergeMain(page);
  await page
    .getByRole("dialog", { name: "Conflicts" })
    .getByRole("button", { name: "Merge…" })
    .click();
  const window = page.getByRole("dialog", { name: "Merge Revisions" });
  await expect(window).toContainText("Merge Revisions for A.kt");
  writeFileSync(join(repo, ".git", "index.lock"), "");
  await window.getByRole("button", { name: "Accept Left", exact: true }).click();
  await expect(window.getByRole("alert")).toContainText("index.lock");
  await expect(window).toContainText("Merge Revisions for A.kt");
  expect(readFileSync(join(repo, "A.kt"), "utf8")).toContain("<<<<<<<");
});

test("simple conflicts resolve with one click and binary files offer whole sides", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = workspace.repo("acme-billing");
  workspace.write(repo, "Totals.kt", "val total = round(sum, 2)\n");
  writeFileSync(join(repo, "logo.bin"), Buffer.from([0, 1, 2]));
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Base");
  git(repo, "switch", "-q", "-c", "gs/invoice-export");
  workspace.write(repo, "Totals.kt", "val total = round(sum, 4)\n");
  writeFileSync(join(repo, "logo.bin"), Buffer.from([0, 1, 3]));
  git(repo, "commit", "-q", "-am", "Ours");
  git(repo, "switch", "-q", "main");
  workspace.write(repo, "Totals.kt", "val grand = round(sum, 2)\n");
  writeFileSync(join(repo, "logo.bin"), Buffer.from([0, 1, 4]));
  git(repo, "commit", "-q", "-am", "Theirs");
  git(repo, "switch", "-q", "gs/invoice-export");
  await startApp({ open: [repo] });
  await mergeMain(page);
  await page
    .getByRole("dialog", { name: "Conflicts" })
    .getByRole("button", { name: "Close" })
    .click();

  await page.getByRole("treeitem", { name: "Totals.kt" }).click();
  const editor = page.getByRole("region", { name: "Editor" });
  await editor.getByRole("button", { name: "Resolve Simple Conflicts" }).click();
  await expect(result(page)).toHaveText("val grand = round(sum, 4)");
  await expect(editor.getByRole("status", { name: "Changes left" })).toHaveText(
    "All changes are processed",
  );

  await page.getByRole("treeitem", { name: "logo.bin" }).click();
  await expect(editor).toContainText("logo.bin is a binary file");
  await editor.getByRole("button", { name: "Accept Theirs" }).click();
  await expect(page.getByRole("treeitem", { name: "Totals.kt" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect([...readFileSync(join(repo, "logo.bin"))]).toEqual([0, 1, 4]);
});
