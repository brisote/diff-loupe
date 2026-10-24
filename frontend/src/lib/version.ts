export function shortVersion(version: string): string {
  return version.replace(/\.0$/, "");
}

export function buildMonth(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
