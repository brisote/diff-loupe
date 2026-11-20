import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeCore, renderWithStore, repoInfo } from "../test/render";
import { FileViewer } from "./FileViewer";

describe("FileViewer", () => {
  it("renders Markdown by default and switches to Raw", async () => {
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      read_project_file: () => ({
        path: "README.md",
        content: "text",
        text: "# Hello\n\nParagraph text.\n",
        crlf: false,
        encoding: "UTF-8",
        size: 25,
      }),
    });
    const { store } = await renderWithStore(<FileViewer />, core);
    await store.getState().selectProjectFile("README.md");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Rendered" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Raw" }));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Hello" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Raw" })).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("pretty-prints JSON by default and falls back with a banner when invalid", async () => {
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      read_project_file: (args: unknown) => {
        const { file } = args as { file: string };
        return {
          path: file,
          content: "text",
          text: file === "valid.json" ? '{"a":1,"b":2}' : '{"broken": }',
          crlf: false,
          encoding: "UTF-8",
          size: 13,
        };
      },
    });
    const { store } = await renderWithStore(<FileViewer />, core);
    await store.getState().selectProjectFile("valid.json");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pretty" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await store.getState().selectProjectFile("broken.json");
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        /Showing raw text because this file could not be formatted/,
      );
    });
  });

  it("shows empty notice for binary files", async () => {
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      read_project_file: () => ({
        path: "data.bin",
        content: "binary",
        text: "",
        crlf: false,
        encoding: "UTF-8",
        size: 100,
      }),
    });
    const { store } = await renderWithStore(<FileViewer />, core);
    await store.getState().selectProjectFile("data.bin");

    await waitFor(() => {
      expect(screen.getByText("Cannot preview this file")).toBeInTheDocument();
      expect(screen.getByText(/binary file/)).toBeInTheDocument();
    });
  });
});
