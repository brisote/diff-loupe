import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { designRepo, mergeRepo, withBranches } from "./designRepo";
import { expect, git, isolate, test } from "./fixtures";
import { logNow, logRepo } from "./logRepo";
import { markdownRepo, readmeAfter, readmeBefore } from "./markdownRepo";

test.skip(!process.env.DL_SCREENS, "screens are captured only with DL_SCREENS=1");

const out = join("target", "screens");

async function shoot(page: Page, name: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(out, `${name}-${colorScheme}.png`) });
  }
}

test("welcome screens", async ({ page, workspace, startApp }) => {
  const invoices = workspace.repo("invoices");
  const payments = workspace.repo("payments-api");
  const loupe = workspace.repo("diff-loupe", "gs/diffloupe");
  const billing = workspace.repo("acme-billing", "gs/invoice-export");
  const app = await startApp({ open: [invoices, payments, loupe, billing] });
  rmSync(billing, { recursive: true, force: true });
  await app.restart({ pick: invoices });
  await shoot(page, "Main");
  rmSync(join(invoices, ".git"), { recursive: true, force: true });
  await page.getByRole("button", { name: "Open…" }).click();
  await page.getByRole("alert").waitFor();
  await shoot(page, "WelcomeError");
});

test("main window screens", async ({ page, workspace, startApp }) => {
  const names = [
    "design-tokens",
    "reporting-jobs",
    "notifications-service",
    "customer-api",
    "tax-rules",
  ];
  const others = names.map((name) => workspace.repo(name));
  const billing = designRepo(workspace);
  await startApp({
    open: [
      ...others,
      workspace.repo("payments-api"),
      workspace.repo("diff-loupe", "gs/diffloupe"),
      billing,
    ],
  });
  await page.getByRole("button", { name: "Recent projects" }).waitFor();
  await page.getByRole("treeitem", { name: /InvoiceExporter.kt/ }).click();
  await page.getByRole("region", { name: "Side-by-side diff" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "Changes");
  await page.getByRole("button", { name: "Unified viewer" }).click();
  await page.getByRole("region", { name: "Unified diff" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "Unified");
  await page.getByRole("button", { name: "Diff settings" }).click();
  await shoot(page, "DiffSettings");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Side-by-side viewer" }).click();

  await page.getByRole("button", { name: "Recent projects" }).click();
  await shoot(page, "ProjectSwitcher");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Settings menu" }).click();
  await shoot(page, "SettingsMenu");
  await page.getByRole("menuitem", { name: "About Diffloupe" }).click();
  await shoot(page, "About");
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.keyboard.press("Meta+Comma");
  await shoot(page, "SettingsDiff");
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Settings menu" }).click();
  await page.getByRole("menuitem", { name: "Uninstall Diffloupe…" }).click();
  await shoot(page, "Uninstall");

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Recent projects" }).click();
  await page.getByRole("option", { name: "payments-api" }).click();
  await page.getByText("No changes", { exact: true }).first().waitFor();
  await shoot(page, "NoChanges");
});

test("local changes screen", async ({ page, workspace, startApp }) => {
  const billing = designRepo(workspace);
  await startApp({ open: [billing] });
  await page.getByRole("tab", { name: "Local changes" }).click();
  await page.getByRole("treeitem", { name: /InvoiceExporter.kt/ }).click();
  await page.getByRole("region", { name: "Side-by-side diff" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "LocalChanges");
});

test("branch log screens", async ({ page, workspace, startApp }) => {
  const billing = logRepo(workspace);
  await page.clock.setFixedTime(logNow);
  await startApp({ open: [billing] });
  await page.getByRole("tab", { name: "Commit history" }).click();
  await page.getByRole("option", { name: /Round totals/ }).click();
  await page.getByRole("button", { name: "Compare Next File" }).click();
  await page.getByRole("region", { name: "Side-by-side diff" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "BranchLog");
});

test("git action screens", async ({ page, workspace, startApp }) => {
  const billing = designRepo(workspace);
  const remote = withBranches(workspace, billing);
  await startApp({ open: [billing] });
  await page.getByRole("button", { name: "Recent projects" }).waitFor();
  await page.getByRole("button", { name: "Current branch" }).click();
  await page.getByRole("dialog", { name: "Branches" }).waitFor();
  await page.waitForTimeout(200);
  await shoot(page, "BranchPicker");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Target branch" }).click();
  await page.getByRole("dialog", { name: "Target branch" }).waitFor();
  await page.waitForTimeout(200);
  await shoot(page, "TargetPicker");
  await page.keyboard.press("Escape");
  await page.getByRole("treeitem", { name: /InvoiceExporter.kt/ }).click();
  await page.keyboard.press("Meta+k");
  const dialog = page.getByRole("dialog", { name: "Commit Changes" });
  await dialog.getByRole("checkbox", { name: "README.md" }).uncheck({ force: true });
  await dialog
    .getByRole("textbox", { name: "Commit message" })
    .fill(
      "Skip empty invoices before export\n\nThe CSV writer failed on invoices without lines. Empty invoices are now\ndropped, and an export with nothing to write returns 0 instead of throwing.",
    );
  await page.waitForTimeout(300);
  await shoot(page, "CommitDialog");
  await dialog.getByRole("button", { name: "Commit and Push" }).click();
  await page.getByRole("status").filter({ hasText: "Pushed" }).waitFor();
  await shoot(page, "PushDone");
  const other = join(workspace.dir, "other");
  git(workspace.dir, "clone", "-q", "-b", "gs/invoice-export", remote, other);
  isolate(other);
  for (const name of ["x.md", "y.md"]) {
    workspace.write(other, name, "x\n");
    git(other, "add", "-A");
    git(other, "commit", "-q", "-m", name);
  }
  git(other, "push", "-q");
  workspace.write(billing, "web/src/invoices/exportButton.tsx", "export const button = 1;\n");
  git(billing, "commit", "-q", "-am", "Tweak the button");
  await page.keyboard.press("Meta+Shift+k");
  await page.getByRole("status").filter({ hasText: "Push rejected" }).waitFor();
  await shoot(page, "PushRejected");
});

test("terminal screens", async ({ page, workspace, startApp }) => {
  const billing = designRepo(workspace);
  await startApp({ open: [billing] });
  await page.getByRole("treeitem", { name: /InvoiceExporter.kt/ }).click();
  await page.getByRole("region", { name: "Side-by-side diff" }).waitFor();
  await page.getByRole("button", { name: "Terminal ⌥F12" }).click();
  await page.locator(".app-terminal-screen:not([hidden]) .xterm").click();
  await page.keyboard.type("clear; git status --short -uall");
  await page.keyboard.press("Enter");
  await page.locator(".xterm-rows").getByText("export-notes.md").waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "Terminal");
});

test("markdown screens", async ({ page, workspace, startApp }) => {
  const billing = markdownRepo(workspace);
  await startApp({ open: [billing] });
  await page.getByRole("treeitem", { name: "README.md" }).click();
  await page.getByRole("region", { name: "Rendered side-by-side diff" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "MarkdownRendered");
  await page.getByRole("button", { name: "Unified viewer" }).click();
  await page.getByRole("region", { name: "Rendered inline diff" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "MarkdownInline");
  await page.getByRole("button", { name: "Side-by-side viewer" }).click();
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await page.getByRole("region", { name: "Side-by-side diff" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "MarkdownRaw");
});

test("markdown run screens", async ({ page, workspace, startApp }) => {
  const billing = workspace.repo("acme-billing");
  workspace.write(
    billing,
    "README.md",
    `${readmeBefore}
## Retries

A failed export is retried three times, five minutes apart.
`,
  );
  git(billing, "add", "-A");
  git(billing, "commit", "-q", "-m", "Document the billing rules");
  git(billing, "switch", "-q", "-c", "gs/invoice-export");
  workspace.write(
    billing,
    "README.md",
    `${readmeAfter}
## Schedule

Exports run every night at 02:00 in the account's time zone.

- Empty days are skipped.
- A late invoice joins the next export.
`,
  );
  await startApp({ open: [billing] });
  await page.getByRole("treeitem", { name: "README.md" }).click();
  await page.getByRole("region", { name: "Rendered side-by-side diff" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "MarkdownRuns");
});

test("merge screens", async ({ page, workspace, startApp }) => {
  const repo = mergeRepo(workspace);
  await startApp({ open: [repo] });
  await page.getByRole("button", { name: "Current branch" }).click();
  await page.waitForTimeout(300);
  await shoot(page, "BranchPicker");
  await page.getByRole("menuitem", { name: "Merge origin/main into gs/invoice-export" }).click();
  const dialog = page.getByRole("dialog", { name: "Conflicts" });
  await dialog.waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "ConflictsDialog");
  await dialog.getByRole("button", { name: "Merge…" }).click();
  const window = page.getByRole("dialog", { name: "Merge Revisions" });
  await window.getByRole("textbox", { name: "Result" }).waitFor();
  await page.waitForTimeout(500);
  await shoot(page, "MergeWindow");
  await window.getByRole("button", { name: "Cancel" }).click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("treeitem", { name: /InvoiceExporter.kt/ }).click();
  await page.getByRole("textbox", { name: "Result" }).waitFor();
  await page.waitForTimeout(500);
  await shoot(page, "MergeBanner");
  await page.locator(".app-editor-notice").getByRole("button", { name: "Resolve" }).click();
  for (const option of (await dialog.getByRole("option").all()).slice(1))
    await option.click({ modifiers: ["Meta"] });
  await dialog.getByRole("button", { name: "Accept Yours" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.locator(".app-editor-notice").getByRole("button", { name: "Commit merge" }).click();
  await page.getByRole("dialog", { name: "Commit Merge" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "MergeCommit");
});

test("merge blocked screen", async ({ page, workspace, startApp }) => {
  const repo = mergeRepo(workspace);
  workspace.write(repo, "billing/src/main/kotlin/acme/billing/InvoiceExporter.kt", "local\n");
  workspace.write(repo, "billing/src/main/kotlin/acme/billing/TotalsCalculator.kt", "local\n");
  await startApp({ open: [repo] });
  await page.getByRole("button", { name: "Current branch" }).click();
  await page.getByRole("menuitem", { name: "Merge origin/main into gs/invoice-export" }).click();
  await page.locator(".app-editor-notice").getByRole("button", { name: "Show files" }).click();
  await page.waitForTimeout(300);
  await shoot(page, "MergeBlocked");
});

test("star prompt screen", async ({ page, workspace, startApp }) => {
  const billing = designRepo(workspace);
  const app = await startApp({ open: [billing] });
  await page.getByRole("button", { name: "Settings menu" }).waitFor();
  await expect
    .poll(async () => app.bridge.call("get_ui_value", { key: "star.prompt" }))
    .not.toBeNull();
  await app.bridge.call("set_ui_value", {
    key: "star.prompt",
    value: JSON.stringify({
      days: 7,
      lastDay: "2000-01-01",
      declined: 0,
      declinedAt: null,
      done: false,
    }),
  });
  await app.restart();
  await page.getByRole("status").filter({ hasText: "Give us a star on GitHub." }).waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "StarPrompt");
});

test("error report screen", async ({ page, workspace, startApp }) => {
  const billing = designRepo(workspace);
  const app = await startApp({ open: [billing] });
  await page.getByRole("treeitem", { name: /InvoiceExporter.kt/ }).click();
  await page.getByRole("region", { name: "Side-by-side diff" }).waitFor();
  await app.bridge.call("devbridge_fail_next", {
    command: "set_repo_view",
    code: "store",
    message: "storage failed: database is locked",
  });
  await page.getByRole("tab", { name: "Commit history" }).click();
  await page.getByRole("dialog", { name: "Diffloupe ran into a problem" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "ErrorReport");
});

test("ai review screens", async ({ page, workspace, startApp }) => {
  let currentBalance = "0.00";
  let releaseStream: (() => void) | null = null;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const method = req.method ?? "GET";

    if (method === "POST" && url.pathname === "/v1/auth/device") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          device_code: "dc_test",
          user_code: "CODE-1234",
          verification_url: `http://${req.headers.host}/verify`,
          expires_in: 300,
          poll_interval_ms: 50,
        }),
      );
      return;
    }

    if (method === "POST" && url.pathname === "/v1/auth/token") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "authorized",
          access_token: "tok_test_access",
          account: {
            id: "usr_ada",
            email: "ada@example.com",
            balance_usd: currentBalance,
          },
        }),
      );
      return;
    }

    if (method === "GET" && url.pathname === "/v1/account") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "usr_ada",
          email: "ada@example.com",
          balance_usd: currentBalance,
        }),
      );
      return;
    }

    if (method === "GET" && url.pathname === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          models: [
            { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet" },
            { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet" },
          ],
          efforts: [
            { id: "low", name: "Low" },
            { id: "medium", name: "Medium" },
            { id: "high", name: "High" },
          ],
          default_model: "claude-3-5-sonnet",
          default_effort: "medium",
        }),
      );
      return;
    }

    if (
      method === "POST" &&
      (url.pathname === "/v1/billing/checkout-session" || url.pathname === "/v1/billing/checkout")
    ) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          checkout_url: `http://${req.headers.host}/checkout`,
        }),
      );
      return;
    }

    if (method === "POST" && url.pathname === "/v1/reviews/stream") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "close",
      });
      res.write(
        'event: stage\ndata: {"stage":"analyzing","message":"Analyzing branch changes…"}\n\n',
      );

      await new Promise<void>((resolve) => {
        releaseStream = resolve;
      });

      const fullReport = JSON.stringify({
        schema_version: 1,
        overview: "Audited 4 changed files for invoice export currency support.",
        categories: [
          {
            id: "encapsulation",
            title: "Encapsulation",
            score: 9,
            summary: "Currency formatting stays encapsulated in InvoiceExporter.",
            problems: [],
          },
          {
            id: "idempotency",
            title: "Idempotency",
            score: 8,
            summary: "CSV export is pure and repeatable for identical inputs.",
            problems: [],
          },
          {
            id: "edge_cases",
            title: "Edge cases & inputs",
            score: 6,
            summary:
              "InvoiceExporter.kt adds currency to the exported header without validating ISO-4217 codes.",
            problems: [
              {
                title: "Unvalidated currency serialization",
                description:
                  "Downstream billing parsers assume standard three-letter uppercase currency symbols.",
                location: "InvoiceExporter.kt:41",
                severity: "warning",
              },
            ],
          },
          {
            id: "error_handling",
            title: "Error handling",
            score: 5,
            summary: "Missing explicit exception when currency is blank.",
            problems: [
              {
                title: "Silent fallback on blank currency",
                description: "Blank currency codes emit an empty CSV column.",
                location: "InvoiceExporter.kt:48",
                severity: "warning",
              },
            ],
          },
          {
            id: "logs",
            title: "Logs",
            score: 8,
            summary: "Export count logging remains intact without sensitive data.",
            problems: [],
          },
          {
            id: "monitoring",
            title: "Monitoring",
            score: 8,
            summary: "Existing export duration metrics cover the new column.",
            problems: [],
          },
          {
            id: "security",
            title: "Security",
            score: 9,
            summary: "No injection or credential exposure introduced.",
            problems: [],
          },
          {
            id: "concurrency",
            title: "Concurrency",
            score: 9,
            summary: "Exporter holds no mutable shared state.",
            problems: [],
          },
          {
            id: "transactions",
            title: "Transactions & atomicity",
            score: 8,
            summary: "Read-only export query runs in a single snapshot.",
            problems: [],
          },
          {
            id: "performance",
            title: "Performance",
            score: 8,
            summary: "Appending one column adds negligible serialization overhead.",
            problems: [],
          },
          {
            id: "breaking_changes",
            title: "Breaking changes",
            score: 4,
            summary: "CSV header expands from 3 to 4 columns.",
            problems: [
              {
                title: "CSV header column added",
                description: "Downstream parsers expecting 3 columns may fail.",
                location: "InvoiceExporter.kt:41",
                severity: "warning",
              },
            ],
          },
          {
            id: "test_coverage",
            title: "Test coverage",
            score: 6,
            summary: "Happy-path USD export is tested; invalid currency codes are not.",
            problems: [
              {
                title: "Missing test for invalid currency",
                description: "No unit test verifies rejection of malformed ISO-4217 codes.",
                location: "InvoiceExporterTest.kt:28",
                severity: "suggestion",
              },
            ],
            coverage_percent: 72,
            test_scenarios: ["Exports 4-column CSV header with USD", "Preserves decimal rounding"],
          },
          {
            id: "dependencies",
            title: "New dependencies",
            score: 10,
            summary: "Uses existing standard library and CurrencyCode helper.",
            problems: [],
            dependencies_introduced: false,
            dependency_tradeoff:
              "Reuses internal CurrencyCode module instead of adding a new library.",
          },
        ],
        blast_radius: "Affects **CSV invoice exports** for all billing tenants.",
        deployment_risks: "Downstream CSV consumers must handle the `currency` column.",
        rollback_plan: "Revert the export header commit; no database migration required.",
      });
      res.write(
        `event: report_update\ndata: ${JSON.stringify({ report_markdown: fullReport })}\n\n`,
      );
      res.write('event: billing\ndata: {"cost_usd":"0.14","balance_usd":"9.86"}\n\n');
      res.write(
        `event: done\ndata: ${JSON.stringify({ cost_usd: "0.14", balance_usd: "9.86", report_markdown: fullReport })}\n\n`,
      );
      res.end();
      return;
    }

    if (method === "POST" && url.pathname === "/v1/reviews/followup") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "close",
      });
      const chatDelta =
        "Currency validation is implemented in **CurrencyCode.kt** via `CurrencyCode.isValid(raw)`. Call this before header serialization.";
      res.write(`event: chat_delta\ndata: ${JSON.stringify({ delta: chatDelta })}\n\n`);
      res.write('event: billing\ndata: {"cost_usd":"0.0034","balance_usd":"9.85"}\n\n');
      res.write(
        `event: done\ndata: ${JSON.stringify({ cost_usd: "0.0034", balance_usd: "9.85", chat_message: chatDelta })}\n\n`,
      );
      res.end();
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  const port = (server.address() as { port: number }).port;
  const cloudUrl = `http://127.0.0.1:${port}`;

  try {
    const billing = designRepo(workspace);
    const app = await startApp({ open: [billing], cloudUrl });

    await page.getByRole("button", { name: "Recent projects" }).waitFor();
    await page.getByRole("button", { name: "AI review" }).click();
    await page.getByText("AI code review disclosure").waitFor();
    await page.waitForTimeout(300);
    await shoot(page, "AiReviewConsent");

    await page.getByRole("button", { name: "Allow AI review" }).click();
    await page.getByText("Sign in to Diffloupe").waitFor();
    await page.waitForTimeout(300);
    await shoot(page, "AiReviewAuth");

    await page.getByRole("button", { name: "Sign in with browser" }).click();
    await page.getByText("Add review balance").waitFor();
    await page.waitForTimeout(300);
    await shoot(page, "AiReviewBalance");

    currentBalance = "9.86";
    await app.bridge.call("ai_refresh_account");
    await page.getByRole("button", { name: "Manual review" }).click();
    await page.getByRole("button", { name: "AI review" }).click();
    await page.getByText("Balance $9.86").waitFor();

    await page.getByRole("button", { name: "Run review" }).first().click();
    await page.getByText("Review in progress").waitFor();
    await page.waitForTimeout(300);
    await shoot(page, "AiReviewRunning");

    (releaseStream as (() => void) | null)?.();

    await page.getByText("Audited 4 changed files for invoice export currency support.").waitFor();
    await page.waitForTimeout(300);
    await shoot(page, "AiReviewReport");

    await page.getByRole("button", { name: /Edge cases & inputs/ }).click();
    await page.getByText("Unvalidated currency serialization").waitFor();

    await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll("p")).find((el) =>
        el.textContent?.includes("InvoiceExporter.kt adds currency"),
      );
      if (!p) return;
      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });

    await page.getByRole("button", { name: "Ask about selection" }).waitFor();
    await page.waitForTimeout(300);
    await shoot(page, "AiReviewSelection");

    await page.getByRole("button", { name: "Ask about selection" }).click();
    const chatRegion = page.getByRole("region", { name: "Interactive chat" });
    await chatRegion.waitFor();

    const composer = page.getByPlaceholder("Ask about this review or request changes…");
    await composer.fill("Where is ISO-4217 validation handled in the rest of the billing module?");
    await page.keyboard.press("Enter");

    await chatRegion
      .locator(".dl-ai-thread")
      .getByText("Currency validation is implemented in")
      .waitFor();
    await page.waitForTimeout(300);
    await shoot(page, "AiReviewChat");
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});

