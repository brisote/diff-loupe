import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const designDir = resolve(
  process.env.DIFFLOUPE_DESIGN_DIR ?? join(root, "../diffloupe-design"),
);
const design = join(designDir, "website");
export const designPresent = existsSync(join(design, "assets.json"));
const assets: Record<string, string> = designPresent
  ? JSON.parse(readFileSync(join(design, "assets.json"), "utf8"))
  : {};
const diffs = join(root, "website/target/design-diff");

export const tolerance = 0.025;
const slack = 4;

export function boardHtml(source: string, theme: "light" | "dark"): string {
  const body = source.split("<x-dc>")[1]?.split("</x-dc>")[0] ?? "";
  const style = body.match(/<helmet>\s*<style>([\s\S]*?)<\/style>\s*<\/helmet>/)?.[1] ?? "";
  const content = body.replace(/<helmet>[\s\S]*?<\/helmet>/, "").replaceAll("{{theme}}", theme);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<link rel="stylesheet" href="/__design/site.css"><style>${style}</style></head><body>${content}</body></html>`.replace(
    /\/_blob\/([0-9a-f]{32})/g,
    "/__design/files/$1",
  );
}

export function boardName(page: string, width: number): string {
  return width < 768 ? `${page}Phone` : page;
}

export async function openBoard(page: Page, board: string, theme: "light" | "dark") {
  await page.route("**/__design/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace("/__design/", "");
    if (path === "board.html") {
      return route.fulfill({
        contentType: "text/html",
        body: boardHtml(readFileSync(join(design, `${board}.dc.html`), "utf8"), theme),
      });
    }
    if (path === "site.css") return route.fulfill({ path: join(design, "site.css") });
    const id = path.replace("files/", "");
    const file = assets[id];
    return file ? route.fulfill({ path: join(designDir, file) }) : route.fulfill({ status: 404 });
  });
  await page.goto("/__design/board.html");
  await page.evaluate(() => document.fonts.ready);
}

export function compare(name: string, board: Buffer, site: Buffer): number {
  const a = PNG.sync.read(board);
  const b = PNG.sync.read(site);
  mkdirSync(diffs, { recursive: true });
  writeFileSync(join(diffs, `${name}-board.png`), board);
  writeFileSync(join(diffs, `${name}-site.png`), site);
  if (Math.abs(a.width - b.width) > slack || Math.abs(a.height - b.height) > slack) {
    throw new Error(
      `${name}: the board is ${a.width}×${a.height} and the page is ${b.width}×${b.height}`,
    );
  }
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const diff = new PNG({ width, height });
  const changed = pixelmatch(
    crop(a, width, height),
    crop(b, width, height),
    diff.data,
    width,
    height,
    { threshold: 0.1 },
  );
  writeFileSync(join(diffs, `${name}-diff.png`), PNG.sync.write(diff));
  const ratio = changed / (width * height);
  if (process.env.DESIGN_RATIOS) console.log(`design ${name} ${ratio.toFixed(5)}`);
  return ratio;
}

function crop(image: PNG, width: number, height: number): Buffer {
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    image.data.copy(out, y * width * 4, y * image.width * 4, (y * image.width + width) * 4);
  return out;
}

export async function shot(
  target: Page | Locator,
  skipTop = 0,
  mask: Locator[] = [],
): Promise<Buffer> {
  const options = { fullPage: true, animations: "disabled", caret: "hide", mask } as const;
  if ("goto" in target) return target.screenshot(options);
  const box = await target.boundingBox();
  if (!box) throw new Error("the element to compare is not visible");
  return target.page().screenshot({
    ...options,
    clip: { x: box.x, y: box.y + skipTop, width: box.width, height: box.height - skipTop },
  });
}

export async function scene(image: Locator): Promise<string> {
  const source = await image.evaluate(
    (element: HTMLImageElement) => element.currentSrc || element.src,
  );
  const path = new URL(source).pathname;
  const id = path.match(/\/__design\/files\/([0-9a-f]{32})$/)?.[1];
  const file = id ? (assets[id] ?? "") : path;
  return file.split("/").pop()?.split(".")[0] ?? "";
}

export async function screenshots(part: Locator): Promise<Locator[]> {
  const found: Locator[] = [];
  for (const image of await part.locator("img").all()) {
    const box = await image.boundingBox();
    if (box && box.width >= 200 && box.height >= 120) found.push(image);
  }
  return found;
}

export async function loadImages(page: Page) {
  await page.evaluate(async () => {
    const images = [...document.images];
    for (const image of images) image.loading = "eager";
    await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
  });
}
