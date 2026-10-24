export function displayPath(path: string, home: string | null | undefined): string {
  if (home && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`;
  return path;
}

export function splitPath(path: string): { name: string; folder: string } {
  if (path.endsWith("/")) path = path.slice(0, -1);
  const slash = path.lastIndexOf("/");
  return slash < 0
    ? { name: path, folder: "" }
    : { name: path.slice(slash + 1), folder: path.slice(0, slash) };
}
