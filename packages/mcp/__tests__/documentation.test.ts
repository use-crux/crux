import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

function read(path: string): string {
  return readFileSync(join(repositoryRoot, path), "utf8");
}

describe("MCP documentation", () => {
  it("covers the complete public and operational contract", () => {
    const packageReadme = read("packages/mcp/README.md");
    const guide = read("apps/docs/content/docs/guides/tools/mcp.mdx");
    const reference = read("apps/docs/content/docs/reference/mcp.mdx");
    const coreReadme = read("packages/core/README.md");
    const coreArchitecture = read("packages/core/ARCHITECTURE.md");
    const corpus = [packageReadme, guide, reference].join("\n");

    for (const required of [
      "streamableHttp",
      "stdio",
      "runtimeContext",
      "tools: { allow:",
      "prefix:",
      "toolMiddleware",
      "toolPolicy",
      "appendToolApprovalResponse",
      "target.agent",
      "Run Detail",
      "Catalog",
      "redirect",
      "provider-hosted",
      "sampling",
      "elicitation",
      "tasks",
    ]) {
      expect(corpus.toLowerCase(), required).toContain(required.toLowerCase());
    }

    expect(corpus).toMatch(/live MCP.+(change|affect).+real systems/is);
    expect(corpus).toMatch(/allowlist/i);
    expect(corpus).toMatch(/secret/i);
    expect(coreReadme).toContain("@use-crux/mcp");
    expect(coreArchitecture.toLowerCase()).toContain("tool-source boundary");
  });

  it("registers the guide and reference in docs navigation", () => {
    expect(read("apps/docs/content/docs/guides/tools/meta.json")).toContain(
      '"mcp"',
    );
    expect(read("apps/docs/content/docs/reference/meta.json")).toContain(
      '"mcp"',
    );
  });
});
