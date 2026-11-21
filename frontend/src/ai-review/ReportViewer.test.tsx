import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReportViewer } from "./ReportViewer";

const sampleReport = JSON.stringify({
  overview: "Review of billing export changes",
  blast_radius: "Billing export pipeline",
  deployment_risks: "None",
  rollback_plan: "Revert commit",
  categories: [
    {
      id: "concurrency",
      score: 5,
      summary: "Pipe deadlock found.",
      problems: [
        {
          severity: "high",
          title: "Pipe deadlock",
          location: "project.rs:293",
          description: "Writes stdin before reading stdout.",
        },
      ],
    },
    {
      id: "error_handling",
      score: 6,
      summary: "Swallowed errors.",
      problems: [
        {
          severity: "medium",
          title: "Swallowed git error",
          location: "project.rs:206",
          description: "Returns empty vec.",
        },
        {
          severity: "low",
          title: "Minor log omission",
          location: "project.rs:205",
          description: "Discards stderr.",
        },
      ],
    },
    {
      id: "test_coverage",
      score: 8,
      coverage_percent: 82,
      summary: "Good coverage.",
      test_scenarios: ["Covers core commands"],
      problems: [],
    },
  ],
});

describe("ReportViewer severity filters and click-outside collapse", () => {
  it("hides category detail when clicking outside, but keeps it open when clicking inside", () => {
    render(
      <div>
        <button type="button">Outside target</button>
        <ReportViewer markdown={sampleReport} onAskSelection={vi.fn()} />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Test coverage/ }));
    expect(screen.getByRole("region", { name: "Selected category details" })).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByText("Good coverage."));
    expect(screen.getByRole("region", { name: "Selected category details" })).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside target" }));
    expect(
      screen.queryByRole("region", { name: "Selected category details" }),
    ).not.toBeInTheDocument();
  });

  it("renders High, Medium, Low, All buttons in order with counts, filters across categories, and collapses on second click or outside click", () => {
    render(
      <div>
        <button type="button">Outside target</button>
        <ReportViewer markdown={sampleReport} onAskSelection={vi.fn()} />
      </div>,
    );

    const group = screen.getByRole("group", { name: "Issues by severity" });
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["High1", "Medium1", "Low1", "All3"]);

    fireEvent.click(screen.getByRole("button", { name: /High/ }));
    const highPanel = screen.getByRole("region", { name: "Filtered issues" });
    expect(highPanel).toHaveTextContent("Pipe deadlock");
    expect(highPanel).not.toHaveTextContent("Swallowed git error");

    fireEvent.click(screen.getByRole("button", { name: /High/ }));
    expect(screen.queryByRole("region", { name: "Filtered issues" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /All/ }));
    const allPanel = screen.getByRole("region", { name: "Filtered issues" });
    expect(allPanel).toHaveTextContent("Pipe deadlock");
    expect(allPanel).toHaveTextContent("Swallowed git error");
    expect(allPanel).toHaveTextContent("Minor log omission");

    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside target" }));
    expect(screen.queryByRole("region", { name: "Filtered issues" })).not.toBeInTheDocument();
  });
});
