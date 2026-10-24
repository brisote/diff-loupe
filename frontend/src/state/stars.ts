import { day } from "./updates";

export const starKey = "star.prompt";
export const repository = "https://github.com/brisote/diff-loupe";
export const daysBeforeAsking = 7;
export const daysBeforeAskingAgain = 30;

export type StarPrompt = {
  days: number;
  lastDay: string;
  declined: number;
  declinedAt: number | null;
  done: boolean;
};

export const fresh: StarPrompt = {
  days: 0,
  lastDay: "",
  declined: 0,
  declinedAt: null,
  done: false,
};

export function dayOf(now: number): string {
  const date = new Date(now);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseStars(value: string | null): StarPrompt {
  if (!value) return fresh;
  try {
    const stored: unknown = JSON.parse(value);
    if (typeof stored !== "object" || stored === null) return fresh;
    const read = stored as Partial<Record<keyof StarPrompt, unknown>>;
    return {
      days: typeof read.days === "number" ? read.days : 0,
      lastDay: typeof read.lastDay === "string" ? read.lastDay : "",
      declined: typeof read.declined === "number" ? read.declined : 0,
      declinedAt: typeof read.declinedAt === "number" ? read.declinedAt : null,
      done: read.done === true,
    };
  } catch {
    return fresh;
  }
}

export function used(stars: StarPrompt, now: number): StarPrompt {
  const today = dayOf(now);
  return today > stars.lastDay ? { ...stars, days: stars.days + 1, lastDay: today } : stars;
}

export function due(stars: StarPrompt, now: number): boolean {
  if (stars.done || stars.days < daysBeforeAsking) return false;
  if (stars.declined === 0) return true;
  return (
    stars.declined === 1 &&
    stars.declinedAt !== null &&
    now - stars.declinedAt >= daysBeforeAskingAgain * day
  );
}

export function notNow(stars: StarPrompt, now: number): StarPrompt {
  const declined = stars.declined + 1;
  return { ...stars, declined, declinedAt: now, done: declined >= 2 };
}

export function starred(stars: StarPrompt): StarPrompt {
  return { ...stars, done: true };
}
