import { describe, expect, it } from "vitest";
import { fileIcon } from "./fileIcons";

describe("fileIcon", () => {
  it("maps folders, dotfiles, extensionless files, and common extensions", () => {
    expect(fileIcon("src/")).toBe("dl-i-nodes-folder");
    expect(fileIcon(".gitignore")).toBe("dl-ft-text");
    expect(fileIcon(".gitlab-ci.yml")).toBe("dl-ft-yaml");
    expect(fileIcon("Dockerfile")).toBe("dl-ft-shell");
    expect(fileIcon("Dockerfile.prod")).toBe("dl-ft-shell");
    expect(fileIcon("mvnw")).toBe("dl-ft-shell");
    expect(fileIcon("pom.xml")).toBe("dl-ft-xml");
    expect(fileIcon("README.md")).toBe("dl-ft-markdown");
    expect(fileIcon("analytics.sql")).toBe("dl-ft-sql");
    expect(fileIcon("src/main/resources/application.yml")).toBe("dl-ft-yaml");
    expect(fileIcon("ecowitt-format.txt")).toBe("dl-ft-text");
    expect(fileIcon("settings.json")).toBe("dl-ft-json");
    expect(fileIcon("ObservationService.java")).toBe("dl-ft-java");
    expect(fileIcon("unknown.xyz")).toBe("dl-ft-unknown");
  });
});
