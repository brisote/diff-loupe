import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fetchReleases } from "../src/lib/release";
import { liveReleases } from "./live";

export default async function liveSetup() {
  mkdirSync(dirname(liveReleases), { recursive: true });
  writeFileSync(liveReleases, JSON.stringify(await fetchReleases()));
}
