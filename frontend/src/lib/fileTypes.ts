export function fileExtension(path: string): string | null {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : null;
}

export function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}
