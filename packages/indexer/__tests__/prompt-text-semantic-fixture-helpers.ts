import type { ProjectSourceRefRole } from "@use-crux/core/project-index";
import type { ExpectedPromptTextSourceRef } from "./semantic-backend-parity-fixtures";

interface PromptTextRefInput {
  readonly definitionId: string;
  readonly file: string;
  readonly fileSource: string;
  readonly fileKey: string;
  readonly role: Extract<ProjectSourceRefRole, "system" | "prompt">;
  readonly source: string;
  readonly occurrence?: number;
  readonly lifecycle: "static" | "dynamic";
  readonly symbol?: string;
}

/** Builds exact, project-relative prompt-text evidence for parity fixtures. */
export function promptTextRef(
  input: PromptTextRefInput,
): ExpectedPromptTextSourceRef {
  const range = sourceRange(
    input.fileSource,
    input.source,
    input.occurrence ?? 0,
  );
  return {
    definitionId: input.definitionId,
    ref: {
      id: `${input.definitionId}:source:${input.role}:${input.role}:prompt-text:${input.fileKey}:${range.startLine}:${range.startColumn}`,
      role: input.role,
      property: input.role,
      ...(input.symbol ? { symbol: input.symbol } : {}),
      source: {
        file: input.file,
        line: range.startLine,
        column: range.startColumn,
      },
      snippet: {
        source: input.source,
        language: "typescript",
        range: {
          file: input.file,
          ...range,
        },
        truncated: false,
      },
      fidelity: "resolved",
      metadata: {
        ...(input.role === "system" ? { fragment: true } : {}),
        promptText: {
          tag: "md",
          language: "markdown",
          lifecycle: input.lifecycle,
        },
      },
    },
  };
}

function sourceRange(
  fileSource: string,
  source: string,
  occurrence: number,
): {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
} {
  let start = -1;
  for (let index = 0; index <= occurrence; index += 1) {
    start = fileSource.indexOf(source, start + 1);
  }
  if (start < 0) {
    throw new Error(`Missing prompt-text fixture source: ${source}`);
  }
  const begin = lineAndColumn(fileSource, start);
  const end = lineAndColumn(fileSource, start + source.length);
  return {
    startLine: begin.line,
    startColumn: begin.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

function lineAndColumn(
  source: string,
  offset: number,
): { readonly line: number; readonly column: number } {
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}
