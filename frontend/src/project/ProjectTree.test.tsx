import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fakeCore, renderWithStore, repoInfo } from "../test/render";
import { ProjectTree } from "./ProjectTree";

describe("ProjectTree", () => {
  it("loads root lazily, expands folders on click, and selects files", async () => {
    const listDir = vi.fn((args: unknown) => {
      const { dir } = args as { dir: string };
      if (dir === "") {
        return [
          { name: "src", path: "src", isDir: true, ignored: false },
          { name: "target", path: "target", isDir: true, ignored: true },
          { name: "README.md", path: "README.md", isDir: false, ignored: false },
        ];
      }
      if (dir === "src") {
        return [
          { name: "application.yml", path: "src/application.yml", isDir: false, ignored: false },
        ];
      }
      return [];
    });
    const readFile = vi.fn((args: unknown) => {
      const { file } = args as { file: string };
      return {
        path: file,
        content: "text" as const,
        text: "port: 8080\n",
        crlf: false,
        encoding: "UTF-8",
        size: 11,
      };
    });
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      list_project_dir: listDir,
      read_project_file: readFile,
    });

    const { store } = await renderWithStore(<ProjectTree width={360} />, core);

    await waitFor(() => {
      expect(screen.getByText("src")).toBeInTheDocument();
    });
    expect(screen.getByText("target").closest(".dl-row")).toHaveClass("is-ignored");

    fireEvent.click(screen.getByText("src"));
    await waitFor(() => {
      expect(screen.getByText("application.yml")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("application.yml"));
    await waitFor(() => {
      expect(store.getState().projectSelectedFile).toBe("src/application.yml");
      expect(store.getState().projectFile?.text).toBe("port: 8080\n");
    });

    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    await waitFor(() => {
      expect(screen.queryByText("application.yml")).not.toBeInTheDocument();
    });

    const srcRow = screen.getByText("src").closest(".dl-row");
    expect(srcRow).not.toBeNull();
    if (srcRow) {
      fireEvent.keyDown(srcRow, { key: "Enter" });
      await waitFor(() => {
        expect(screen.getByText("application.yml")).toBeInTheDocument();
      });
    }
  });
});
