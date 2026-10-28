import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { designRepo, mergeRepo, withBranches } from "./designRepo";
import { git, test, type Workspace } from "./fixtures";
import { logNow, logRepo } from "./logRepo";

test.skip(!process.env.DL_SITE_SCREENS, "site screens are captured only with DL_SITE_SCREENS=1");
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, timezoneId: "UTC" });

const out = join("target", "site-screens");

const apiBefore = `# Payments API

The Payments API takes card and bank payments for Acme invoices. All requests use JSON over HTTPS.

## Endpoints

| Method | Path | Purpose | Auth |
| --- | --- | --- | --- |
| POST | /v1/payments | Create a payment | API key |
| GET | /v1/payments/{id} | Read one payment | API key |
| POST | /v1/payments/{id}/capture | Capture an authorised payment | API key |
| DELETE | /v1/payments/{id} | Cancel a payment | Admin key |

## Rate limits

Each API key may send 100 requests per minute. Requests over the limit get \`429 Too Many Requests\`.

## Errors

- \`400\` The request body is not valid.
- \`402\` The card was declined.
- \`404\` The payment does not exist.
`;

const apiAfter = `# Payments API

The Payments API takes card, bank and wallet payments for Acme invoices. All requests use JSON over HTTPS.

## Endpoints

| Method | Path | Purpose | Auth |
| --- | --- | --- | --- |
| POST | /v2/payments | Create a payment | API key |
| GET | /v2/payments/{id} | Read one payment | API key |
| POST | /v2/payments/{id}/refunds | Refund part or all of a payment | API key |
| POST | /v2/payments/{id}/capture | Capture an authorised payment | Scoped key |

## Idempotency

Send an \`Idempotency-Key\` header with every \`POST\`. A retry with the same key returns the first result instead of charging twice.

- Keys expire after 24 hours.
- Use a new UUID for each payment.

## Errors

- \`400\` The request body is not valid.
- \`402\` The card was declined.
- \`409\` The idempotency key was used with a different body.
`;

const apiFiles = {
  "package.json": `{
  "name": "payments-api",
  "version": "1.4.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test test/"
  },
  "dependencies": {
    "express": "^4.21.2"
  }
}
`,
  "src/server.js": `import express from "express";
import { auth } from "./middleware/auth.js";
import { rateLimit } from "./middleware/rateLimit.js";
import { payments } from "./routes/payments.js";

const app = express();
app.use(express.json());
app.use(auth);
app.use(rateLimit({ perMinute: 100 }));
app.use("/v1/payments", payments);

app.listen(process.env.PORT ?? 3000);
`,
  "src/middleware/auth.js": `export function auth(req, res, next) {
  const key = req.get("Authorization")?.replace("Bearer ", "");
  if (!key) return res.status(401).json({ error: "missing API key" });
  req.apiKey = key;
  next();
}
`,
  "src/middleware/rateLimit.js": `const windows = new Map();

export function rateLimit({ perMinute }) {
  return (req, res, next) => {
    const minute = Math.floor(Date.now() / 60000);
    const id = \`\${req.apiKey}:\${minute}\`;
    const count = (windows.get(id) ?? 0) + 1;
    windows.set(id, count);
    if (count > perMinute) return res.status(429).json({ error: "Too Many Requests" });
    next();
  };
}
`,
  "src/routes/payments.js": `import { Router } from "express";
import { store } from "../store.js";

export const payments = Router();

payments.post("/", async (req, res) => {
  const payment = await store.create(req.body);
  res.status(201).json(payment);
});

payments.get("/:id", async (req, res) => {
  const payment = await store.find(req.params.id);
  if (!payment) return res.status(404).json({ error: "not found" });
  res.json(payment);
});

payments.delete("/:id", async (req, res) => {
  await store.cancel(req.params.id);
  res.status(204).end();
});
`,
  "src/store.js": `const payments = new Map();

export const store = {
  async create(body) {
    const payment = { id: crypto.randomUUID(), status: "authorised", ...body };
    payments.set(payment.id, payment);
    return payment;
  },
  async find(id) {
    return payments.get(id);
  },
  async cancel(id) {
    payments.delete(id);
  },
};
`,
  "test/payments.test.js": `import { test } from "node:test";
import assert from "node:assert/strict";
import { store } from "../src/store.js";

test("a new payment is authorised", async () => {
  const payment = await store.create({ amount: 1250, currency: "EUR" });
  assert.equal(payment.status, "authorised");
});
`,
};

