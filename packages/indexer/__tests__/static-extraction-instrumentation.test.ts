import { describe, expect, it } from "vitest";
import {
  createStaticExtraction,
  type SourceReader,
  type StaticExtractionTimingName,
} from "../indexer/static/extraction/engine";
import { createTypeScriptStaticSyntaxFrontend } from "../indexer/static-index/syntax";

describe("static extraction instrumentation", () => {
  it("emits phase timings for extraction and syntax-record parsing", async () => {
    const root = "/fixture";
    const file = "/fixture/src/prompt.ts";
    const timings: StaticExtractionTimingName[] = [];
    const extraction = createStaticExtraction({
      root,
      syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
      cache: "none",
      sources: memorySourceReader({
        [file]:
          "export const writer = prompt({ id: 'writer', system: 'Write.' })",
      }),
      instrumentation: {
        onTiming: (timing) => {
          expect(timing.durationMs).toBeGreaterThanOrEqual(0);
          timings.push(timing.name);
        },
      },
    });

    await extraction.extractFile(file);

    expect(timings).toEqual(
      expect.arrayContaining([
        "static.extract_file.total",
        "static.semantic_profile",
        "static.syntax_records.total",
        "static.syntax_record.parse_file",
        "static.syntax_record.extract_matches",
        "static.syntax_record.tree_paths",
        "static.syntax_record.imported_definitions",
      ]),
    );
  });
});

function memorySourceReader(sources: Record<string, string>): SourceReader {
  return {
    read: async (file) => {
      const source = sources[file];
      if (source === undefined)
        throw new Error(`Missing fixture source: ${file}`);
      return source;
    },
  };
}
