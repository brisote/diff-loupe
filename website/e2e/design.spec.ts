import { expect, type Page, test } from "@playwright/test";
import {
  boardName,
  compare,
  designDir,
  designPresent,
  loadImages,
  openBoard,
  scene,
  screenshots,
  shot,
  tolerance,
} from "./design";
import { missing, pages } from "./pages";
import { siteUrl } from "./release";

test.use({ reducedMotion: "reduce" });

test.skip(Boolean(siteUrl), "the live run checks the deployed build, which passed this comparison");

test.skip(
  !designPresent && Boolean(process.env.CI),
  "the private design checkout is absent, so the design comparison runs on the Mac only",
);

test.beforeAll(() => {
  if (!designPresent)
    throw new Error(
      `the design checkout is missing at ${designDir}; clone brisote/diffloupe-design next to this repository or set DIFFLOUPE_DESIGN_DIR`,
    );
});

const pageOverlap = 40;

async function withBoard(
  page: Page,
  board: string,
  theme: "light" | "dark",
  check: (boardPage: Page) => Promise<void>,
) {
  const boardPage = await page
    .context()
    .browser()
    ?.newPage({ viewport: page.viewportSize(), colorScheme: theme });
  if (!boardPage) throw new Error("no browser for the board");
  try {
    await openBoard(boardPage, boardName(board, page.viewportSize()?.width ?? 1440), theme);
    await check(boardPage);
  } finally {
    await boardPage.close();
  }
}

function text(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function comparePart(page: Page, boardPage: Page, part: "header" | "footer", name: string) {
  const boardPart = boardPage.locator(`.${part}`);
  const sitePart = page.locator(`.${part}`);
  expect(text(await sitePart.innerText()), `${part} text`).toBe(text(await boardPart.innerText()));
  const skipTop = part === "footer" ? pageOverlap : 0;
  const ratio = compare(name, await shot(boardPart, skipTop), await shot(sitePart, skipTop));
  expect(ratio, `${part} differs from the board`).toBeLessThanOrEqual(tolerance);
}

function themeOf(colorScheme: unknown): "light" | "dark" {
  return colorScheme === "dark" ? "dark" : "light";
}

test("the 404 page matches its board", async ({ page }, info) => {
  await page.goto(missing.path);
  await page.evaluate(() => document.fonts.ready);
  await withBoard(page, missing.board, themeOf(info.project.use.colorScheme), async (boardPage) => {
    expect(text(await page.locator("main").innerText())).toBe(
      text(await boardPage.locator("main").innerText()),
    );
    const ratio = compare(`404-${info.project.name}`, await shot(boardPage), await shot(page));
    expect(ratio).toBeLessThanOrEqual(tolerance);
  });
});

for (const target of pages) {
  const boards = target.boards;
  if (!boards) continue;
  test(`${target.path} matches its boards section by section`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.goto(target.path);
    await page.evaluate(() => document.fonts.ready);
    await loadImages(page);
    await page.evaluate(() => {
      for (const panel of document.querySelectorAll<HTMLElement>("[data-star-panel]"))
        panel.dataset.shown = "";
    });
    const parts = page.locator("main > :not(script)");
    let index = 0;
    for (const board of boards) {
      await withBoard(page, board, themeOf(info.project.use.colorScheme), async (boardPage) => {
        const boardParts = boardPage.locator("main > *");
        for (const boardPart of await boardParts.all()) {
          const part = parts.nth(index);
          const name = `${board}-${index}-${info.project.name}`;
          expect
            .soft(text(await part.innerText()), `${name} text`)
            .toBe(text(await boardPart.innerText()));
          const boardShots = await screenshots(boardPart);
          const siteShots = await screenshots(part);
          const scenes = async (images: typeof boardShots) => Promise.all(images.map(scene));
          expect
            .soft(await scenes(siteShots), `${name} screenshots`)
            .toEqual(await scenes(boardShots));
          const ratio = compare(
            name,
            await shot(boardPart, 0, boardShots),
            await shot(part, 0, siteShots),
          );
          expect.soft(ratio, `${name} differs from the board`).toBeLessThanOrEqual(tolerance);
          index++;
        }
      });
    }
    expect(index).toBe(await parts.count());
  });
}

for (const target of pages) {
  test(`the header and footer of ${target.path} match their boards`, async ({ page }, info) => {
    const theme = themeOf(info.project.use.colorScheme);
    const footerBoard = target.footerBoard ?? target.board;
    await page.goto(target.path);
    await page.evaluate(() => document.fonts.ready);
    await withBoard(page, target.board, theme, (boardPage) =>
      comparePart(page, boardPage, "header", `${target.board}-header-${info.project.name}`),
    );
    await withBoard(page, footerBoard, theme, (boardPage) =>
      comparePart(page, boardPage, "footer", `${footerBoard}-footer-${info.project.name}`),
    );
  });
}
