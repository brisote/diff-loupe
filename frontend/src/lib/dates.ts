const minute = 60;
const hour = 60 * minute;
const day = 24 * hour;

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function daysBetween(then: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(then)) / (day * 1000));
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function calendarDate(date: Date, now: Date): string {
  const text = `${date.getDate()} ${months[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? text : `${text} ${date.getFullYear()}`;
}

function clock(date: Date): string {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function relativeDate(seconds: number, now = new Date()): string {
  const then = new Date(seconds * 1000);
  const ago = Math.max(0, Math.floor(now.getTime() / 1000 - seconds));
  if (ago < minute) return "Just now";
  if (ago < hour) return `${plural(Math.floor(ago / minute), "minute")} ago`;
  const days = daysBetween(then, now);
  if (days === 0) return `${plural(Math.floor(ago / hour), "hour")} ago`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return calendarDate(then, now);
}

export function fullDate(seconds: number, now = new Date()): string {
  const then = new Date(seconds * 1000);
  const days = daysBetween(then, now);
  const name = days === 0 ? "Today" : days === 1 ? "Yesterday" : calendarDate(then, now);
  return `${name} at ${clock(then)}`;
}
