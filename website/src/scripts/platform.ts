import { type Platform, platforms } from "../lib/release";

interface NavigatorUAData {
  platform?: string;
}

export function detectPlatform(
  uaPlatform = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData
    ?.platform ?? "",
  userAgent = navigator.userAgent ?? "",
): Platform | undefined {
  const combined = `${uaPlatform} ${userAgent}`;
  if (/android|iphone|ipad|ipod/i.test(combined)) return undefined;
  const source = uaPlatform || userAgent;
  if (/mac/i.test(source)) return "macos";
  if (/win/i.test(source)) return "windows";
  if (/linux/i.test(source)) return "linux";
  return undefined;
}

export function choosePlatform() {
  const main = document.querySelector("main");
  if (!main) return;
  const available = new Set(
    [...main.querySelectorAll<HTMLElement>(".dl-hero[id]")].map((section) => section.id),
  );
  const fromHash = (): Platform | undefined => {
    const raw = location.hash.slice(1).replace(/^manual-/, "") as Platform;
    return (platforms as readonly string[]).includes(raw) && available.has(raw) ? raw : undefined;
  };
  const apply = (platform: Platform) => {
    main.dataset.platform = platform;
    for (const tab of main.querySelectorAll<HTMLAnchorElement>(".install-tab")) {
      const match = tab.getAttribute("href") === `#${platform}`;
      if (match) {
        tab.setAttribute("aria-current", "true");
        tab.setAttribute("aria-selected", "true");
      } else {
        tab.removeAttribute("aria-current");
        tab.setAttribute("aria-selected", "false");
      }
    }
    for (const menu of main.querySelectorAll<HTMLDetailsElement>("details.platform-menu"))
      menu.removeAttribute("open");
  };
  const detected = detectPlatform();
  const initial =
    fromHash() ?? (detected && available.has(detected) ? detected : undefined) ?? "macos";
  apply(initial);
  window.addEventListener("hashchange", () => {
    const target = fromHash();
    if (target) apply(target);
  });
  for (const link of main.querySelectorAll<HTMLAnchorElement>(".platform-list a, .install-tab")) {
    link.addEventListener("click", () => {
      const id = link.getAttribute("href")?.slice(1) as Platform | undefined;
      if (id && available.has(id)) apply(id);
    });
  }
  document.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    for (const menu of main.querySelectorAll<HTMLDetailsElement>("details.platform-menu[open]")) {
      if (!target || !menu.contains(target)) menu.removeAttribute("open");
    }
  });
}
