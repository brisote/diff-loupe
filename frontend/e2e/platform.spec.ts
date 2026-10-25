import { expect, hostPlatform, type PlatformName, test } from "./fixtures";

for (const platform of ["macos", "windows", "linux"] as PlatformName[]) {
  test(`the dev bridge can pose as ${platform}`, async ({ startApp }) => {
    const app = await startApp({ platform });
    const info = (await app.bridge.call("app_info")) as { platform: string };
    expect(info.platform).toBe(platform);
  });
}

test("the dev bridge reports its own platform by default", async ({ startApp }) => {
  const app = await startApp({ platform: undefined });
  const info = (await app.bridge.call("app_info")) as { platform: string };
  expect(["macos", "windows", "linux"]).toContain(info.platform);
  const report = (await app.bridge.call("report_env")) as { os: string | null; arch: string };
  expect(report.os).toBeTruthy();
  expect(hostPlatform).toBeTruthy();
});
