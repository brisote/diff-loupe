import { describe, expect, it } from "vitest";
import {
  addFailure,
  cleanMessage,
  failureLimit,
  hidePaths,
  historySize,
  recorded,
  remember,
  reportText,
  unhandled,
} from "./reports";

const env = { version: "0.2.0", os: "macOS 26.1", arch: "aarch64", git: "2.50.1" };
const at = new Date(2026, 9, 24, 14, 12, 5, 42).getTime();
const failure = (message: string) => ({
  at,
  command: "set_ui_value",
  code: "store",
  message,
  detail: null,
  count: 1,
});

describe("error reports", () => {
  it("leaves errors the app explains to their own message", () => {
    const handled = [
      "notARepository",
      "bareRepository",
      "notFound",
      "targetNotFound",
      "notOpen",
      "noRepository",
    ];
    for (const code of [...handled, "cancelled", "gitRefused", "update", "storeVersion"])
      expect(unhandled({ code, message: "", path: null } as never), code).toBe(false);
    for (const code of ["store", "io", "invalidArgs", "unknownCommand", "git", "ui"])
      expect(unhandled({ code, message: "", path: null } as never), code).toBe(true);
  });

  it("keeps the latest twenty commands and leaves terminal traffic out", () => {
    let calls = [] as ReturnType<typeof remember>;
    for (let index = 0; index < historySize + 5; index++)
      calls = remember(calls, { at: index, command: `c${index}`, result: "ok", ms: 1 });
    expect(calls).toHaveLength(historySize);
    expect(calls[0]?.command).toBe(`c${historySize + 4}`);
    expect(recorded("terminal_ack")).toBe(false);
    expect(recorded("status")).toBe(true);
  });

  it("counts a repeated error once and keeps at most ten", () => {
    let failures = addFailure([], failure("locked"));
    failures = addFailure(failures, failure("locked"));
    expect(failures).toHaveLength(1);
    expect(failures[0]?.count).toBe(2);
    for (let index = 0; index < failureLimit + 3; index++)
      failures = addFailure(failures, failure(`m${index}`));
    expect(failures).toHaveLength(failureLimit);
  });

  it("hides the home and every repository folder, only where a path ends", () => {
    expect(
      hidePaths(
        "/Users/ada/work/acme/a.txt, /Users/ada/work/acme-billing, /Volumes/x/repo and /Users/adam",
        "/Users/ada/",
        ["/Users/ada/work/acme", "/Volumes/x/repo"],
      ),
    ).toBe("<repository>/a.txt, ~/work/acme-billing, <repository> and /Users/adam");
  });

  it("drops quoted values from invalid arguments", () => {
    expect(cleanMessage("invalidArgs", 'invalid type: string "secret.txt", expected u32')).toBe(
      'invalid type: string "…", expected u32',
    );
    expect(cleanMessage("store", 'database "state.db" is locked')).toBe(
      'database "state.db" is locked',
    );
  });

  it("writes the versions, the build, the screen, the error and the recent commands", () => {
    const text = reportText(
      env,
      { screen: "Changes, terminal open", build: "tauri, production" },
      [{ ...failure("storage failed"), count: 3, detail: "TypeError: x\n    at render" }],
      [{ at, command: "set_ui_value", result: "store", ms: 5002.4 }],
    );
    expect(text).toContain("- Diffloupe 0.2.0 on macOS 26.1 (aarch64), git 2.50.1");
    expect(text).toContain("- Build: tauri, production");
    expect(text).toContain("- Screen: Changes, terminal open");
    expect(text).toContain(
      "- Error: `store` in `set_ui_value` at 14:12:05.042 on 2026-10-24 (3 times)",
    );
    expect(text).toContain("TypeError: x");
    expect(text).toContain("| 14:12:05.042 | set_ui_value | store | 5002 |");
  });
});
