import type { ContextTextSegment } from "../prompt/context-types";
import type { PromptText } from "./index";
import type {
  InterpolationPart,
  PromptTextNode,
  SnapshotValue,
  TemplateNode,
} from "./internal";

type MutablePart =
  | { kind: "literal"; text: string }
  | {
      kind: "interpolation";
      index: number;
      value: SnapshotValue;
    };

interface MutableLine {
  parts: MutablePart[];
}

interface RenderedLine {
  readonly segments: readonly ContextTextSegment[];
  readonly authoredBlank: boolean;
  readonly removed: boolean;
}

export function createTemplateNode(
  strings: TemplateStringsArray,
  values: readonly SnapshotValue[],
): TemplateNode {
  const lines = trimOuterBlankLines(weaveTemplate(strings, values));
  const indent = commonIndent(lines);
  for (const line of lines) {
    const first = line.parts[0];
    if (
      first?.kind === "literal" &&
      indent.length > 0 &&
      first.text.startsWith(indent)
    ) {
      first.text = first.text.slice(indent.length);
    }
  }

  return Object.freeze({
    kind: "template",
    lines: Object.freeze(
      lines.map((line) => {
        const interpolationCount = line.parts.filter(
          (part) => part.kind === "interpolation",
        ).length;
        const block =
          interpolationCount === 1 &&
          line.parts.every(
            (part) =>
              part.kind === "interpolation" || /^[ \t]*$/.test(part.text),
          );

        return Object.freeze({
          parts: Object.freeze(
            line.parts.map((part) =>
              Object.freeze(
                part.kind === "literal"
                  ? part
                  : {
                      ...part,
                      position: block
                        ? ("block" as const)
                        : ("inline" as const),
                    },
              ),
            ),
          ),
        });
      }),
    ),
  });
}

export function renderPromptTextNode(
  node: PromptTextNode,
  resolveFragment: (value: PromptText) => PromptTextNode,
): {
  readonly text: string;
  readonly segments: readonly ContextTextSegment[];
} {
  if (node.kind === "json") {
    return {
      text: node.text,
      segments: [{ text: node.text, dynamic: true }],
    };
  }
  const lines = removeEmptyBlockSeams(
    node.lines.map((line) => renderLine(line, resolveFragment)),
  );
  const segments: ContextTextSegment[] = [];
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) segments.push({ text: "\n", dynamic: false });
    segments.push(...line.segments);
  });
  const normalized = coalescePromptTextSegments(segments);
  const text = normalized.map((segment) => segment.text).join("");
  return {
    text,
    segments: normalized,
  };
}

function renderLine(
  line: TemplateNode["lines"][number],
  resolveFragment: (value: PromptText) => PromptTextNode,
): RenderedLine {
  const block = line.parts.find(
    (part): part is InterpolationPart =>
      part.kind === "interpolation" && part.position === "block",
  );
  if (!block) {
    return {
      segments: line.parts.flatMap((part) =>
        part.kind === "literal"
          ? [{ text: part.text, dynamic: false }]
          : renderSnapshot(part.value, resolveFragment),
      ),
      authoredBlank: line.parts.every(
        (part) => part.kind === "literal" && /^[ \t]*$/.test(part.text),
      ),
      removed: false,
    };
  }

  const blockIndex = line.parts.indexOf(block);
  const indent = literalText(line.parts.slice(0, blockIndex));
  const suffix = literalText(line.parts.slice(blockIndex + 1));
  const rendered = coalescePromptTextSegments(
    renderSnapshot(block.value, resolveFragment),
  );
  if (rendered.length === 0) {
    return { segments: [], authoredBlank: false, removed: true };
  }
  return {
    segments: [
      { text: indent, dynamic: false },
      ...indentAfterNewlines(rendered, indent),
      { text: suffix, dynamic: false },
    ],
    authoredBlank: false,
    removed: false,
  };
}

function literalText(
  parts: readonly TemplateNode["lines"][number]["parts"][number][],
): string {
  return parts
    .map((part) => (part.kind === "literal" ? part.text : ""))
    .join("");
}

function removeEmptyBlockSeams(lines: readonly RenderedLine[]): RenderedLine[] {
  const remaining = [...lines];
  let index = 0;
  while (index < remaining.length) {
    if (!remaining[index]!.removed) {
      index++;
      continue;
    }

    let before = 0;
    while (remaining[index - before - 1]?.authoredBlank) before++;
    let after = 0;
    while (remaining[index + after + 1]?.authoredBlank) after++;

    // The shorter run is removed. Following runs lose ties so a seam cluster
    // retains the exact bytes of its earliest longest authored run.
    if (before >= after) {
      remaining.splice(index + 1, after);
    } else {
      remaining.splice(index - before, before);
      index -= before;
    }
    remaining.splice(index, 1);
  }
  return remaining;
}

