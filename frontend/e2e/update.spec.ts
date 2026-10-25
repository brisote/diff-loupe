import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, latestPath, packageSuffix, test } from "./fixtures";

const page = "https://github.com/brisote/diff-loupe/releases/tag/v99.0.0";

type Release = { server: Server; url: string; hits: () => number };

const image = Buffer.alloc(200_000, 7);
const digest = createHash("sha256").update(image).digest("hex");

async function release(tag = "v99.0.0", checksum = digest): Promise<Release> {
  let hits = 0;
  const version = tag.slice(1);
  const server = createServer((request, response) => {
    const path = request.url ?? "/";
    if (path === `/download/${tag}/Diffloupe-${version}${packageSuffix}`) {
      response.writeHead(200, { "Content-Length": image.length });
      response.end(request.method === "HEAD" ? undefined : image);
      return;
    }
    if (path === `/download/${tag}/Diffloupe-${version}${packageSuffix}.sha256`) {
      response.writeHead(200);
      response.end(`${checksum}  Diffloupe-${version}${packageSuffix}\n`);
      return;
    }
    if (path === latestPath) {
      hits++;
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end(`${version}\n`);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${port}${latestPath}`,
    hits: () => hits,
  };
}

let current: Release | undefined;

test.afterEach(() => {
  current?.server.close();
  current = undefined;
});

test("a newer release is offered at start, and Later keeps it away after a restart", async ({
  page: window,
  workspace,
  startApp,
}) => {
  current = await release();
  const app = await startApp({ open: [workspace.repo("acme-billing")], updateUrl: current.url });
  const banner = window.getByRole("status").filter({ hasText: "Diffloupe 99.0.0 is available." });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Release notes" }).click();
  await expect.poll(() => app.bridge.call("devbridge_opened")).toEqual([page]);
  await banner.getByRole("button", { name: "Later" }).click();
  await expect(banner).toBeHidden();
  await app.restart({ updateUrl: current.url });
  await expect.poll(() => current?.hits()).toBe(2);
  await window.getByRole("button", { name: "Settings menu" }).click();
  await window.getByRole("menuitem", { name: "Check for updates…" }).click();
  const dialog = window.getByRole("dialog", { name: "Settings" });
  await expect(dialog.getByText("Diffloupe 99.0.0 is available.")).toBeVisible();
  expect(current.hits()).toBe(3);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(window.getByRole("status").filter({ hasText: "is available." })).toHaveCount(0);
});

test("a page outside the repository is never opened", async ({
  page: window,
  workspace,
  startApp,
}) => {
  const app = await startApp({ open: [workspace.repo("acme-billing")] });
  await expect(window.getByRole("button", { name: "Settings menu" })).toBeVisible();
  for (const url of [
    "https://github.com/brisote/diff-loupe-fork",
    "https://github.com/brisote/diff-loupe/../../attacker/repo",
  ])
    await expect(app.bridge.call("open_link", { url })).rejects.toThrow(/not a page/);
  expect(await app.bridge.call("devbridge_opened")).toEqual([]);
});

test("Check for updates opens Settings and reports the latest version", async ({
  page: window,
  workspace,
  startApp,
}) => {
  current = await release("v0.0.1");
  await startApp({ open: [workspace.repo("acme-billing")], updateUrl: current.url });
  await window.getByRole("button", { name: "Settings menu" }).click();
  await window.getByRole("menuitem", { name: "Check for updates…" }).click();
  const dialog = window.getByRole("dialog", { name: "Settings" });
  await expect(dialog.getByRole("option", { name: "Updates", selected: true })).toBeVisible();
  await expect(dialog.getByText(/is the latest version\.$/)).toBeVisible();
});

test("a failed Check now says diffloupe.com could not be reached", async ({
  page: window,
  workspace,
  startApp,
}) => {
  await startApp({ open: [workspace.repo("acme-billing")] });
  await window.getByRole("button", { name: "Settings menu" }).click();
  await window.getByRole("menuitem", { name: "Check for updates…" }).click();
  await expect(
    window.getByText("diffloupe.com could not be reached. Check the connection and try again."),
  ).toBeVisible();
});

test("with automatic checks off, no request is made at start", async ({
  page: window,
  workspace,
  startApp,
}) => {
  current = await release();
  const app = await startApp({ open: [workspace.repo("acme-billing")], updateUrl: current.url });
  await expect.poll(() => current?.hits()).toBe(1);
  await window.getByRole("button", { name: "Settings menu" }).click();
  await window.getByRole("menuitem", { name: /^Settings…/ }).click();
  const dialog = window.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("option", { name: "Updates" }).click();
  await dialog.getByText("Check for new versions automatically").click();
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(dialog).toBeHidden();
  await app.restart({ updateUrl: current.url });
  await window.getByRole("button", { name: "Settings menu" }).click();
  await window.getByRole("menuitem", { name: "Check for updates…" }).click();
  await expect(
    window.getByRole("dialog", { name: "Settings" }).getByText("Diffloupe 99.0.0 is available."),
  ).toBeVisible();
  expect(current.hits()).toBe(2);
});

test("Update downloads and verifies the new version, and Restart now installs it", async ({
  page: window,
  workspace,
  startApp,
}) => {
  current = await release();
  const app = await startApp({ open: [workspace.repo("acme-billing")], updateUrl: current.url });
  const banner = window.getByRole("status").filter({ hasText: "Diffloupe 99.0.0 is available." });
  await banner.getByRole("button", { name: "Update" }).click();
  const ready = window
    .getByRole("status")
    .filter({ hasText: "Diffloupe 99.0.0 is ready. It installs when you restart Diffloupe." });
  await expect(ready).toBeVisible();
  expect(await app.bridge.call("devbridge_update_installed")).toBeNull();
  await ready.getByRole("button", { name: "Restart now" }).click();
  await expect
    .poll(() => app.bridge.call("devbridge_update_installed"))
    .toContain(`updates/Diffloupe-99.0.0${packageSuffix}`);
});

test("a download that does not match its checksum is not installed", async ({
  page: window,
  workspace,
  startApp,
}) => {
  current = await release("v99.0.0", "0".repeat(64));
  const app = await startApp({ open: [workspace.repo("acme-billing")], updateUrl: current.url });
  const banner = window.getByRole("status").filter({ hasText: "Diffloupe 99.0.0 is available." });
  await banner.getByRole("button", { name: "Update" }).click();
  const failed = window.getByRole("status").filter({
    hasText: "Diffloupe 99.0.0 was not installed because its download does not match the checksum",
  });
  await expect(failed).toBeVisible();
  await expect(failed.getByRole("button", { name: "Try again" })).toBeVisible();
  await failed.getByRole("button", { name: "Later" }).click();
  await expect(failed).toBeHidden();
  await expect(app.bridge.call("install_update")).rejects.toThrow(/No downloaded update/);
});

test("a verified download is still ready after a restart", async ({
  page: window,
  workspace,
  startApp,
}) => {
  current = await release();
  const app = await startApp({ open: [workspace.repo("acme-billing")], updateUrl: current.url });
  await window
    .getByRole("status")
    .filter({ hasText: "Diffloupe 99.0.0 is available." })
    .getByRole("button", { name: "Update" })
    .click();
  const ready = window
    .getByRole("status")
    .filter({ hasText: "Diffloupe 99.0.0 is ready. It installs when you restart Diffloupe." });
  await expect(ready).toBeVisible();
  await app.restart({ updateUrl: current.url });
  await expect(ready).toBeVisible();
  await ready.getByRole("button", { name: "Restart now" }).click();
  await expect
    .poll(() => app.bridge.call("devbridge_update_installed"))
    .toContain(`updates/Diffloupe-99.0.0${packageSuffix}`);
});
