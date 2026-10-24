import type { APIRoute } from "astro";
import { robots, siteUrl } from "../lib/seo";

export const GET: APIRoute = ({ site }) =>
  new Response(robots(site ?? siteUrl), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
