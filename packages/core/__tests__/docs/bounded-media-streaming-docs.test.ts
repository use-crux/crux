import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

function read(path: string): string {
  return readFileSync(`${root}${path}`, "utf8");
}

describe("bounded media streaming documentation", () => {
  it("keeps the guide examples complete and copyable", () => {
    const guide = read(
      "apps/docs/content/docs/guides/advanced/bounded-media-streaming.mdx",
    );

    for (const fragment of [
      'import OpenAI from "openai"',
      'import { createOpenAI } from "@use-crux/openai"',
      "const openai = createOpenAI(",
      "const previews = new Map<number, Asset>()",
      'import { GoogleGenAI } from "@google/genai"',
      'import { createGoogle } from "@use-crux/google"',
      "const google = createGoogle(",
      "const audioChunks: Uint8Array[] = []",
      "`streamImage` and `streamSpeech`",
    ]) {
      expect(guide, fragment).toContain(fragment);
    }
  });

  it("documents the public Core and provider contracts", () => {
    expect(
      read("apps/docs/content/docs/reference/crux-core/multimodal.mdx"),
    ).toContain("## Bounded media streams");

    const openai = read("apps/docs/content/docs/reference/adapters/openai.mdx");
    expect(openai).toContain("### `adapter.streamImage(options)`");
    expect(openai).toContain("### `adapter.streamSpeech(options)`");

    const google = read("apps/docs/content/docs/reference/adapters/google.mdx");
    expect(google).toContain("### `adapter.streamImage(options)`");
    expect(google).toContain("### `adapter.streamSpeech(options)`");
    expect(google).toContain(
      "All five specialized media operations use the portable media-operation Safety contracts",
    );
    expect(google).not.toContain("All three operations");
  });

  it("documents authored and executed product behavior", () => {
    expect(
      read("apps/docs/content/docs/reference/crux-core/project-index.mdx"),
    ).toContain("`streamImage` and `streamSpeech`");
    expect(
      read("apps/docs/content/docs/guides/observability/devtools.mdx"),
    ).toContain("bounded media stream");
    const runs = read(
      "apps/docs/content/docs/guides/observability/runs-and-delivery.mdx",
    );
    expect(runs).toContain("Physical attempts");
    expect(runs.replace(/\s+/g, " ")).toContain(
      "Each physical attempt row owns its preview/delta/final counts",
    );

    const observability = read(
      "apps/docs/content/docs/reference/crux-core/observability.mdx",
    );
    expect(observability).toContain("`streamingRole`");
    expect(observability.replace(/\s+/g, " ")).toContain(
      '`kind: "media.operation"` and `role: "invoked-media-operation"`',
    );
  });

  it("requires Google SDK 2.x everywhere that states the peer range", () => {
    const googleReference = read(
      "apps/docs/content/docs/reference/adapters/google.mdx",
    );
    const googleReadme = read("packages/google/README.md");

    expect(googleReference).toContain(
      "Peer dependency: `@google/genai` (`^2.0.0`)",
    );
    expect(googleReadme).toContain(
      "`@google/genai` (`^2.0.0`) is a peer dependency.",
    );
    expect(`${googleReference}\n${googleReadme}`).not.toContain(
      "^1.0.0 || ^2.0.0",
    );
  });
});
