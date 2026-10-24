import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Boundary } from "./boundary";

function Broken(): never {
  throw new TypeError("broken view");
}

describe("the boundary", () => {
  it("reports a crashed view with its component stack", () => {
    const onError = vi.fn();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <Boundary onError={onError}>
        <Broken />
      </Boundary>,
    );
    quiet.mockRestore();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0])).toContain("broken view");
    expect(onError.mock.calls[0]?.[1]).toContain("Broken");
    expect(screen.queryByText("broken view")).toBeNull();
  });
});
