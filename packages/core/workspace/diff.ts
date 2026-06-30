/**
 * Line-oriented text diffing for workspace versions.
 *
 * Computes a longest-common-subsequence line diff and renders it both as
 * structured {@link WorkspaceDiffHunk}s and as a git-style unified-diff string,
 * so {@link Workspace.diff} callers can render either without re-parsing.
 *
 * @module
 */

import type {
  WorkspaceDiff,
  WorkspaceDiffHunk,
  WorkspaceDiffLine,
} from "./version-types";

/** Number of unchanged context lines kept around each change. */
const CONTEXT_LINES = 3;
/** Maximum line-pair cells allocated for the exact LCS diff. */
const MAX_EXACT_DIFF_CELLS = 1_000_000;

interface DiffOp {
  readonly kind: WorkspaceDiffLine["kind"];
  readonly text: string;
}

/**
 * Build a {@link WorkspaceDiff} between two text revisions.
 *
 * @param input.path - The path being diffed (for the unified header).
 * @param input.from - Base version number.
 * @param input.to - Target version number.
 * @param input.before - Full text of the base revision.
 * @param input.after - Full text of the target revision.
 */
export function computeWorkspaceDiff(input: {
  readonly path: string;
  readonly from: number;
  readonly to: number;
  readonly before: string;
  readonly after: string;
}): WorkspaceDiff {
  const ops = diffLines(splitLines(input.before), splitLines(input.after));
  const hunks = groupHunks(ops);
  return {
    path: input.path,
    from: input.from,
    to: input.to,
    unified: renderUnified(input.path, input.from, input.to, hunks),
    hunks,
  };
}

/** Split text into lines, dropping a single trailing newline's empty element. */
function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Longest-common-subsequence line diff, emitting context/add/remove ops in order. */
function diffLines(before: string[], after: string[]): DiffOp[] {
  const rows = before.length;
  const cols = after.length;
  if (rows > 0 && cols > Math.floor(MAX_EXACT_DIFF_CELLS / rows)) {
    throw new Error(
      `workspace.diff(): input is too large for exact line diff (${rows}x${cols} line pairs).`,
    );
  }
  const lcs: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0),
  );
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        before[i] === after[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (before[i] === after[j]) {
      ops.push({ kind: "context", text: before[i]! });
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ kind: "remove", text: before[i]! });
      i += 1;
    } else {
      ops.push({ kind: "add", text: after[j]! });
      j += 1;
    }
  }
  while (i < rows) ops.push({ kind: "remove", text: before[i++]! });
  while (j < cols) ops.push({ kind: "add", text: after[j++]! });
  return ops;
}

/** Collapse the linear op stream into hunks with bounded surrounding context. */
function groupHunks(ops: DiffOp[]): WorkspaceDiffHunk[] {
  const changedAt = ops
    .map((op, index) => (op.kind === "context" ? -1 : index))
    .filter((index) => index >= 0);
  if (changedAt.length === 0) return [];

  const hunks: WorkspaceDiffHunk[] = [];
  let blockStart = 0;
  for (let cursor = 0; cursor < changedAt.length; ) {
    const start = changedAt[cursor]!;
    let end = start;
    let next = cursor + 1;
    // Merge changes whose context gaps would overlap into one hunk.
    while (
      next < changedAt.length &&
      changedAt[next]! - end <= CONTEXT_LINES * 2
    ) {
      end = changedAt[next]!;
      next += 1;
    }
    const from = Math.max(blockStart, start - CONTEXT_LINES);
    const to = Math.min(ops.length, end + CONTEXT_LINES + 1);
    hunks.push(buildHunk(ops, from, to));
    blockStart = to;
    cursor = next;
  }
  return hunks;
}

/** Materialize one hunk and its `@@` line/length counters from an op slice. */
function buildHunk(ops: DiffOp[], from: number, to: number): WorkspaceDiffHunk {
  let fromStart = 0;
  let toStart = 0;
  for (let index = 0; index < from; index += 1) {
    if (ops[index]!.kind !== "add") fromStart += 1;
    if (ops[index]!.kind !== "remove") toStart += 1;
  }

  let fromLines = 0;
  let toLines = 0;
  const lines: WorkspaceDiffLine[] = [];
  for (let index = from; index < to; index += 1) {
    const op = ops[index]!;
    lines.push({ kind: op.kind, text: op.text });
    if (op.kind !== "add") fromLines += 1;
    if (op.kind !== "remove") toLines += 1;
  }

  return {
    fromStart: fromLines === 0 ? fromStart : fromStart + 1,
    fromLines,
    toStart: toLines === 0 ? toStart : toStart + 1,
    toLines,
    lines,
  };
}

/** Render hunks into a git-style unified-diff string. */
function renderUnified(
  path: string,
  from: number,
  to: number,
  hunks: readonly WorkspaceDiffHunk[],
): string {
  if (hunks.length === 0) return "";
  const out: string[] = [`--- ${path}@v${from}`, `+++ ${path}@v${to}`];
  for (const hunk of hunks) {
    out.push(
      `@@ -${hunk.fromStart},${hunk.fromLines} +${hunk.toStart},${hunk.toLines} @@`,
    );
    for (const line of hunk.lines)
      out.push(`${prefixFor(line.kind)}${line.text}`);
  }
  return `${out.join("\n")}\n`;
}

function prefixFor(kind: WorkspaceDiffLine["kind"]): string {
  return kind === "add" ? "+" : kind === "remove" ? "-" : " ";
}
