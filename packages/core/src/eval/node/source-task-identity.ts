/** Conservative static mapping from authored Eval task imports to source. */

import { createHash } from "node:crypto";

interface LexedImport {
  readonly d: number;
  readonly n?: string;
  readonly ss: number;
  readonly se: number;
}

export interface EvalSourceRecord {
  readonly id: string;
  readonly contentHash: string;
}

export interface EvalSourceEdges {
  readonly sources: ReadonlySet<string>;
  readonly externals: ReadonlySet<string>;
}

export function findImportedTaskSpecifiers(
  source: string,
  imports: readonly LexedImport[],
): {
  readonly base?: string;
  readonly variants: Readonly<Record<string, string>>;
  readonly all: Set<string>;
  readonly hasUntrackedBindings: boolean;
} {
  const masked = maskNonCode(source);
  const baseLocal = findTopLevelTaskBinding(masked);
  const variantLocals = findVariantTaskBindings(masked);
  const taskLocals = new Set(Object.values(variantLocals));
  if (baseLocal !== undefined) taskLocals.add(baseLocal);
  const byLocal = new Map<string, string>();
  for (const item of imports) {
    if (item.d !== -1 || item.n === undefined) continue;
    const statement = source.slice(item.ss, item.se);
    for (const local of importedLocals(statement)) byLocal.set(local, item.n);
  }
  const all = new Set(
    [...taskLocals]
      .map((local) => byLocal.get(local))
      .filter((value): value is string => value !== undefined),
  );
  const base = baseLocal === undefined ? undefined : byLocal.get(baseLocal);
  const variants = Object.freeze(
    Object.fromEntries(
      Object.entries(variantLocals).flatMap(([name, local]) => {
        const specifier = byLocal.get(local);
        return specifier === undefined ? [] : [[name, specifier]];
      }),
    ),
  );
  const explicitTaskCount = [...masked.matchAll(/\btask\s*:/gu)].length;
  const trackedExplicitCount =
    (hasExplicitTopLevelTaskBinding(masked) ? 1 : 0) +
    Object.keys(variantLocals).length;
  return {
    ...(base !== undefined ? { base } : {}),
    variants,
    all,
    hasUntrackedBindings:
      explicitTaskCount > trackedExplicitCount ||
      [...taskLocals].some((local) => !byLocal.has(local)),
  };
}

export function fingerprintTaskSourceClosure(input: {
  readonly roots: ReadonlySet<string>;
  readonly externalRoots: ReadonlySet<string>;
  readonly fileRecords: ReadonlyMap<string, EvalSourceRecord>;
  readonly graph: ReadonlyMap<string, EvalSourceEdges>;
}): string {
  const queued = [...input.roots];
  const visited = new Set<string>();
  const files: EvalSourceRecord[] = [];
  const externals = new Set(input.externalRoots);
  while (queued.length > 0) {
    const path = queued.shift()!;
    if (visited.has(path)) continue;
    visited.add(path);
    const record = input.fileRecords.get(path);
    if (record !== undefined) files.push(record);
    const edges = input.graph.get(path);
    if (edges === undefined) continue;
    queued.push(...edges.sources);
    for (const identity of edges.externals) externals.add(identity);
  }
  files.sort((left, right) => left.id.localeCompare(right.id));
  return sha256(
    JSON.stringify({ epoch: 1, files, externals: [...externals].sort() }),
  );
}

