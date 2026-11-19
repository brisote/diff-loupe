import { createServer } from "node:http";
import { designRepo } from "./designRepo";
import { expect, test } from "./fixtures";

type MockCloudServer = {
  url: string;
  requests: { method: string; path: string; body?: unknown }[];
  setBalance: (balance: string) => void;
  close: () => Promise<void>;
};

const STRUCTURED_REPORT = {
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
      summary: "Empty or lowercase currency strings are not normalized.",
      problems: [
        {
          title: "Unvalidated currency serialization",
          description:
            "InvoiceExporter.kt adds currency to the exported header without validating ISO-4217 codes.",
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
          description: "Blank currency codes emit an empty CSV column instead of failing fast.",
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
      dependency_tradeoff: "Reuses internal CurrencyCode module instead of adding a new library.",
    },
  ],
  blast_radius: "Affects **CSV invoice exports** for all billing tenants.",
  deployment_risks: "Downstream CSV consumers must handle the `currency` column.",
  rollback_plan: "Revert the export header commit; no database migration required.",
};

const STRUCTURED_REPORT_JSON = JSON.stringify(STRUCTURED_REPORT);
const UPDATED_STRUCTURED_REPORT_JSON = JSON.stringify({
  ...STRUCTURED_REPORT,
  overview: "Updated audit: 4 changed files with ISO-4217 validation.",
});