for (const platform of ["windows", "linux"] as const) {
  test(`the main window as ${platform}`, async ({ page, workspace, startApp }) => {
    const billing = designRepo(workspace);
    await startApp({ open: [workspace.repo("payments-api"), billing], platform });
    await page.getByRole("button", { name: "Recent projects" }).waitFor();
    await page.getByRole("treeitem", { name: /InvoiceExporter.kt/ }).click();
    await page.getByRole("region", { name: "Side-by-side diff" }).waitFor();
    await page.waitForTimeout(300);
    const name = platform === "windows" ? "ChangesWindows" : "ChangesLinux";
    await shoot(page, name);
    await page.getByRole("button", { name: "Settings menu" }).click();
    await shoot(page, platform === "windows" ? "SettingsMenuWindows" : "SettingsMenuLinux");
    await page.getByRole("menuitem", { name: "About Diffloupe" }).click();
    await shoot(page, platform === "windows" ? "AboutWindows" : "AboutLinux");
    await page
      .getByRole("dialog", { name: "About Diffloupe" })
      .getByRole("button", { name: "Close" })
      .click();
    await page.getByRole("button", { name: "Settings menu" }).click();
    await page.getByRole("menuitem", { name: "Uninstall Diffloupe…" }).click();
    await shoot(page, platform === "windows" ? "UninstallWindows" : "UninstallLinux");
  });
}
