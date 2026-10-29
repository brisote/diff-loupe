import { repository } from "./links";
import type { Release } from "./release";

export const siteUrl = new URL("https://diffloupe.com");

export const indexedPages = ["/", "/download/", "/changelog/", "/privacy/"];

export function sitemap(site: URL): string {
  const urls = indexedPages
    .map((path) => `  <url><loc>${new URL(path, site).href}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function robots(site: URL): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${new URL("/sitemap.xml", site).href}\n`;
}

export function appData(site: URL, release: Release): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Diffloupe",
    description:
      "An app for reviewing git changes on macOS, Windows and Linux: side-by-side diffs, the branch log, rendered Markdown and a 3-pane merge window.",
    url: site.href,
    image: new URL("/og.jpg", site).href,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "macOS 13 or later, Windows 10 or later, Linux",
    processorRequirements: "arm64, x86_64",
    softwareVersion: release.version,
    downloadUrl: release.dmg.url,
    sameAs: repository,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
}
