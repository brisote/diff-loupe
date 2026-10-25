const verbatim = /^\\\\\?\\/;

export function isWindowsPath(path: string): boolean {
  const plain = path.replace(verbatim, "");
  return /^[A-Za-z]:[\\/]/.test(plain) || plain.startsWith("\\\\");
}

export function displayPath(path: string, home: string | null | undefined): string {
  if (!home) return path;
  const windows = isWindowsPath(home);
  const plain = (value: string) =>
    windows ? value.replace(verbatim, "").replace(/\//g, "\\") : value;
  const shown = plain(path);
  const base = plain(home).replace(/[\\/]+$/, "");
  if (!base) return path;
  const same = (left: string, right: string) =>
    windows ? left.toLowerCase() === right.toLowerCase() : left === right;
  if (same(shown, base)) return "~";
  const inside = shown.length > base.length && /[\\/]/.test(shown.charAt(base.length));
  if (inside && same(shown.slice(0, base.length), base)) return `~${shown.slice(base.length)}`;
  return path;
}

export function splitPath(path: string): { name: string; folder: string } {
  if (path.endsWith("/")) path = path.slice(0, -1);
  const slash = path.lastIndexOf("/");
  return slash < 0
    ? { name: path, folder: "" }
    : { name: path.slice(slash + 1), folder: path.slice(0, slash) };
}
