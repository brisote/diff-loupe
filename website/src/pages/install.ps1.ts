import type { APIRoute } from "astro";
import template from "../install/install.ps1?raw";
import { installPs1Script } from "../lib/install";
import { latestFor } from "../lib/release";

export const GET: APIRoute = async () =>
  new Response(installPs1Script(template, await latestFor("windows")), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
