import type { APIRoute } from "astro";
import template from "../install/install.sh?raw";
import { installScript } from "../lib/install";
import { latestRelease } from "../lib/release";

export const GET: APIRoute = async () =>
  new Response(installScript(template, await latestRelease()), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
