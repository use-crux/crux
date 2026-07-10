/**
 * Line-oriented text search shared by workspace stores and virtual sources.
 *
 * The helpers keep literal-vs-regex handling and line/column projection
 * consistent across every `Workspace.grep()` backend.
 *
 * @module
 */

import type { WorkspaceGrepMatch, WorkspaceGrepOptions } from "./fs-types";

type WorkspaceTextMatcherOptions = Pick<
  WorkspaceGrepOptions,
  "ignoreCase" | "regex"
>;

const MAX_WORKSPACE_REGEX_LENGTH = 256;
const REPEATED_WILDCARD_PATTERN = /(?:\.\*){4,}/;
const NESTED_QUANTIFIER_PATTERN = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*?{]/;

/** Create the regular expression used for a `Workspace.grep()` query. */
export function createWorkspaceTextMatcher(
  query: string,
  options: WorkspaceTextMatcherOptions | undefined,
): RegExp {
  if (options?.regex) assertSafeWorkspaceRegex(query);
  return new RegExp(
    options?.regex ? query : escapeRegExp(query),
    options?.ignoreCase ? "gi" : "g",
  );
}

/** Return line-oriented matches for one text file. */
export function grepWorkspaceText(
  path: string,
  content: string,
  matcher: RegExp,
): WorkspaceGrepMatch[] {
  const matches: WorkspaceGrepMatch[] = [];
  const lines = content.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    matcher.lastIndex = 0;
    let match = matcher.exec(line);
    while (match) {
      matches.push({
        path,
        line: lineIndex + 1,
        column: match.index + 1,
        text: line,
      });
      if (match[0].length === 0) matcher.lastIndex += 1;
      match = matcher.exec(line);
    }
  }
  return matches;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertSafeWorkspaceRegex(query: string): void {
  if (query.length > MAX_WORKSPACE_REGEX_LENGTH) {
    throw new Error(
      `workspace.grep(): regex query is too long; maximum length is ${MAX_WORKSPACE_REGEX_LENGTH} characters.`,
    );
  }
  if (
    REPEATED_WILDCARD_PATTERN.test(query) ||
    NESTED_QUANTIFIER_PATTERN.test(query)
  ) {
    throw new Error(
      "workspace.grep(): regex query is too complex for workspace search.",
    );
  }
}