function apiDocsRepo(workspace: Workspace): string {
  const repo = workspace.repo("payments-api");
  workspace.write(repo, "README.md", apiBefore);
  for (const [path, content] of Object.entries(apiFiles)) workspace.write(repo, path, content);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Document the payments API");
  git(repo, "switch", "-q", "-c", "gs/api-v2");
  workspace.write(
    repo,
    "src/routes/payments.js",
    apiFiles["src/routes/payments.js"].replace(
      /payments\.delete[\s\S]*$/,
      'payments.post("/:id/capture", async (req, res) => {\n  res.json(await store.capture(req.params.id));\n});\n',
    ),
  );
  workspace.write(
    repo,
    "src/routes/refunds.js",
    `import { Router } from "express";\nimport { store } from "../store.js";\n\nexport const refunds = Router({ mergeParams: true });\n\nrefunds.post("/", async (req, res) => {\n  const refund = await store.refund(req.params.id, req.body.amount);\n  res.status(201).json(refund);\n});\n`,
  );
  rmSync(join(repo, "src/middleware/rateLimit.js"));
  workspace.write(repo, "package.json", apiFiles["package.json"].replace('"1.4.0"', '"2.0.0"'));
  workspace.write(
    repo,
    "test/refunds.test.js",
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { store } from "../src/store.js";\n\ntest("a refund never exceeds the payment", async () => {\n  const payment = await store.create({ amount: 1250, currency: "EUR" });\n  await assert.rejects(store.refund(payment.id, 2000));\n});\n`,
  );
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Move the API to v2 with refunds");
  workspace.write(
    repo,
    "src/middleware/idempotency.js",
    `const seen = new Map();\n\nexport function idempotency(req, res, next) {\n  const key = req.get("Idempotency-Key");\n  if (req.method !== "POST" || !key) return next();\n  if (seen.has(key)) return res.json(seen.get(key));\n  const send = res.json.bind(res);\n  res.json = (body) => (seen.set(key, body), send(body));\n  next();\n}\n`,
  );
  git(repo, "add", "src/middleware/idempotency.js");
  workspace.write(
    repo,
    "src/server.js",
    apiFiles["src/server.js"]
      .replace(
        'import { rateLimit } from "./middleware/rateLimit.js";\n',
        'import { idempotency } from "./middleware/idempotency.js";\n',
      )
      .replace("app.use(rateLimit({ perMinute: 100 }));\n", "app.use(idempotency);\n")
      .replace('"/v1/payments"', '"/v2/payments"'),
  );
  workspace.write(repo, "README.md", apiAfter);
  workspace.write(
    repo,
    "docs/migration-v2.md",
    "# Moving to v2\n\nReplace /v1 with /v2 in every path, and send an Idempotency-Key with each POST.\n",
  );
  return repo;
}

async function shoot(page: Page, name: string, description: string) {
  mkdirSync(out, { recursive: true });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.waitForTimeout(150);
    await page.screenshot({
      path: join(out, `${name}-${colorScheme}.png`),
      animations: "disabled",
      caret: "hide",
    });
  }
  writeFileSync(join(out, `${name}.json`), JSON.stringify({ name, description }));
}

test("changes and diffs", async ({ page, workspace, startApp }) => {
  await startApp({ open: [designRepo(workspace)] });
  await page.getByRole("treeitem", { name: /InvoiceExporter.kt/ }).click();
  await page.getByRole("region", { name: "Side-by-side diff" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(
    page,
    "changes",
    "The Changes list with the side-by-side diff of a Kotlin file, connectors and word highlights.",
  );
  await page.getByRole("button", { name: "Unified viewer" }).click();
  await page.getByRole("region", { name: "Unified diff" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "unified", "The same change in the unified one-pane view.");
});

test("branch log", async ({ page, workspace, startApp }) => {
  const repo = logRepo(workspace);
  await page.clock.setFixedTime(logNow);
  await startApp({ open: [repo] });
  await page.getByRole("tab", { name: "Commit history" }).click();
  await page.getByRole("option", { name: /Round totals/ }).click();
  await page.getByRole("button", { name: "Compare Next File" }).click();
  await page.getByRole("region", { name: "Side-by-side diff" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(
    page,
    "branch-log",
    "The Branch log with the branch's commits and the diff of one commit.",
  );
});

test("markdown", async ({ page, workspace, startApp }) => {
  await startApp({ open: [apiDocsRepo(workspace)] });
  await page.getByRole("treeitem", { name: "README.md" }).click();
  await page.getByRole("region", { name: "Rendered side-by-side diff" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(
    page,
    "markdown",
    "An API document rendered side by side, with changed table cells, a removed section and a new section marked.",
  );
});

test("merge", async ({ page, workspace, startApp }) => {
  await startApp({ open: [mergeRepo(workspace)] });
  await page.getByRole("button", { name: "Current branch" }).click();
  await page.getByRole("menuitem", { name: "Merge main into gs/invoice-export" }).click();
  const dialog = page.getByRole("dialog", { name: "Conflicts" });
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Merge…" }).click();
  await page
    .getByRole("dialog", { name: "Merge Revisions" })
    .getByRole("textbox", { name: "Result" })
    .waitFor();
  await page.waitForTimeout(500);
  await shoot(page, "merge", "The 3-pane merge window with yours, the result and theirs.");
});

test("git actions", async ({ page, workspace, startApp }) => {
  const repo = designRepo(workspace);
  withBranches(workspace, repo);
  await startApp({ open: [repo] });
  await page.getByRole("button", { name: "Target branch" }).click();
  await page.getByRole("dialog", { name: "Target branch" }).waitFor();
  await page.waitForTimeout(200);
  await shoot(page, "target-picker", "The Target picker that sets the branch to compare with.");
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
  await shoot(page, "commit", "The commit dialog with picked files and a message.");
});

test("terminal", async ({ page, workspace, startApp }) => {
  await startApp({ open: [designRepo(workspace)] });
  await page.getByRole("treeitem", { name: /InvoiceExporter.kt/ }).click();
  await page.getByRole("region", { name: "Side-by-side diff" }).waitFor();
  await page.getByRole("button", { name: "Terminal ⌥F12" }).click();
  await page.locator(".app-terminal-screen:not([hidden]) .xterm").click();
  await page.keyboard.type("PS1='$ '; clear; git status --short -uall");
  await page.keyboard.press("Enter");
  await page.locator(".xterm-rows").getByText("export-notes.md").waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "terminal", "The terminal docked under the diff, running git status.");
});
