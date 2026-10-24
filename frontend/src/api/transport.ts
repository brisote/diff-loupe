import type { ApiError } from "./generated/ApiError";
import type { CoreEvent } from "./generated/CoreEvent";

export type Listener<T> = (value: T) => void;

export interface Transport {
  readonly kind: "tauri" | "bridge";
  send(cmd: string, args: unknown): Promise<unknown>;
  pickFolder(): Promise<string | null>;
  uninstallInfo(): Promise<string[]>;
  uninstall(): Promise<void>;
  openLink(url: string): Promise<void>;
  installUpdate(): Promise<void>;
  onEvent(listener: Listener<CoreEvent>): () => void;
  onFolderDrop(listener: Listener<string>): () => void;
}

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    typeof value.message === "string"
  );
}

export function toApiError(value: unknown): ApiError {
  if (isApiError(value)) return value;
  return {
    code: "io",
    message: value instanceof Error ? value.message : String(value),
    path: null,
  };
}
