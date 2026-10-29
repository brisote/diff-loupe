import { expect, test } from "@playwright/test";
import { missing, pages } from "./pages";

for (const path of [...pages.map((target) => target.path), missing.path]) {
  test(`${path} works without JavaScript`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(4);
    await expect(page.locator("footer.footer")).toBeVisible();
    const selector =
      path === "/download/"
        ? 'main [data-platform-section="macos"] :is(h1, h2, h3), main .benefits :is(h1, h2, h3)'
        : "main :is(h1, h2, h3)";
    for (const heading of await page.locator(selector).all()) await expect(heading).toBeVisible();
    const scripts = await page
      .locator('script:not([type="application/ld+json"])')
      .evaluateAll((elements) =>
        elements
          .map((element) => element.getAttribute("src") ?? "inline")
          .filter((src) => !src.includes("cloudflareinsights.com")),
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
  await expect(page.locator(".cmd-dark:visible code")).toHaveText(
    "$ curl -fsSL https://diffloupe.com/install.sh | bash",
  );
  await expect(page.locator(".cmd-light:visible code").last()).toHaveText(
    "xattr -dr com.apple.quarantine /Applications/Diffloupe.app",
  );
});

test("the platform tabs and #linux anchor switch to the Linux download section without JavaScript", async ({
  page,
}) => {
  await page.goto("/download/");
  await expect(page.locator("#macos")).toBeVisible();
  await expect(page.locator('#macos .install-tab[href="#macos"]')).toHaveAttribute(
    "aria-current",
    "true",
  );
  await page.locator('#macos .install-tab[href="#linux"]').click();
  await expect(page).toHaveURL(/#linux$/);
  await expect(page.locator("#linux")).toBeVisible();
  await expect(page.locator("#macos")).toBeHidden();
  await expect(page.locator('[data-platform-section="linux"] .install-title')).toHaveText(
    "Paste this in a terminal.",
  );
  await expect(page.getByRole("heading", { name: "Prefer the package?" })).toBeVisible();
  await expect(page.locator(".cmd-light:visible code").first()).toContainText(
    "sudo apt install ./Diffloupe-",
  );
  await page.getByRole("link", { name: "Download the package instead" }).click();
  await expect(page).toHaveURL(/#manual-linux$/);
  await expect(page.locator("#linux")).toBeVisible();
  await expect(page.locator("#macos")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Prefer the package?" })).toBeInViewport();
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
