import type { APIRoute } from "astro";
import template from "../install/install.sh?raw";
import { installScript } from "../lib/install";
import { latestFor, latestRelease } from "../lib/release";

export const GET: APIRoute = async () =>
  new Response(installScript(template, await latestRelease(), await latestFor("linux")), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
