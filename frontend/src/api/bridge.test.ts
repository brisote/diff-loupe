import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bridgeTransport } from "./bridge";

class FakeSocket extends EventTarget {
  static readonly OPEN = 1;
  static last: FakeSocket;
  readyState = 0;
  sent: { id: number; cmd: string; args: unknown }[] = [];
  constructor(readonly url: string) {
    super();
    FakeSocket.last = this;
    queueMicrotask(() => {
      this.readyState = FakeSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  receive(data: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
}

describe("bridgeTransport", () => {
  beforeEach(() => vi.stubGlobal("WebSocket", FakeSocket));
  afterEach(() => vi.unstubAllGlobals());

  it("matches replies to requests by id", async () => {
    const transport = bridgeTransport("ws://127.0.0.1:1");
    const first = transport.send("app_info", null);
    const second = transport.send("open_repo", { path: "/x" });
    await vi.waitFor(() => expect(FakeSocket.last.sent).toHaveLength(2));
    const [a, b] = FakeSocket.last.sent;
    FakeSocket.last.receive({ id: b?.id, error: { code: "notFound", message: "missing" } });
    FakeSocket.last.receive({ id: a?.id, ok: { version: "0.1.0" } });
    await expect(first).resolves.toEqual({ version: "0.1.0" });
    await expect(second).rejects.toEqual({ code: "notFound", message: "missing" });
  });

  it("passes core events and folder drops to listeners", () => {
    const transport = bridgeTransport("ws://127.0.0.1:1");
    const events: unknown[] = [];
    const drops: string[] = [];
    transport.onEvent((event) => events.push(event));
    const stop = transport.onFolderDrop((path) => drops.push(path));
    FakeSocket.last.receive({
      event: { type: "task", id: "t", label: "x", progress: null, done: false },
    });
    FakeSocket.last.receive({ drop: "/dropped" });
    stop();
    FakeSocket.last.receive({ drop: "/again" });
    expect(events).toHaveLength(1);
    expect(drops).toEqual(["/dropped"]);
  });

  it("fails pending requests when the bridge closes", async () => {
    const transport = bridgeTransport("ws://127.0.0.1:1");
    const request = transport.send("app_info", null);
    await vi.waitFor(() => expect(FakeSocket.last.sent).toHaveLength(1));
    FakeSocket.last.dispatchEvent(new Event("close"));
    await expect(request).rejects.toMatchObject({ code: "io" });
  });

  it("fails a request sent after the bridge closed", async () => {
    const transport = bridgeTransport("ws://127.0.0.1:1");
    await vi.waitFor(() => expect(FakeSocket.last.readyState).toBe(FakeSocket.OPEN));
    FakeSocket.last.readyState = 3;
    await expect(transport.send("app_info", null)).rejects.toMatchObject({ code: "io" });
  });
});
