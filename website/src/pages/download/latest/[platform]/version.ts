import type { APIRoute, GetStaticPaths } from "astro";
import { latestFor, type Platform, platforms } from "../../../../lib/release";

export const getStaticPaths: GetStaticPaths = async () => {
  const entries = await Promise.all(
    platforms.map(async (platform) => {
      const release = await latestFor(platform);
      return release ? [{ params: { platform }, props: { version: release.version } }] : [];
    }),
  );
  return entries.flat();
};

export const GET: APIRoute = async ({ props, params }) => {
  const version =
    (props as { version?: string } | undefined)?.version ??
    (await latestFor(params.platform as Platform))?.version;
  if (!version) return new Response("Not found\n", { status: 404 });
  return new Response(`${version}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
