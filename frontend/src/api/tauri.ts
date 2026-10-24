import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { CoreEvent } from "./generated/CoreEvent";
import type { Transport } from "./transport";

function later(subscribe: Promise<() => void>): () => void {
  let stop: (() => void) | undefined;
  let stopped = false;
  void subscribe.then((unlisten) => {
    if (stopped) unlisten();
    else stop = unlisten;
  });
  return () => {
    stopped = true;
    stop?.();
  };
}

export function tauriTransport(): Transport {
  return {
    kind: "tauri",
    send: (cmd, args) => invoke("dispatch", { cmd, args }),
    pickFolder: () => invoke<string | null>("pick_folder"),
    uninstall: () => invoke<void>("uninstall"),
    openLink: (url) => invoke<void>("open_link", { url }),
    installUpdate: () => invoke<void>("install_update"),
    onEvent: (listener) =>
      later(listen<CoreEvent>("core-event", (event) => listener(event.payload))),
    onFolderDrop: (listener) =>
      later(
        getCurrentWebview().onDragDropEvent((event) => {
          const path = event.payload.type === "drop" ? event.payload.paths[0] : undefined;
          if (path) listener(path);
        }),
      ),
  };
}
