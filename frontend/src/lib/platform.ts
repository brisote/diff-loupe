import type { Platform } from "../api";
import { useApp } from "../state/context";

export type { Platform };

export function platformOf(info: { platform: Platform } | null | undefined): Platform {
  return info?.platform ?? "macos";
}

export function usePlatform(): Platform {
  return useApp((state) => platformOf(state.info));
}

export function hasModifier(
  platform: Platform,
  event: { metaKey: boolean; ctrlKey: boolean; altKey: boolean },
): boolean {
  return platform === "macos" ? event.metaKey : event.ctrlKey && !event.altKey;
}

export function shortcut(platform: Platform, keys: string): string {
  const parts = keys.split("+");
  const key = parts[parts.length - 1] ?? "";
  const has = (name: string) => parts.slice(0, -1).includes(name);
  if (platform === "macos") {
    return `${has("Alt") ? "⌥" : ""}${has("Shift") ? "⇧" : ""}${has("Mod") ? "⌘" : ""}${key}`;
  }
  return [has("Mod") ? "Ctrl" : null, has("Alt") ? "Alt" : null, has("Shift") ? "Shift" : null, key]
    .filter(Boolean)
    .join("+");
}
