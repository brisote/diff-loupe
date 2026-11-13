import { createServer } from "node:http";
import { designRepo } from "./designRepo";
import { expect, test } from "./fixtures";

type MockCloudServer = {
  url: string;
  requests: { method: string; path: string; body?: unknown }[];
  setBalance: (balance: string) => void;
  close: () => Promise<void>;
};

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
      const report =
        '## Branch review: invoice export currency support\n\nAudited 4 changed files against repository conventions. Found 1 potential contract regression and 1 missing test case.\n\n### Findings\n\n#### 1. Unvalidated currency serialization\n\n`billing/src/main/kotlin/acme/billing/InvoiceExporter.kt:41`\n\nInvoiceExporter.kt adds currency to the exported header without validating ISO-4217 codes. Downstream billing parsers assume standard three-letter uppercase currency symbols.\n\n```kotlin\ncompanion object {\n    val HEADER = listOf("number", "customer", "amount", "currency")\n}\n```\n';
      res.write(`event: report_delta\ndata: ${JSON.stringify({ delta: report })}\n\n`);
      res.write('event: billing\ndata: {"cost_usd":"0.14","balance_usd":"9.86"}\n\n');
      res.write(
        `event: done\ndata: ${JSON.stringify({ cost_usd: "0.14", balance_usd: "9.86", report_markdown: report })}\n\n`,
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
        "Currency validation is implemented in CurrencyCode.kt via CurrencyCode.isValid(raw).";
      res.write(`event: chat_delta\ndata: ${JSON.stringify({ delta: chatDelta })}\n\n`);
      const updatedReport =
        '## Branch review: invoice export currency support\n\nAudited 4 changed files against repository conventions. Found 1 potential contract regression and 1 missing test case.\n\n### Live update: Added recommendation to validate currency\n\n### Findings\n\n#### 1. Unvalidated currency serialization\n\n`billing/src/main/kotlin/acme/billing/InvoiceExporter.kt:41`\n\nInvoiceExporter.kt adds currency to the exported header without validating ISO-4217 codes. Downstream billing parsers assume standard three-letter uppercase currency symbols.\n\n```kotlin\ncompanion object {\n    val HEADER = listOf("number", "customer", "amount", "currency")\n}\n```\n';
      res.write(
        `event: report_update\ndata: ${JSON.stringify({ report_markdown: updatedReport })}\n\n`,
      );
      res.write('event: billing\ndata: {"cost_usd":"0.0034","balance_usd":"9.85"}\n\n');
      res.write(
        `event: done\ndata: ${JSON.stringify({ cost_usd: "0.0034", balance_usd: "9.85", chat_message: chatDelta, report_markdown: updatedReport })}\n\n`,
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

    await expect(page.getByText("Review in progress")).toBeVisible();
    await expect(page.getByText("Branch review: invoice export currency support")).toBeVisible();
    await expect(page.getByText("Cost $0.14")).toBeVisible();
    await expect(page.getByText("Balance $9.86")).toBeVisible();

    const bodyText = await page.textContent("body");
    expect(bodyText).not.toMatch(/\bcredits?\b/i);

    await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll("p")).find((el) =>
        el.textContent?.includes("InvoiceExporter.kt adds currency"),
      );
      if (!p) throw new Error("Paragraph not found");
      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });

    const askBtn = page.getByRole("button", { name: "Ask about selection" });
    await expect(askBtn).toBeVisible();
    await askBtn.click();

    const chatRegion = page.getByRole("region", { name: "Interactive chat" });
    await expect(chatRegion).toBeVisible();
    await expect(
      chatRegion.getByText(
        "InvoiceExporter.kt adds currency to the exported header without validating ISO-4217 codes.",
      ),
    ).toBeVisible();

    const splitter = page.getByRole("separator", { name: "Resize AI chat" });
    await expect(splitter).toBeVisible();
    await splitter.focus();
    await page.keyboard.press("ArrowUp");

    const composer = page.getByPlaceholder("Ask about this review or request changes…");
    await composer.fill("Where is ISO-4217 validation handled in the rest of the billing module?");
    await page.keyboard.press("Enter");

    await expect(
      page.getByText(
        "Currency validation is implemented in CurrencyCode.kt via CurrencyCode.isValid(raw).",
      ),
    ).toBeVisible();
    await expect(chatRegion.getByText("Cost <$0.01")).toBeVisible();
    await expect(
      page.getByText("Live update: Added recommendation to validate currency"),
    ).toBeVisible();

    await app.restart({ pick: billing, cloudUrl: cloud.url });
    await page.getByRole("button", { name: "AI review" }).click();
    await expect(page.getByText("Branch review: invoice export currency support")).toBeVisible();
    await expect(page.getByText("Balance $9.85")).toBeVisible();

    const restartChat = page.getByRole("region", { name: "Interactive chat" });
    if (!(await restartChat.isVisible())) {
      await page.getByRole("button", { name: "Chat" }).click();
    }
    await expect(
      restartChat.getByText(
        "Where is ISO-4217 validation handled in the rest of the billing module?",
      ),
    ).toBeVisible();
    await expect(restartChat.getByText("Cost <$0.01")).toBeVisible();
  } finally {
    await cloud.close();
  }
});
