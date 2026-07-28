import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { projectMediaOperationCatalog } from "./media-catalog";
import { MediaCatalogSection } from "./media-section";

describe("bounded media streaming Catalog cards", () => {
  it.each([
    {
      operation: "streamImage",
      inputs: [] as const,
      outputs: ["image"] as const,
      sourceLine: 21,
    },
    {
      operation: "streamSpeech",
      inputs: ["text"] as const,
      outputs: ["audio"] as const,
      sourceLine: 34,
    },
  ] as const)(
    "renders $operation without private media payloads",
    ({ operation, inputs, outputs, sourceLine }) => {
      const view = projectMediaOperationCatalog({
        id: `media.operation:${operation}`,
        name: operation,
        kind: "media.operation",
        fidelity: "native",
        file: "src/media.ts",
        line: sourceLine,
        warningCount: 2,
        facts: {
          operation,
          inputModalities: inputs,
          outputModalities: outputs,
          execution: "native",
          adapter: "google",
          prompt: "PRIVATE_PROMPT",
          bytes: "PRIVATE_BYTES",
          nativeEvent: "PRIVATE_EVENT",
        },
        relations: [
          {
            id: `relation:${operation}`,
            type: "guardrail.applies_to",
            direction: "to",
            otherId: "guardrail:safe-media",
            otherName: "safeMedia",
            otherKind: "guardrail",
          },
        ],
      });

      const html = renderToStaticMarkup(
        <MediaCatalogSection view={view!} />,
      );

      expect(html).toContain(operation);
      expect(html).toContain("bounded media stream");
      expect(html).toContain(`src/media.ts:${sourceLine}`);
      expect(html).toContain("2 warnings");
      expect(html).toContain("guardrail.applies_to");
      expect(html).toContain("safeMedia");
      expect(html).not.toContain("PRIVATE_");
      expect(html).not.toContain("text stream");
    },
  );
});
