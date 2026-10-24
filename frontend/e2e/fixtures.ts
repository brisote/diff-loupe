import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { test as base, type Page } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bridgeBinary =
  process.env.DL_BRIDGE ?? join(root, "../backend/target/debug/diffloupe-devbridge");

export const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Ada Lovelace",
  GIT_AUTHOR_EMAIL: "ada@example.com",
  GIT_COMMITTER_NAME: "Ada Lovelace",
  GIT_COMMITTER_EMAIL: "ada@example.com",
};

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8" }).trim();
}

export function isolate(repo: string) {
  git(repo, "config", "user.name", "Ada Lovelace");
  git(repo, "config", "user.email", "ada@example.com");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "config", "core.hooksPath", ".git/hooks");
}

export class Workspace {
  constructor(readonly dir: string) {}

  folder(name: string): string {
    const path = join(this.dir, name);
    mkdirSync(path, { recursive: true });
    return path;
  }

  write(repo: string, path: string, content: string) {
    const file = join(repo, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }

  repo(name: string, branch = "main"): string {
    const path = this.folder(name);
    git(path, "init", "-q", "-b", "main");
    isolate(path);
    writeFileSync(join(path, "README.md"), `# ${name}\n`);
    git(path, "add", "-A");
    git(path, "commit", "-q", "-m", "Initial commit");
    if (branch !== "main") git(path, "switch", "-q", "-c", branch);
    return path;
  }
}

type StartOptions = { open?: string[]; pick?: string; dataDir?: string; updateUrl?: string };

export const noUpdates = "http://127.0.0.1:9/repos/brisote/diff-loupe/releases/latest";

export class Bridge {
  private nextId = 1;

  constructor(
    readonly port: number,
    readonly dataDir: string,
    private readonly child: ChildProcess,
  ) {}

  get url() {
    return `ws://127.0.0.1:${this.port}`;
  }

  async call(cmd: string, args: unknown = null): Promise<unknown> {
    const socket = new WebSocket(this.url);
    await new Promise((done) => socket.addEventListener("open", done, { once: true }));
    const id = this.nextId++;
    const reply = new Promise<unknown>((done, fail) => {
      socket.addEventListener("message", (message) => {
        const data = JSON.parse(String(message.data));
        if (data.id !== id) return;
        if ("error" in data) fail(new Error(data.error.message));
        else done(data.ok);
      });
    });
    socket.send(JSON.stringify({ id, cmd, args }));
    try {
      return await reply;
    } finally {
      socket.close();
    }
  }

  async listen(): Promise<{ events: unknown[]; close: () => void }> {
    const socket = new WebSocket(this.url);
    await new Promise((done) => socket.addEventListener("open", done, { once: true }));
    const events: unknown[] = [];
    socket.addEventListener("message", (message) => {
      const data = JSON.parse(String(message.data));
      if ("event" in data) events.push(data.event);
    });
    return { events, close: () => socket.close() };
  }

  stop() {
    this.child.kill();
  }
}

export async function startBridge(options: StartOptions, scratch: string): Promise<Bridge> {
  const dataDir = options.dataDir ?? mkdtempSync(join(scratch, "data-"));
  const args = ["--port", "0", "--data-dir", dataDir];
  for (const path of options.open ?? []) args.push("--open", path);
  if (options.pick) args.push("--pick", options.pick);
  const child = spawn(bridgeBinary, args, {
    stdio: ["ignore", "pipe", "inherit"],
    env: {
      ...process.env,
      SHELL: "/bin/sh",
      ENV: "",
      DIFFLOUPE_UPDATE_URL: options.updateUrl ?? noUpdates,
    },
  });
  const lines = createInterface({ input: child.stdout as NodeJS.ReadableStream });
  const port = await new Promise<number>((done, fail) => {
    child.once("exit", (code) => fail(new Error(`dev bridge exited with ${code}`)));
    lines.on("line", (line) => {
      const match = line.match(/ready on ws:\/\/127\.0\.0\.1:(\d+)/);
      if (match?.[1]) done(Number(match[1]));
    });
  });
  return new Bridge(port, dataDir, child);
}

export type App = {
  bridge: Bridge;
  restart: (options?: StartOptions) => Promise<Bridge>;
};

type Fixtures = {
  workspace: Workspace;
  startApp: (options?: StartOptions) => Promise<App>;
};

export async function visit(page: Page, bridge: Bridge) {
  await page.addInitScript(() => Object.freeze(Object.prototype));
  await page.goto(`/?bridge=${encodeURIComponent(bridge.url)}`);
}

export const test = base.extend<Fixtures>({
  workspace: async ({ browserName: _ }, use) => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "diffloupe-e2e-")));
    await use(new Workspace(dir));
    rmSync(dir, { recursive: true, force: true });
  },
  startApp: async ({ page, workspace }, use) => {
    const bridges: Bridge[] = [];
    await use(async (options = {}) => {
      const bridge = await startBridge(options, workspace.dir);
      bridges.push(bridge);
      await visit(page, bridge);
      const app: App = {
        bridge,
        restart: async (next = {}) => {
          app.bridge.stop();
          app.bridge = await startBridge({ dataDir: app.bridge.dataDir, ...next }, workspace.dir);
          bridges.push(app.bridge);
          await visit(page, app.bridge);
          return app.bridge;
        },
      };
      return app;
    });
    for (const bridge of bridges) bridge.stop();
  },
});

export { expect } from "@playwright/test";
