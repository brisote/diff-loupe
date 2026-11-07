import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeCore, renderWithStore, repoInfo } from "../test/render";
import { Stripe } from "./Stripe";

describe("Stripe", () => {
  it("renders manual and AI review modes and terminal", async () => {
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
    });
    await renderWithStore(<Stripe />, core);

    const manual = screen.getByRole("button", { name: "Manual review" });
    const ai = screen.getByRole("button", { name: "AI review" });
    const terminal = screen.getByRole("button", { name: /Terminal/ });

    expect(manual).toHaveAttribute("aria-pressed", "true");
    expect(ai).toHaveAttribute("aria-pressed", "false");
    expect(terminal).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(ai);
    expect(manual).toHaveAttribute("aria-pressed", "false");
    expect(ai).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(manual);
    expect(manual).toHaveAttribute("aria-pressed", "true");
    expect(ai).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(terminal);
    expect(terminal).toHaveAttribute("aria-pressed", "true");
  });
});
