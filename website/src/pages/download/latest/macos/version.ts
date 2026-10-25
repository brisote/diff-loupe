import type { APIRoute } from "astro";
import { latestRelease } from "../../../../lib/release";

export const GET: APIRoute = async () =>
  new Response(`${(await latestRelease()).version}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
