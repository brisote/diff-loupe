import type { LinuxRelease, MacosRelease, WindowsRelease } from "./release";

export function installScript(template: string, macos: MacosRelease, linux?: LinuxRelease): string {
  const required: Record<string, string> = {
    VERSION: macos.version,
    URL: macos.dmg.url,
    SHA256: macos.dmg.sha256,
  };
  const optional: Record<string, string> = {
    LINUX_VERSION: linux?.version ?? "",
    DEB_URL: linux?.deb.url ?? "",
    DEB_SHA256: linux?.deb.sha256 ?? "",
    RPM_URL: linux?.rpm.url ?? "",
    RPM_SHA256: linux?.rpm.sha256 ?? "",
  };
  for (const value of Object.values(required))
    if (!/^[\w.:/-]+$/.test(value)) throw new Error(`${value} cannot go into install.sh.`);
  for (const value of Object.values(optional))
    if (value && !/^[\w.:/-]+$/.test(value)) throw new Error(`${value} cannot go into install.sh.`);
  const values: Record<string, string> = { ...required, ...optional };
  return template.replace(/@([A-Z0-9_]+)@/g, (placeholder, name: string) => {
    const value = values[name];
    if (value === undefined)
      throw new Error(`install.sh has an unknown placeholder ${placeholder}.`);
    return value;
  });
}

export function installPs1Script(template: string, windows?: WindowsRelease): string {
  const values: Record<string, string> = {
    WINDOWS_VERSION: windows?.version ?? "",
    SETUP_URL: windows?.setup.url ?? "",
    SETUP_SHA256: windows?.setup.sha256 ?? "",
  };
  for (const value of Object.values(values))
    if (value && !/^[\w.:/-]+$/.test(value))
      throw new Error(`${value} cannot go into install.ps1.`);
  return template.replace(/@([A-Z0-9_]+)@/g, (placeholder, name: string) => {
    const value = values[name];
    if (value === undefined)
      throw new Error(`install.ps1 has an unknown placeholder ${placeholder}.`);
    return value;
  });
}