function createMockCloud(): Promise<MockCloudServer> {
  let currentBalance = "0.00";
  const requests: { method: string; path: string; body?: unknown }[] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const method = req.method ?? "GET";
    const buffers: Buffer[] = [];
    for await (const chunk of req) {
      buffers.push(chunk);
    }
    const rawBody = Buffer.concat(buffers).toString("utf8");
    let body: unknown = null;
    try {
      body = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      body = rawBody;
    }
    requests.push({ method, path: url.pathname, body });

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
            { id: "claude-3-5-haiku", name: "Claude 3.5 Haiku" },
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
      currentBalance = "10.00";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          checkout_url: `http://${req.headers.host}/billing/dev-success?amount=10`,
        }),
      );
      return;
    }

    if (method === "POST" && url.pathname === "/v1/auth/logout") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({}));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/reviews/stream") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "close",
      });
      res.write('event: stage\ndata: {"stage":"uploading","message":"Uploading repository…"}\n\n');
      res.write('event: stage\ndata: {"stage":"indexing","message":"Indexing project…"}\n\n');
      res.write(
        'event: stage\ndata: {"stage":"analyzing","message":"Analyzing branch changes…"}\n\n',
      );
      res.write(
        `event: report_delta\ndata: ${JSON.stringify({ delta: '{"schema_version":1,"overview":"Streaming partial' })}\n\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, 600));
      res.write(
        `event: report_delta\ndata: ${JSON.stringify({ delta: STRUCTURED_REPORT_JSON.slice('{"schema_version":1,"overview":"Streaming partial'.length) })}\n\n`,
      );
      res.write('event: billing\ndata: {"cost_usd":"0.14","balance_usd":"9.86"}\n\n');
      res.write(
        `event: done\ndata: ${JSON.stringify({ cost_usd: "0.14", balance_usd: "9.86", report_markdown: STRUCTURED_REPORT_JSON })}\n\n`,
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
        "Currency validation is implemented in **CurrencyCode.kt** via `CurrencyCode.isValid(raw)`.";
      res.write(`event: chat_delta\ndata: ${JSON.stringify({ delta: chatDelta })}\n\n`);
      res.write(
        `event: report_update\ndata: ${JSON.stringify({ report_markdown: UPDATED_STRUCTURED_REPORT_JSON })}\n\n`,
      );
      res.write('event: billing\ndata: {"cost_usd":"0.0034","balance_usd":"9.85"}\n\n');
      res.write(
        `event: done\ndata: ${JSON.stringify({ cost_usd: "0.0034", balance_usd: "9.85", chat_message: chatDelta, report_markdown: UPDATED_STRUCTURED_REPORT_JSON })}\n\n`,
      );
      res.end();
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        setBalance: (balance: string) => {
          currentBalance = balance;
        },
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

test("full AI review workflow, selection quoting, live chat dual streaming, and persistence", async ({
  page,
  workspace,
  startApp,
}) => {
  const cloud = await createMockCloud();
  try {
    const billing = designRepo(workspace);
    const app = await startApp({ open: [billing], cloudUrl: cloud.url });

    await page.getByRole("button", { name: "Recent projects" }).waitFor();
    await page.getByRole("treeitem", { name: /InvoiceExporter.kt/ }).click();
    await page.getByRole("region", { name: "Side-by-side diff" }).waitFor();

    const manualBtn = page.getByRole("button", { name: "Manual review" });
    const aiBtn = page.getByRole("button", { name: "AI review" });

    await expect(manualBtn).toHaveAttribute("aria-pressed", "true");
    await expect(aiBtn).toHaveAttribute("aria-pressed", "false");

    await aiBtn.click();
    await expect(page.getByRole("region", { name: "AI review" })).toBeVisible();

    await manualBtn.click();
    await expect(page.getByRole("region", { name: "Side-by-side diff" })).toBeVisible();

    await aiBtn.click();
    await expect(page.getByText("AI code review disclosure")).toBeVisible();
    await expect(page.getByText("What data is used")).toBeVisible();
    await expect(page.getByText("Do we delete everything")).toBeVisible();
    const disclosureText = await page.textContent("body");
    expect(disclosureText).not.toContain("—");

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("region", { name: "Side-by-side diff" })).toBeVisible();
    expect(cloud.requests).toHaveLength(0);

    await aiBtn.click();
    await page.getByRole("button", { name: "Allow AI review" }).click();

    await expect(page.getByText("Sign in to Diffloupe")).toBeVisible();
    await page.getByRole("button", { name: "Sign in with browser" }).click();

    await expect(async () => {
      const opened = (await app.bridge.call("devbridge_opened")) as string[];
      expect(opened).toEqual(expect.arrayContaining([expect.stringContaining("/verify")]));
    }).toPass();

    await expect(page.getByText("Add review balance")).toBeVisible();
    expect(
      await page.getByRole("dialog", { name: "Diffloupe ran into a problem" }).isVisible(),
    ).toBe(false);

    await page.getByRole("button", { name: /\$10/ }).click();
    await expect(async () => {
      const opened = (await app.bridge.call("devbridge_opened")) as string[];
      expect(opened).toEqual(expect.arrayContaining([expect.stringContaining("dev-success")]));
    }).toPass();

    await expect(page.getByText("Balance $10.00")).toBeVisible();

    const modelBtn = page.getByTitle("Model");
    await expect(modelBtn).toBeVisible();
    await modelBtn.click();
    await page.getByRole("button", { name: "Claude 3.7 Sonnet" }).click();
    await expect(page.getByTitle("Model")).toContainText("Claude 3.7 Sonnet");

    const effortBtn = page.getByTitle("Reasoning effort");
    await expect(effortBtn).toBeVisible();
    await effortBtn.click();
    await page.getByRole("button", { name: "High" }).click();
    await expect(page.getByTitle("Reasoning effort")).toContainText("High");

    await expect(page.getByRole("button", { name: "Run review" }).first()).toBeEnabled();

    await page.getByRole("button", { name: "Run review" }).first().click();

    await expect(page.locator(".dl-ai-skeleton")).toBeVisible();
    await expect(page.getByText('"schema_version"')).toHaveCount(0);

    await expect(
      page.getByText("Audited 4 changed files for invoice export currency support."),
    ).toBeVisible();
    await expect(page.getByText("Cost $0.14")).toBeVisible();
    await expect(page.getByText("Balance $9.86")).toBeVisible();

    const bodyText = await page.textContent("body");
    expect(bodyText).not.toMatch(/\bcredits?\b/i);

    const chatRegion = page.getByRole("region", { name: "Interactive chat" });
    await expect(chatRegion).toBeVisible();
    await expect(page.getByRole("separator", { name: "Resize AI chat" })).toHaveCount(0);

    const gaugesGroup = chatRegion.getByRole("group", { name: "Review categories" });
    await expect(gaugesGroup).toBeVisible();
    const gaugeButtons = gaugesGroup.locator(".dl-ai-gauge-btn");
    await expect(gaugeButtons).toHaveCount(13);

    for (const [i, cat] of STRUCTURED_REPORT.categories.entries()) {
      const btn = gaugeButtons.nth(i);
      await expect(btn.locator(".dl-ai-gauge-label")).toHaveText(cat.title);
      await expect(btn.locator(".dl-ai-gauge-score")).toHaveText(String(cat.score));
    }

    const detailSection = chatRegion.getByRole("region", { name: "Selected category details" });
    await expect(detailSection).toHaveCount(0);

    const edgeCasesBtn = gaugesGroup.getByRole("button", { name: /Edge cases & inputs/ });
    await edgeCasesBtn.click();
    await expect(edgeCasesBtn).toHaveAttribute("aria-expanded", "true");
    await expect(detailSection).toBeVisible();
    await expect(
      detailSection.getByText("Empty or lowercase currency strings are not normalized."),
    ).toBeVisible();
    await expect(detailSection.getByText("Unvalidated currency serialization")).toBeVisible();

    const testCoverageBtn = gaugesGroup.getByRole("button", { name: /Test coverage/ });
    await testCoverageBtn.click();
    await expect(edgeCasesBtn).toHaveAttribute("aria-expanded", "false");
    await expect(testCoverageBtn).toHaveAttribute("aria-expanded", "true");
    await expect(detailSection.getByText("Test coverage for changed code: 72%")).toBeVisible();
    await expect(detailSection.getByText("Exports 4-column CSV header with USD")).toBeVisible();

    const depsBtn = gaugesGroup.getByRole("button", { name: /New dependencies/ });
    await depsBtn.click();
    await expect(testCoverageBtn).toHaveAttribute("aria-expanded", "false");
    await expect(depsBtn).toHaveAttribute("aria-expanded", "true");
    await expect(detailSection.getByText("New dependency introduced: No")).toBeVisible();
    await expect(
      detailSection.getByText(
        "Reuses internal CurrencyCode module instead of adding a new library.",
      ),
    ).toBeVisible();

    await depsBtn.click();
    await expect(depsBtn).toHaveAttribute("aria-expanded", "false");
    await expect(detailSection).toHaveCount(0);

    await expect(chatRegion.getByRole("heading", { name: "Blast radius" })).toBeVisible();
    await expect(chatRegion.getByText("CSV invoice exports")).toBeVisible();
    await expect(chatRegion.getByRole("heading", { name: "Deployment risks" })).toBeVisible();
    await expect(chatRegion.getByText("Downstream CSV consumers must handle the")).toBeVisible();
    await expect(chatRegion.getByRole("heading", { name: "Rollback plan" })).toBeVisible();
    await expect(
      chatRegion.getByText("Revert the export header commit; no database migration required."),
    ).toBeVisible();

    await page.evaluate(() => {
      const store = window as Window & { __copiedMarkdown?: string };
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (text: string) => {
            store.__copiedMarkdown = text;
          },
        },
        configurable: true,
      });
    });
    await chatRegion.getByRole("button", { name: "Copy as Markdown" }).click();
    await expect(chatRegion.getByRole("button", { name: "Copied" })).toBeVisible();
    const copiedMarkdown = await page.evaluate(
      () => (window as Window & { __copiedMarkdown?: string }).__copiedMarkdown,
    );
    expect(copiedMarkdown).toContain(
      "Audited 4 changed files for invoice export currency support.",
    );

    await page.evaluate(() => {
      const target = document.querySelector(".dl-ai-report-title");
      if (!target?.firstChild) return;
      const range = document.createRange();
      range.setStart(target.firstChild, 0);
      range.setEnd(target.firstChild, 23);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    const askSelectionBtn = chatRegion.getByRole("button", { name: "Ask about selection" });
    await expect(askSelectionBtn).toBeVisible();
    await askSelectionBtn.click();
    await expect(chatRegion.locator(".dl-ai-composer .dl-ai-quote-text")).toHaveText(
      "Audited 4 changed files",
    );

    await edgeCasesBtn.click();
    await detailSection.getByRole("button", { name: "Ask about category" }).click();

    const composerQuote = chatRegion.locator(".dl-ai-composer .dl-ai-quote-text");
    await expect(composerQuote).toHaveText(
      "Empty or lowercase currency strings are not normalized.",
    );

    const composer = page.getByPlaceholder("Ask about this review or request changes…");
    await expect(composer).toBeVisible();
    await composer.fill("Where is ISO-4217 validation handled in the rest of the billing module?");
    await page.keyboard.press("Enter");

    const thread = chatRegion.locator(".dl-ai-thread");
    await expect(
      thread.getByText("Where is ISO-4217 validation handled in the rest of the billing module?"),
    ).toBeVisible();
    await expect(thread.locator("strong", { hasText: "CurrencyCode.kt" })).toBeVisible();
    await expect(thread.locator("code", { hasText: "CurrencyCode.isValid(raw)" })).toBeVisible();
    await expect(thread.getByText("Cost <$0.01")).toBeVisible();
    await expect(chatRegion.getByText("Version 2 of 2")).toBeVisible();
    await expect(
      chatRegion.getByText("Updated audit: 4 changed files with ISO-4217 validation."),
    ).toBeVisible();

    const followupRequest = cloud.requests.find(
      (req) => req.method === "POST" && req.path === "/v1/reviews/followup",
    );
    expect(followupRequest).toBeDefined();
    const followupBody = followupRequest?.body as { current_report_markdown?: string };
    expect(followupBody.current_report_markdown).toBe(STRUCTURED_REPORT_JSON);

    await manualBtn.click();
    await expect(page.getByRole("region", { name: "Side-by-side diff" })).toBeVisible();
    await aiBtn.click();
    await expect(
      chatRegion.getByText("Updated audit: 4 changed files with ISO-4217 validation."),
    ).toBeVisible();
    await expect(chatRegion.locator(".dl-ai-gauge-btn")).toHaveCount(13);
    await expect(
      chatRegion
        .locator(".dl-ai-thread")
        .getByText("Where is ISO-4217 validation handled in the rest of the billing module?"),
    ).toBeVisible();

    await app.restart({ pick: billing, cloudUrl: cloud.url });
    await page.getByRole("button", { name: "AI review" }).click();
    const restartChat = page.getByRole("region", { name: "Interactive chat" });
    await expect(restartChat).toBeVisible();
    await expect(restartChat.getByText("Version 2 of 2")).toBeVisible();
    await expect(
      restartChat.getByText("Updated audit: 4 changed files with ISO-4217 validation."),
    ).toBeVisible();
    await expect(restartChat.locator(".dl-ai-gauge-btn")).toHaveCount(13);
    await expect(restartChat.getByRole("heading", { name: "Blast radius" })).toBeVisible();
    await expect(restartChat.getByRole("heading", { name: "Deployment risks" })).toBeVisible();
    await expect(restartChat.getByRole("heading", { name: "Rollback plan" })).toBeVisible();
    await expect(page.getByText("Balance $9.85")).toBeVisible();

    await expect(
      restartChat
        .locator(".dl-ai-thread")
        .getByText("Where is ISO-4217 validation handled in the rest of the billing module?"),
    ).toBeVisible();
    await expect(restartChat.locator(".dl-ai-thread").getByText("Cost <$0.01")).toBeVisible();
  } finally {
    await cloud.close();
  }
});
