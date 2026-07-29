import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("public extension metadata", () => {
  it("publishes repository, support, license, and LSP documentation metadata", () => {
    expect(manifest.private).toBeUndefined();
    expect(manifest.license).toBe("Apache-2.0");
    expect(manifest.repository).toEqual({
      type: "git",
      url: "https://github.com/use-crux/crux.git",
      directory: "packages/vscode",
    });
    expect(manifest.bugs).toEqual({
      url: "https://github.com/use-crux/crux/issues",
    });
    expect(manifest.homepage).toBe("https://cruxjs.dev/docs/reference/lsp");
  });

  it("links installation, support, repository, license, and LSP references", () => {
    expect(readme).toContain("## Install the extension and CLI");
    expect(readme).toContain("https://github.com/use-crux/crux/releases");
    expect(readme).toContain("https://github.com/use-crux/crux/issues");
    expect(readme).toContain("https://github.com/use-crux/crux");
    expect(readme).toContain("https://www.apache.org/licenses/LICENSE-2.0");
    expect(readme).toContain("https://cruxjs.dev/docs/reference/lsp");
  });

  it("publishes the latest PromptText Run command", () => {
    expect(manifest.contributes.commands).toContainEqual({
      command: "crux.promptText.openLatestRun",
      title: "Crux: Open Latest PromptText Run",
    });
  });
});
