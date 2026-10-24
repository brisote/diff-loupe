import { describe, expect, it } from "vitest";
import { withoutTerminal } from "../state/store";
import { inputQueue } from "./sessions";
import { sessionTitle } from "./TerminalPanel";

describe("terminal sessions", () => {
  it("names sessions Local, then Local (2) and on", () => {
    expect(sessionTitle(0)).toBe("Local");
    expect(sessionTitle(1)).toBe("Local (2)");
  });

  it("selects the neighbour when the active session closes", () => {
    const group = { ids: ["a", "b", "c"], active: "b" };
    expect(withoutTerminal(group, "b")).toEqual({ ids: ["a", "c"], active: "c" });
    expect(withoutTerminal({ ids: ["a", "b"], active: "b" }, "b")).toEqual({
      ids: ["a"],
      active: "a",
    });
    expect(withoutTerminal(group, "a")).toEqual({ ids: ["b", "c"], active: "b" });
    expect(withoutTerminal({ ids: ["a"], active: "a" }, "a")).toEqual({ ids: [], active: null });
  });

  it("sends typed input in order, one write at a time", async () => {
    const sent: string[] = [];
    let release: () => void = () => undefined;
    const queue = inputQueue(
      (data) =>
        new Promise<void>((done) => {
          sent.push(data);
          release = done;
        }),
    );
    queue("e");
    queue("c");
    queue("h");
    expect(sent).toEqual(["e"]);
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toEqual(["e", "ch"]);
    release();
  });
});
