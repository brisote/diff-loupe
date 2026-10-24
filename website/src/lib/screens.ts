import type { ImageMetadata } from "astro";
import manifest from "../assets/screens/manifest.json";
import { findScene } from "./manifest";

const files = import.meta.glob<{ default: ImageMetadata }>("../assets/screens/*.png", {
  eager: true,
});

function file(name: string): ImageMetadata {
  const image = files[`../assets/screens/${name}`]?.default;
  if (!image) throw new Error(`The screenshot ${name} is missing.`);
  return image;
}

export function screen(name: string) {
  const scene = findScene(manifest.scenes, name);
  return { ...scene, light: file(`${name}-light.png`), dark: file(`${name}-dark.png`) };
}
