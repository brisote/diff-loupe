import { describe, expect, it } from "vitest";
import { appData, indexedPages, robots, sitemap } from "../src/lib/seo";

const site = new URL("https://diffloupe.com");

describe("seo", () => {
  it("lists every indexed page in the sitemap with its full address", () => {
    const xml = sitemap(site);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect([...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1])).toEqual(
      indexedPages.map((path) => `https://diffloupe.com${path}`),
    );
  });

  it("allows every crawler and points it to the sitemap", () => {
    expect(robots(site)).toBe(
      "User-agent: *\nAllow: /\n\nSitemap: https://diffloupe.com/sitemap.xml\n",
    );
  });

  it("describes the app as a free macOS developer tool of the latest release", () => {
    const data = appData(site, {
      version: "0.2.0",
      date: "2026-10-24T16:48:11Z",
      dmg: { name: "Diffloupe-0.2.0.dmg", url: "https://example.com", size: 1, sha256: "a" },
    });
    expect(data).toMatchObject({
      "@type": "SoftwareApplication",
      softwareVersion: "0.2.0",
      applicationCategory: "DeveloperApplication",
      url: "https://diffloupe.com/",
      image: "https://diffloupe.com/og.jpg",
      offers: { price: "0" },
      downloadUrl: "https://example.com",
      sameAs: "https://github.com/brisote/diff-loupe",
    });
  });
});
