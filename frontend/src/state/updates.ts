import type { UpdateCheck, UpdateState } from "../api";

export const laterKey = "update.later";
export const lastCheckKey = "update.lastCheck";
export const hour = 60 * 60 * 1000;
export const day = 24 * hour;

export type Later = { version: string; until: number };

export type UpdateInstall =
  | { state: "idle" }
  | { state: "downloading"; check: UpdateCheck }
  | { state: "ready"; check: UpdateCheck }
  | { state: "installing"; check: UpdateCheck }
  | { state: "failed"; check: UpdateCheck; message: string };

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "done"; check: UpdateCheck }
  | { state: "failed"; message: string };

export function parseLater(value: string | null): Later | null {
  if (!value) return null;
  try {
    const later: unknown = JSON.parse(value);
    if (
      typeof later === "object" &&
      later !== null &&
      "version" in later &&
      "until" in later &&
      typeof later.version === "string" &&
      typeof later.until === "number"
    )
      return { version: later.version, until: later.until };
  } catch {
    return null;
  }
  return null;
}

export function offered(check: UpdateCheck, later: Later | null, now: number): boolean {
  return check.newer && !(later && later.version === check.latest && now < later.until);
}

export function parseTime(value: string | null): number {
  const time = Number(value);
  return Number.isFinite(time) ? time : 0;
}

export function restored(pending: UpdateState | null, current: string): UpdateInstall {
  if (!pending?.page) return { state: "idle" };
  const check = { current, latest: pending.ready ?? "", newer: true, page: pending.page };
  if (pending.ready) return { state: "ready", check };
  if (pending.failure) return { state: "failed", check, message: pending.failure };
  return { state: "idle" };
}
