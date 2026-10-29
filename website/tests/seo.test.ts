import { describe, expect, it } from "vitest";
import { appData, indexedPages, robots, sitemap } from "../src/lib/seo";
import { detectPlatform } from "../src/scripts/platform";

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

  it("describes the app as a free developer tool for macOS, Windows and Linux", () => {
    const data = appData(site, {
      version: "0.2.0",
      date: "2026-10-24T16:48:11Z",
      dmg: { name: "Diffloupe-0.2.0.dmg", url: "https://example.com", size: 1, sha256: "a" },
    });
    expect(data).toMatchObject({
      "@type": "SoftwareApplication",
      softwareVersion: "0.2.0",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "macOS 13 or later, Windows 10 or later, Linux",
      processorRequirements: "arm64, x86_64",
      url: "https://diffloupe.com/",
      image: "https://diffloupe.com/og.jpg",
      offers: { price: "0" },
      downloadUrl: "https://example.com",
      sameAs: "https://github.com/brisote/diff-loupe",
    });
  });
});

describe("detectPlatform", () => {
  it("identifies desktop macOS, Windows and Linux user agents and ignores mobile platforms", () => {
    expect(detectPlatform("macOS", "")).toBe("macos");
    expect(detectPlatform("Windows", "")).toBe("windows");
    expect(detectPlatform("Linux", "")).toBe("linux");
    expect(
      detectPlatform("", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15"),
    ).toBe("macos");
    expect(detectPlatform("", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(detectPlatform("", "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/130.0")).toBe(
      "linux",
    );
    expect(detectPlatform("Android", "Mozilla/5.0 (Linux; Android 11; Pixel 5)")).toBeUndefined();
    expect(
      detectPlatform("", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"),
    ).toBeUndefined();
  });
});
