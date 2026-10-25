import { fileURLToPath } from "node:url";

export const siteUrl = process.env.SITE_URL;
export const liveReleases = fileURLToPath(new URL("../target/live-releases.json", import.meta.url));
