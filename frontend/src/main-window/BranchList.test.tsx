import { describe, expect, it } from "vitest";
import { filterSections } from "./BranchList";
import { branchSections } from "./BranchPicker";
import { targetSections } from "./TargetPicker";

describe("branch sections", () => {
  it("keeps recent branches out of the local section", () => {
    expect(branchSections(["gs/a", "main"], ["gs/a", "gs/b", "main"], ["origin/main"])).toEqual([
      { title: "Recent", names: ["gs/a", "main"] },
      { title: "Local", names: ["gs/b"] },
      { title: "Remote", names: ["origin/main"] },
    ]);
  });

  it("lists the default branch first and leaves out the current branch as a target", () => {
    expect(
      targetSections(
        "main",
        "gs/a",
        ["gs/a", "gs/b", "main"],
        ["fork/main", "origin/HYDRA-249", "origin/gs/main", "origin/main"],
      ),
    ).toEqual([
      { title: "Default", names: ["main", "origin/main", "fork/main"] },
      { title: "Local", names: ["gs/b"] },
      { title: "Remote", names: ["origin/HYDRA-249", "origin/gs/main"] },
    ]);
    expect(targetSections(null, null, ["dev"], [])[0]).toEqual({ title: "Default", names: [] });
  });

  it("filters by any part of the name and drops empty sections", () => {
    const sections = branchSections(["main"], ["gs/csv-writer"], ["origin/gs/csv-writer"]);
    expect(filterSections(sections, " CSV ")).toEqual([
      { title: "Local", names: ["gs/csv-writer"] },
      { title: "Remote", names: ["origin/gs/csv-writer"] },
    ]);
  });
});
