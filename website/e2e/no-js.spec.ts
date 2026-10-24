import { expect, test } from "@playwright/test";
import { missing, pages } from "./pages";

for (const path of [...pages.map((target) => target.path), missing.path]) {
  test(`${path} works without JavaScript`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(4);
    await expect(page.locator("footer.footer")).toBeVisible();
    for (const heading of await page.locator("main :is(h1, h2, h3)").all())
      await expect(heading).toBeVisible();
    const scripts = await page
      .locator("script")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("src") ?? "inline"),
      );
    expect(scripts).toEqual(
      ["/", "/download/"].includes(path) ? [expect.stringMatching(/^\/_astro\/.+\.js$/)] : [],
    );
  });
}

test("the header links work without JavaScript", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Changelog" })
    .click();
  await expect(page).toHaveURL("/changelog/");
});

test("the install commands are readable text without JavaScript", async ({ page }) => {
  await page.goto("/download/");
  await expect(page.locator(".cmd-dark code")).toHaveText(
    "$ curl -fsSL https://diffloupe.com/install.sh | bash",
  );
  await expect(page.locator(".cmd-light code").last()).toHaveText(
    "xattr -dr com.apple.quarantine /Applications/Diffloupe.app",
  );
});

test("the star panels and the GitHub links show without JavaScript", async ({ page }) => {
  const repository = "https://github.com/brisote/diff-loupe";
  await page.goto("/download/");
  await expect(page.locator("[data-star-panel]:visible")).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Diffloupe on GitHub" })).toHaveAttribute(
    "href",
    repository,
  );
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Open source" }).first()).toHaveAttribute(
    "href",
    repository,
  );
});
