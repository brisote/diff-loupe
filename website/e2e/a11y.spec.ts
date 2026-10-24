import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { missing, pages } from "./pages";

test.use({ reducedMotion: "reduce" });

for (const path of [...pages.map((target) => target.path), missing.path]) {
  test(`${path} has no accessibility violations`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
      .analyze();
    expect(
      results.violations.map(
        (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(", ")}`,
      ),
    ).toEqual([]);
  });
}