function findTopLevelTaskBinding(masked: string): string | undefined {
  const call = /\bevaluate\s*\(/u.exec(masked);
  if (call === null) return undefined;
  const open = masked.indexOf("{", call.index + call[0].length);
  if (open === -1) return undefined;
  return findObjectTaskBinding(masked, open);
}

function hasExplicitTopLevelTaskBinding(masked: string): boolean {
  const call = /\bevaluate\s*\(/u.exec(masked);
  if (call === null) return false;
  const open = masked.indexOf("{", call.index + call[0].length);
  return (
    open !== -1 &&
    objectSegments(masked, open).some((segment) =>
      /^\s*task\s*:/u.test(masked.slice(segment.start, segment.end)),
    )
  );
}

function findVariantTaskBindings(masked: string): Record<string, string> {
  const call = /\bevaluate\s*\(/u.exec(masked);
  if (call === null) return {};
  const evalOpen = masked.indexOf("{", call.index + call[0].length);
  if (evalOpen === -1) return {};
  const variantsOpen = findObjectPropertyOpen(masked, evalOpen, "variants");
  if (variantsOpen === undefined) return {};
  const result: Record<string, string> = {};
  for (const segment of objectSegments(masked, variantsOpen)) {
    const text = masked.slice(segment.start, segment.end);
    const name = /^\s*([A-Za-z_$][\w$]*)\s*:\s*\{/u.exec(text);
    if (name === null) continue;
    const variantOpen = segment.start + text.indexOf("{");
    const binding = findObjectTaskBinding(masked, variantOpen);
    if (binding !== undefined) result[name[1]!] = binding;
  }
  return result;
}

function findObjectPropertyOpen(
  masked: string,
  open: number,
  property: string,
): number | undefined {
  for (const segment of objectSegments(masked, open)) {
    const text = masked.slice(segment.start, segment.end);
    if (!new RegExp(`^\\s*${property}\\s*:\\s*\\{`, "u").test(text)) continue;
    return segment.start + text.indexOf("{");
  }
  return undefined;
}

function findObjectTaskBinding(
  masked: string,
  open: number,
): string | undefined {
  for (const segment of objectSegments(masked, open)) {
    const text = masked.slice(segment.start, segment.end).trim();
    const match = /^task(?:\s*:\s*([A-Za-z_$][\w$]*))?$/u.exec(text);
    if (match !== null) return match[1] ?? "task";
  }
  return undefined;
}

function objectSegments(
  masked: string,
  open: number,
): readonly { readonly start: number; readonly end: number }[] {
  const segments: { start: number; end: number }[] = [];
  let braces = 1;
  let brackets = 0;
  let parentheses = 0;
  let start = open + 1;
  for (let index = start; index < masked.length; index++) {
    const character = masked[index];
    if (character === "{") braces++;
    else if (character === "}") braces--;
    else if (character === "[") brackets++;
    else if (character === "]") brackets--;
    else if (character === "(") parentheses++;
    else if (character === ")") parentheses--;
    if (
      (character === "," && braces === 1 && brackets === 0 && parentheses === 0) ||
      braces === 0
    ) {
      segments.push({ start, end: index });
      start = index + 1;
      if (braces === 0) break;
    }
  }
  return segments;
}

function importedLocals(statement: string): string[] {
  const match = /^\s*import\s+(?!["'])(.*?)\s+from\s+["']/su.exec(statement);
  if (match === null) return [];
  const clause = match[1]!.replace(/^type\s+/u, "").trim();
  const locals: string[] = [];
  const defaultBinding = /^([A-Za-z_$][\w$]*)\s*(?:,|$)/u.exec(clause);
  if (defaultBinding !== null) locals.push(defaultBinding[1]!);
  const namespace = /\*\s+as\s+([A-Za-z_$][\w$]*)/u.exec(clause);
  if (namespace !== null) locals.push(namespace[1]!);
  const named = /\{([^}]*)\}/su.exec(clause);
  if (named !== null) {
    for (const entry of named[1]!.split(",")) {
      const binding = entry.trim().replace(/^type\s+/u, "");
      const local = /^(?:[A-Za-z_$][\w$]*\s+as\s+)?([A-Za-z_$][\w$]*)$/u.exec(
        binding,
      );
      if (local !== null) locals.push(local[1]!);
    }
  }
  return locals;
}

export function maskNonCode(source: string): string {
  const chars = [...source];
  for (let index = 0; index < chars.length; index++) {
    const character = chars[index];
    const next = chars[index + 1];
    if (character === "/" && next === "/") {
      while (index < chars.length && chars[index] !== "\n")
        chars[index++] = " ";
    } else if (character === "/" && next === "*") {
      chars[index++] = " ";
      chars[index] = " ";
      while (index + 1 < chars.length) {
        if (chars[index] === "*" && chars[index + 1] === "/") {
          chars[index] = chars[index + 1] = " ";
          index++;
          break;
        }
        if (chars[index] !== "\n") chars[index] = " ";
        index++;
      }
    } else if (character === '"' || character === "'" || character === "`") {
      const quote = character;
      chars[index] = " ";
      while (++index < chars.length) {
        if (chars[index] === "\\") {
          chars[index] = " ";
          if (index + 1 < chars.length) chars[++index] = " ";
        } else if (chars[index] === quote) {
          chars[index] = " ";
          break;
        } else if (chars[index] !== "\n") {
          chars[index] = " ";
        }
      }
    }
  }
  return chars.join("");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
