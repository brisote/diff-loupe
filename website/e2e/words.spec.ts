import { expect, test } from "@playwright/test";
import { missing, pages } from "./pages";

for (const path of [...pages.map((target) => target.path), missing.path]) {
  test(`${path} says nothing about AI, being offline or network calls, and promises nothing forever`, async ({
    page,
  }) => {
    await page.goto(path);
    const words = await page.evaluate(() =>
      [
        document.title,
        document.body.textContent,
        ...[...document.querySelectorAll("[alt], [aria-label], meta[name=description]")].map(
          (element) =>
            element.getAttribute("alt") ??
            element.getAttribute("aria-label") ??
            element.getAttribute("content"),
        ),
      ].join(" "),
    );
    const description = await page.locator("meta[name=description]").getAttribute("content");
    expect(description).toBeTruthy();
    expect(words).toContain(description);
    expect(words).not.toMatch(/\bAI\b|\bClaude\b|\bagents?\b|forever/i);
    expect(words).not.toMatch(/offline|network call/i);
  });
}
