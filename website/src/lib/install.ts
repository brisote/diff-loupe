import type { Release } from "./release";

export function installScript(template: string, release: Release): string {
  const values: Record<string, string> = {
    VERSION: release.version,
    URL: release.dmg.url,
    SHA256: release.dmg.sha256,
  };
  for (const value of Object.values(values))
    if (!/^[\w.:/-]+$/.test(value)) throw new Error(`${value} cannot go into install.sh.`);
  return template.replace(/@([A-Z0-9]+)@/g, (placeholder, name: string) => {
    const value = values[name];
    if (value === undefined)
      throw new Error(`install.sh has an unknown placeholder ${placeholder}.`);
    return value;
  });
}
