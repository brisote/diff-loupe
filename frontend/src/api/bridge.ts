import type { ApiError } from "./generated/ApiError";
import type { CoreEvent } from "./generated/CoreEvent";
import type { Listener, Transport } from "./transport";

type BridgeMessage =
  | { id: number; ok: unknown }
  | { id: number; error: ApiError }
  | { event: CoreEvent }
  | { drop: string | null };

type Pending = { resolve: (value: unknown) => void; reject: (error: ApiError) => void };

const closed: ApiError = { code: "io", message: "The dev bridge is not running.", path: null };

export function bridgeTransport(url: string): Transport {
  const socket = new WebSocket(url);
  const pending = new Map<number, Pending>();
  const events = new Set<Listener<CoreEvent>>();
  const drops = new Set<Listener<string>>();
  let nextId = 1;
  const open = new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(closed));
  });
  open.catch(() => undefined);
  socket.addEventListener("close", () => {
    for (const request of pending.values()) request.reject(closed);
    pending.clear();
  });
  socket.addEventListener("message", (message) => {
    const data = JSON.parse(String(message.data)) as BridgeMessage;
    if ("id" in data) {
      const request = pending.get(data.id);
      pending.delete(data.id);
      if ("error" in data) request?.reject(data.error);
      else request?.resolve(data.ok);
    } else if ("event" in data) {
      for (const listener of events) listener(data.event);
    } else if (data.drop) {
      for (const listener of drops) listener(data.drop);
    }
  });

  const send = async (cmd: string, args: unknown) => {
    await open;
    if (socket.readyState !== WebSocket.OPEN) throw closed;
    const id = nextId++;
    return new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, cmd, args }));
    });
  };

  return {
    kind: "bridge",
    send,
    pickFolder: () => send("pick_folder", null) as Promise<string | null>,
    uninstall: async () => {
      await send("uninstall", null);
    },
    openLink: async (url) => {
      await send("open_link", { url });
    },
    installUpdate: async () => {
      await send("install_update", null);
    },
    onEvent: (listener) => {
      events.add(listener);
      return () => events.delete(listener);
    },
    onFolderDrop: (listener) => {
      drops.add(listener);
      return () => drops.delete(listener);
    },
  };
}
