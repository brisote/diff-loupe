import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, git, test } from "./fixtures";
import { markdownRepo } from "./markdownRepo";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("a Markdown file shows rendered side by side, inline and raw", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = markdownRepo(workspace);
  await startApp({ open: [repo] });
  await page.getByRole("treeitem", { name: "README.md" }).click();
  const rendered = page.getByRole("region", { name: "Rendered side-by-side diff" });
  await expect(rendered).toBeVisible();
  await expect(rendered.getByRole("heading", { name: "How totals are rounded" })).toHaveCount(2);
  await expect(rendered.locator("del")).toContainText(["half-up", "1234.5", "all"]);
  await expect(rendered.locator("ins")).toContainText(["half-even", "1234.50", "skip-empty"]);
  await expect(rendered.locator(".is-inserted li")).toHaveText(
    "Empty invoices are skipped, see export notes.",
  );
  await expect(page.getByText("4 differences", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Unified viewer" }).click();
  const inline = page.getByRole("region", { name: "Rendered inline diff" });
  await expect(inline.locator("del")).toContainText(["half-up"]);
  await expect(inline.locator("ins")).toContainText(["half-even"]);

  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await expect(page.getByRole("region", { name: "Side-by-side diff" })).toBeVisible();
  await page.getByRole("button", { name: "Unified viewer" }).click();
  await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();
  await page.getByRole("button", { name: "Side-by-side viewer" }).click();
  await page.getByRole("button", { name: "Rendered", exact: true }).click();
  await expect(rendered).toBeVisible();
});

test("F7 walks the changed blocks and images load from the repository", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = markdownRepo(workspace);
  workspace.write(repo, "docs/.keep", "");
  writeFileSync(join(repo, "docs/shot.png"), Buffer.from(png, "base64"));
  git(repo, "add", "docs/shot.png", "docs/.keep");
  git(repo, "commit", "-q", "-m", "Add a screenshot");
  workspace.write(
    repo,
    "docs/guide.md",
    "# Guide\n\n![shot](shot.png)\n\n![remote](https://example.com/x.png)\n",
  );
  await startApp({ open: [repo] });
  await page.getByRole("treeitem", { name: "README.md" }).click();
  const rendered = page.getByRole("region", { name: "Rendered side-by-side diff" });
  await expect(rendered).toBeVisible();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("F7");
  await expect(rendered.locator('[data-row="8"]')).toBeInViewport();
  await page.keyboard.press("Shift+F7");
  await page.getByRole("treeitem", { name: "docs/guide.md" }).click();
  await expect(rendered.locator("img")).toHaveAttribute("src", `data:image/png;base64,${png}`);
  await expect(rendered.getByText("[remote]")).toHaveAttribute(
    "title",
    "Remote image not loaded: https://example.com/x.png",
  );
});

test("the Rendered and Raw buttons switch one file, and commits render too", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = markdownRepo(workspace);
  workspace.write(repo, "CHANGELOG.md", "# Changes\n\n- First\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Round half-even and add a changelog");
  workspace.write(repo, "CHANGELOG.md", "# Changes\n\n- First\n- Second\n");
  workspace.write(repo, "README.md", "# acme-billing\n\nRewritten.\n");
  await startApp({ open: [repo] });
  await page.getByRole("treeitem", { name: "README.md" }).click();
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await expect(page.getByRole("region", { name: "Side-by-side diff" })).toBeVisible();
  await page.getByRole("treeitem", { name: "CHANGELOG.md" }).click();
  await expect(page.getByRole("region", { name: "Rendered side-by-side diff" })).toBeVisible();

  await page.getByRole("tab", { name: "Branch log" }).click();
  await page.getByRole("option", { name: /Round half-even and add a changelog/ }).click();
  await page
    .getByRole("listbox", { name: "Changed files" })
    .getByRole("option", { name: "README.md" })
    .click();
  await expect(page.getByRole("region", { name: "Side-by-side diff" })).toBeVisible();
  await page.getByRole("button", { name: "Rendered", exact: true }).click();
  const rendered = page.getByRole("region", { name: "Rendered side-by-side diff" });
  await expect(rendered.locator("del").first()).toContainText("half-up");
  await expect(rendered.locator("ins").first()).toContainText("half-even");
});

test("a changed code span shows the change colour, not the code background", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = workspace.repo("acme-billing");
  workspace.write(repo, "NOTES.md", "# Jobs\n\nStart `OldExportWorkflow` from the console.\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Notes");
  workspace.write(repo, "NOTES.md", "# Jobs\n\nStart `NewExportWorkflow` from the console.\n");
  await startApp({ open: [repo] });
  await page.getByRole("treeitem", { name: "NOTES.md" }).click();
  const rendered = page.getByRole("region", { name: "Rendered side-by-side diff" });
  for (const mark of ["ins", "del"]) {
    const code = rendered.locator(`${mark} code`).first();
    await expect(code).toBeVisible();
    const colours = await code.evaluate((element) => ({
      code: getComputedStyle(element).backgroundColor,
      mark: getComputedStyle(element.closest("ins, del") as Element).backgroundColor,
    }));
    expect(colours.code, mark).toBe("rgba(0, 0, 0, 0)");
    expect(colours.mark, mark).not.toBe("rgba(0, 0, 0, 0)");
  }
});

test("a moved file with the same contents says so and shows its text", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = workspace.repo("acme-billing");
  const body = Array.from({ length: 40 }, (_, i) => `- Rule ${i + 1} for test names.`).join("\n");
  workspace.write(repo, "standards/testing/naming.md", `# Test naming\n\n${body}\n`);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Standards");
  git(repo, "switch", "-q", "-c", "gs/move-patterns");
  git(repo, "mv", "standards", "patterns");
  git(repo, "commit", "-q", "-m", "Move the standards");
  await startApp({ open: [repo] });
  await page.getByRole("treeitem", { name: "patterns/testing/naming.md" }).click();
  const notice = page.getByRole("status").filter({ hasText: "contents are identical" });
  await expect(notice).toHaveText(
    "Moved from standards/testing/naming.md. The contents are identical.",
  );
  await expect(page.getByRole("heading", { name: "Test naming" })).toHaveCount(2);

  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await expect(notice).toBeVisible();
  const diff = page.getByRole("region", { name: "Side-by-side diff" });
  await expect(diff.getByLabel("Before")).toContainText("Rule 20 for test names.");
  await expect(diff.getByLabel("After")).toContainText("Rule 20 for test names.");
});

test("a run of new or removed blocks shows one line on the other side", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = workspace.repo("acme-billing");
  workspace.write(
    repo,
    "API.md",
    "# API\n\n## Rate limits\n\nOne hundred requests a minute.\n\n## Errors\n\nErrors are JSON.\n",
  );
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "API notes");
  workspace.write(
    repo,
    "API.md",
    "# API\n\n## Idempotency\n\nSend an Idempotency-Key header.\n\n- Keys expire after a day.\n- Use one key per payment.\n\n## Errors\n\nErrors are JSON.\n",
  );
  await startApp({ open: [repo] });
  await page.getByRole("treeitem", { name: "API.md" }).click();
  const rendered = page.getByRole("region", { name: "Rendered side-by-side diff" });
  await expect(rendered.getByRole("heading", { name: "Idempotency" })).toBeVisible();
  await expect(rendered.locator(".app-md-gap.is-inserted")).toHaveCount(1);
  await expect(rendered.locator(".app-md-gap.is-deleted")).toHaveCount(1);
});
