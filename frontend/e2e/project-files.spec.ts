import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, git, test, type Workspace } from "./fixtures";

function makeProjectRepo(workspace: Workspace): string {
  const repo = workspace.repo("project-browser");

  workspace.write(repo, ".gitignore", "target/\n");
  workspace.write(repo, "target/out.txt", "ignored\n");
  workspace.write(repo, "README.md", "# Project Browser\n\nRendered **Markdown** content.\n");
  workspace.write(
    repo,
    "src/main/resources/application.yml",
    "server: {port: 8080, shutdown: graceful}\n",
  );
  workspace.write(repo, "settings.json", '{"enabled":true,"retries":3}');
  workspace.write(repo, "broken.json", '{"broken": }');
  writeFileSync(join(repo, "raw.bin"), Buffer.from([0, 1, 2, 3, 4]));
  workspace.write(
    repo,
    "src/main/java/ObservationService.java",
    [
      "public class ObservationService {",
      "    public String getLatestObservation(long id)",
      "    {",
      '        return "ok";',
      "    }",
      "}",
      "",
    ].join("\n"),
  );
  workspace.write(
    repo,
    "src/main/java/ObservationController.java",
    [
      "public class ObservationController {",
      "    void handle() {",
      "        service.getLatestObservation(1);",
      "    }",
      "}",
      "",
    ].join("\n"),
  );
  workspace.write(
    repo,
    "src/main/java/ObservationCron.java",
    [
      "public class ObservationCron {",
      "    void tick() {",
      "        service.getLatestObservation(2);",
      "    }",
      "}",
      "",
    ].join("\n"),
  );

  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Initial commit");
  return repo;
}

test("browse project files, render Markdown, pretty-print JSON and YAML, and handle binary files", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = makeProjectRepo(workspace);
  await startApp({ open: [repo] });

  const projectButton = page.getByRole("button", { name: "Project", exact: true });
  await expect(projectButton).toBeVisible();
  await projectButton.click();
  await expect(projectButton).toHaveAttribute("aria-pressed", "true");

  const tree = page.getByRole("tree", { name: "Project files" });
  await expect(tree).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: "target" })).toHaveClass(/is-ignored/);
  await expect(
    tree.getByRole("treeitem", { name: "README.md" }).locator(".dl-ft-markdown"),
  ).toBeVisible();
  await expect(
    tree.getByRole("treeitem", { name: "settings.json" }).locator(".dl-ft-json"),
  ).toBeVisible();

  await tree.getByRole("treeitem", { name: "README.md" }).click();
  const viewer = page.getByRole("region", { name: "File viewer" });
  await expect(viewer.getByRole("heading", { name: "Project Browser" })).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Rendered" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await viewer.getByRole("button", { name: "Raw" }).click();
  await expect(viewer.getByRole("heading", { name: "Project Browser" })).not.toBeVisible();
  await expect(viewer.locator(".cm-content")).toContainText("# Project Browser");

  await tree.getByRole("treeitem", { name: "settings.json" }).click();
  await expect(viewer.getByRole("button", { name: "Pretty" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(viewer.locator(".cm-content")).toContainText('"enabled": true');
  await expect(viewer.locator(".cm-line")).toHaveCount(5);

  await viewer.getByRole("button", { name: "Raw" }).click();
  await expect(viewer.locator(".cm-line")).toHaveCount(1);

  await tree.getByRole("treeitem", { name: "broken.json" }).click();
  await expect(viewer.getByRole("status")).toContainText(
    "Showing raw text because this file could not be formatted",
  );

  await tree.getByRole("treeitem", { name: "src" }).click();
  await tree.getByRole("treeitem", { name: "main" }).click();
  await tree.getByRole("treeitem", { name: "resources" }).click();
  await tree.getByRole("treeitem", { name: "application.yml" }).click();
  await expect(viewer.locator(".cm-content")).toContainText("port: 8080");
  await expect(viewer.locator(".cm-line")).toHaveCount(4);

  await tree.getByRole("treeitem", { name: "raw.bin" }).click();
  await expect(viewer.getByText("Cannot preview this file")).toBeVisible();
});

async function clickSymbol(
  page: Page,
  lineText: string,
  symbol: string,
  modifier: "Meta" | "Control",
) {
  const line = page.locator(".cm-line", { hasText: lineText }).first();
  await expect(line).toBeVisible();
  const box = await line.evaluate((el, target) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const value = node.nodeValue ?? "";
      const idx = value.indexOf(target);
      if (idx >= 0) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + target.length);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }
    return null;
  }, symbol);
  expect(box).not.toBeNull();
  if (!box) return;
  await page.keyboard.down(modifier);
  await page.mouse.click(box.x, box.y);
  await page.keyboard.up(modifier);
}

test("Cmd+Click on macOS opens symbol usages popup and jumps to the selected file", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = makeProjectRepo(workspace);
  await startApp({ open: [repo], platform: "macos" });

  await page.getByRole("button", { name: "Project", exact: true }).click();
  const tree = page.getByRole("tree", { name: "Project files" });
  await tree.getByRole("treeitem", { name: "src" }).click();
  await tree.getByRole("treeitem", { name: "main" }).click();
  await tree.getByRole("treeitem", { name: "java" }).click();
  await tree.getByRole("treeitem", { name: "ObservationService.java" }).click();

  const viewer = page.getByRole("region", { name: "File viewer" });
  await clickSymbol(page, "getLatestObservation(long id)", "getLatestObservation", "Meta");

  const popup = page.getByRole("dialog", { name: "Usages of getLatestObservation" });
  await expect(popup).toBeVisible();
  await expect(popup.getByText("2 usages")).toBeVisible();
  await popup.getByRole("option", { name: /ObservationController\.java/ }).click();

  await expect(viewer.locator(".dl-file-name")).toHaveText("ObservationController.java");
  await expect(viewer.locator(".cm-line.is-target-line")).toContainText("getLatestObservation(1)");
});

test("Ctrl+Click on Windows opens symbol usages popup", async ({ page, workspace, startApp }) => {
  const repo = makeProjectRepo(workspace);
  await startApp({ open: [repo], platform: "windows" });

  await page.getByRole("button", { name: "Project", exact: true }).click();
  const tree = page.getByRole("tree", { name: "Project files" });
  await tree.getByRole("treeitem", { name: "src" }).click();
  await tree.getByRole("treeitem", { name: "main" }).click();
  await tree.getByRole("treeitem", { name: "java" }).click();
  await tree.getByRole("treeitem", { name: "ObservationService.java" }).click();

  await clickSymbol(page, "getLatestObservation(long id)", "getLatestObservation", "Control");

  await expect(page.getByRole("dialog", { name: "Usages of getLatestObservation" })).toBeVisible();
});
