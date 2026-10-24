import type { APIRoute } from "astro";
import { sitemap, siteUrl } from "../lib/seo";

export const GET: APIRoute = ({ site }) =>
  new Response(sitemap(site ?? siteUrl), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
