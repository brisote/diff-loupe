import { expect, test } from "@playwright/test";
import { missing, pages } from "./pages";

for (const path of [...pages.map((target) => target.path), missing.path]) {
  test(`the keyboard reaches every control of ${path} in order with a visible focus ring`, async ({
    page,
    browserName,
  }) => {
    await page.goto(path);
    const expected = await page.evaluate(() =>
      [...document.querySelectorAll("a[href], button, summary, input, select, textarea")]
        .filter((element) => (element as HTMLElement).offsetParent !== null)
        .map((element, index) => {
          element.setAttribute("data-focus-order", String(index));
          return String(index);
        }),
    );
    for (const order of expected) {
      await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
      const focused = page.locator(":focus");
      await expect(focused).toHaveAttribute("data-focus-order", order);
      expect(await focused.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe(
        "none",
      );
    }
  });
}

test("nothing moves when the visitor asks for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});