function indentAfterNewlines(
  segments: readonly ContextTextSegment[],
  indent: string,
): ContextTextSegment[] {
  if (!indent) return segments.map((segment) => ({ ...segment }));

  // Copied carrier indentation remains parent-authored static text. Insert it
  // separately so final metadata coalescing, not interpolation, owns merging.
  const indented: ContextTextSegment[] = [];
  for (const segment of segments) {
    const chunks = segment.text.split("\n");
    chunks.forEach((text, index) => {
      if (index > 0) {
        indented.push({ text: indent, dynamic: false });
      }
      indented.push({
        ...segment,
        text: index < chunks.length - 1 ? `${text}\n` : text,
      });
    });
  }
  return indented;
}

function renderSnapshot(
  value: SnapshotValue,
  resolveFragment: (value: PromptText) => PromptTextNode,
): readonly ContextTextSegment[] {
  switch (value.kind) {
    case "scalar":
      return [{ text: value.text, dynamic: true }];
    case "omitted":
      return [];
    case "fragment":
      return renderPromptTextNode(resolveFragment(value.value), resolveFragment)
        .segments;
    case "sequence": {
      const rendered = value.items
        .map((item) => renderSnapshot(item, resolveFragment))
        .filter((segments) =>
          segments.some((segment) => segment.text.length > 0),
        );
      return rendered.flatMap((segments, index) =>
        index === 0 ? segments : [{ text: "\n", dynamic: true }, ...segments],
      );
    }
  }
}

/** @internal Coalesce adjacent prompt-text segments with identical provenance. */
export function coalescePromptTextSegments(
  segments: readonly ContextTextSegment[],
): ContextTextSegment[] {
  const normalized: ContextTextSegment[] = [];
  for (const segment of segments) {
    if (!segment.text) continue;
    const previous = normalized.at(-1);
    if (previous && sameMetadata(previous, segment)) {
      previous.text += segment.text;
    } else {
      normalized.push({ ...segment });
    }
  }
  return normalized;
}

function sameMetadata(
  left: ContextTextSegment,
  right: ContextTextSegment,
): boolean {
  return (
    left.dynamic === right.dynamic &&
    left.source === right.source &&
    left.observedAt === right.observedAt &&
    left.sourceVersion === right.sourceVersion
  );
}

function weaveTemplate(
  strings: TemplateStringsArray,
  values: readonly SnapshotValue[],
): MutableLine[] {
  const lines: MutableLine[] = [{ parts: [] }];

  strings.forEach((literal, index) => {
    const chunks = literal.split("\n");
    chunks.forEach((text, chunkIndex) => {
      if (chunkIndex > 0) lines.push({ parts: [] });
      lines.at(-1)!.parts.push({ kind: "literal", text });
    });
    if (index < values.length) {
      lines.at(-1)!.parts.push({
        kind: "interpolation",
        index,
        value: values[index]!,
      });
    }
  });

  return lines;
}

function trimOuterBlankLines(lines: MutableLine[]): MutableLine[] {
  let start = 0;
  let end = lines.length;
  while (start < end && isAuthoredBlank(lines[start]!)) start++;
  while (end > start && isAuthoredBlank(lines[end - 1]!)) end--;
  return lines.slice(start, end);
}

function isAuthoredBlank(line: MutableLine): boolean {
  return line.parts.every(
    (part) => part.kind === "literal" && /^[ \t]*$/.test(part.text),
  );
}

function commonIndent(lines: readonly MutableLine[]): string {
  // Authored blank lines do not constrain indentation. Candidate prefixes are
  // compared by exact characters so tabs never acquire an assumed visual width.
  const candidates = lines
    .filter((line) => !isAuthoredBlank(line))
    .map(leadingIndent);
  if (candidates.length === 0) return "";

  let prefix = candidates[0]!;
  for (const candidate of candidates.slice(1)) {
    let length = 0;
    while (
      length < prefix.length &&
      length < candidate.length &&
      prefix[length] === candidate[length]
    ) {
      length++;
    }
    prefix = prefix.slice(0, length);
  }
  return prefix;
}

function leadingIndent(line: MutableLine): string {
  let indent = "";
  for (const part of line.parts) {
    if (part.kind === "interpolation") return indent;
    const match = /^[ \t]*/.exec(part.text)![0];
    indent += match;
    if (match.length !== part.text.length) return indent;
  }
  return indent;
}
