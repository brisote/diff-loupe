import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SymbolPopup } from "./SymbolPopup";

describe("SymbolPopup", () => {
  const matches = [
    {
      file: "src/ObservationController.java",
      line: 41,
      column: 50,
      preview: "observationService.getLatestObservation(id);",
      isDeclaration: false,
    },
    {
      file: "src/ObservationCronService.java",
      line: 47,
      column: 45,
      preview: "observationService.getLatestObservation(station.id);",
      isDeclaration: false,
    },
  ];

  it("renders matches, navigates with keyboard, and selects on Enter", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <SymbolPopup
        symbol="getLatestObservation"
        matches={matches}
        truncated={false}
        point={{ x: 200, y: 120 }}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("2 usages")).toBeInTheDocument();
    expect(screen.getByText("src/ObservationController.java")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByText("src/ObservationCronService.java")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(matches[1]);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
