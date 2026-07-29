import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PromptTextDecorationFixture, Utf16Range } from "./contracts.js";
import { mapPromptTextDecorationRanges } from "./mapping.js";

describe("mapPromptTextDecorationRanges", () => {
  it("maps the shared Rust and Go conformance identity without entering barriers", () => {
    const fixture = readSharedConformanceFixture();
    const mapped = mapPromptTextDecorationRanges({
      decorations: fixture.decorations,
    });

    expect(
      Object.fromEntries(
        Object.entries(mapped).map(([role, ranges]) => [role, ranges.length]),
      ),
    ).toEqual({
      heading: 2,
      link: 1,
      code: 2,
      emphasis: 1,
      strong: 1,
      list: 2,
      blockquote: 4,
    });
    expect(
      mapped.heading.map((value) =>
        textAtRange(fixture.source.split(/\r?\n/u), value),
      ),
    ).toEqual(["Héllo **team** 😀", "Combining é"]);
    for (const ranges of Object.values(mapped)) {
      for (const decorationRange of ranges) {
        expect(
          fixture.protectedRanges.some((protectedRange) =>
            intersects(decorationRange, protectedRange),
          ),
        ).toBe(false);
      }
    }
  });

  it("maps every role without crossing TypeScript or interpolation barriers", () => {
    const sourceLines = [
      "const prompt = md`# Héllo **team**",
      "> 👋 *Welcome* ${name}",
      "- Read [guide](https://example.com) and `code`",
      "`",
    ] as const;
    const fixture = {
      kind: "prompt-text-decoration-fixture",
      protocolVersion: 1,
      units: "utf-16",
      document: {
        uri: "file:///writer.ts",
        version: 7,
        text: sourceLines.join("\r\n"),
      },
      decorations: [
        decoration("heading", 0, 20, 25),
        decoration("strong", 0, 28, 32),
        decoration("blockquote", 1, 0, 1),
        decoration("emphasis", 1, 6, 13),
        decoration("list", 2, 0, 1),
        decoration("link", 2, 8, 13),
        decoration("code", 2, 41, 45),
      ],
    } satisfies PromptTextDecorationFixture;

    const mapped = mapPromptTextDecorationRanges(fixture);

    expect(
      Object.fromEntries(
        Object.entries(mapped).map(([role, ranges]) => [
          role,
          ranges.map((range) => textAtRange(sourceLines, range)),
        ]),
      ),
    ).toEqual({
      heading: ["Héllo"],
      link: ["guide"],
      code: ["code"],
      emphasis: ["Welcome"],
      strong: ["team"],
      list: ["-"],
      blockquote: [">"],
    });

    const protectedRanges = [
      range(0, 15, 17), // tag
      range(0, 17, 18), // template opening backtick
      range(1, 15, 22), // ${, expression, and }
      range(2, 40, 41), // inline-code opening backtick
      range(2, 45, 46), // inline-code closing backtick
      range(3, 0, 1), // template closing backtick
    ];
    for (const ranges of Object.values(mapped)) {
      for (const decorationRange of ranges) {
        expect(
          protectedRanges.some((barrier) =>
            intersects(decorationRange, barrier),
          ),
        ).toBe(false);
      }
    }
  });
});

function readSharedConformanceFixture(): {
  readonly source: string;
  readonly decorations: PromptTextDecorationFixture["decorations"];
  readonly protectedRanges: readonly Utf16Range[];
} {
  const fixtureRoot = new URL(
    "../../../indexer/__tests__/fixtures/",
    import.meta.url,
  );
  const source = readFileSync(
    new URL("prompt-text-editor-conformance-v1.ts", fixtureRoot),
    "utf8",
  );
  const value: unknown = JSON.parse(
    readFileSync(
      new URL("prompt-text-editor-conformance-v1.json", fixtureRoot),
      "utf8",
    ),
  );
  const root = requiredRecord(value, "fixture");
  const views = requiredRecord(root.views, "views");
  const analysis = requiredRecord(root.analysis, "analysis");
  if (!Array.isArray(views.decorations) || !Array.isArray(analysis.templates)) {
    throw new Error("Invalid shared PromptText conformance fixture");
  }
  const owner = requiredRecord(analysis.templates[1], "owner template");
  if (
    !Array.isArray(owner.backtickRanges) ||
    !Array.isArray(owner.interpolationBarriers)
  ) {
    throw new Error("Invalid shared PromptText owner ranges");
  }
  const decorations = views.decorations.map(parseDecoration);
  const protectedRanges = [
    parseRange(owner.tagRange),
    ...owner.backtickRanges.map(parseRange),
    ...owner.interpolationBarriers.flatMap((barrier) => {
      const record = requiredRecord(barrier, "interpolation barrier");
      return [parseRange(record.range), parseRange(record.expressionRange)];
    }),
  ];
  return { source, decorations, protectedRanges };
}

function parseDecoration(
  value: unknown,
): PromptTextDecorationFixture["decorations"][number] {
  const record = requiredRecord(value, "decoration");
  if (
    record.role !== "heading" &&
    record.role !== "link" &&
    record.role !== "code" &&
    record.role !== "emphasis" &&
    record.role !== "strong" &&
    record.role !== "list" &&
    record.role !== "blockquote"
  ) {
    throw new Error("Invalid shared PromptText decoration role");
  }
  return { role: record.role, range: parseRange(record.range) };
}

function parseRange(value: unknown): Utf16Range {
  const record = requiredRecord(value, "range");
  return {
    start: parsePosition(record.start),
    end: parsePosition(record.end),
  };
}

function parsePosition(value: unknown): Utf16Range["start"] {
  const record = requiredRecord(value, "position");
  if (
    !Number.isSafeInteger(record.line) ||
    Number(record.line) < 0 ||
    !Number.isSafeInteger(record.character) ||
    Number(record.character) < 0
  ) {
    throw new Error("Invalid shared PromptText position");
  }
  return { line: Number(record.line), character: Number(record.character) };
}

function requiredRecord(
  value: unknown,
  name: string,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new Error(`Invalid shared PromptText ${name}`);
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decoration(
  role: PromptTextDecorationFixture["decorations"][number]["role"],
  line: number,
  start: number,
  end: number,
): PromptTextDecorationFixture["decorations"][number] {
  return { role, range: range(line, start, end) };
}

function range(line: number, start: number, end: number): Utf16Range {
  return {
    start: { line, character: start },
    end: { line, character: end },
  };
}

function textAtRange(lines: readonly string[], value: Utf16Range): string {
  expect(value.start.line).toBe(value.end.line);
  return (
    lines[value.start.line]?.slice(
      value.start.character,
      value.end.character,
    ) ?? ""
  );
}

function intersects(left: Utf16Range, right: Utf16Range): boolean {
  if (left.start.line !== right.start.line || left.end.line !== right.end.line)
    return false;
  return (
    left.start.character < right.end.character &&
    right.start.character < left.end.character
  );
}
