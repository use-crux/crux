/** Deterministic Node-only identity for authored Eval source dependencies. */

import { createHash } from "node:crypto";
import { realpath, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { extname, resolve } from "node:path";
import { init, parse } from "es-module-lexer";
import {
  isUnsupportedEvalSource,
  portableSourceId,
  resolveSourceDependency,
} from "./source-resolution";
import {
  findImportedTaskSpecifiers,
  fingerprintTaskSourceClosure,
  type EvalSourceEdges,
  type EvalSourceRecord,
} from "./source-task-identity";

const BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

export type EvalSourceClosureIdentity = Readonly<{
  fingerprint: string;
  dependencies: readonly string[];
  taskSourceFingerprint?: string;
  taskSourceFingerprints?: Readonly<Record<string, string>>;
  hasUntrackedTaskBindings: boolean;
}> &
  (
    | { readonly reusable: true }
    | {
        readonly reusable: false;
        readonly reason: "unresolved_source_dependency";
        readonly issues: readonly string[];
      }
  );

/** Hash an Eval module and every statically resolvable authored dependency. */
export async function fingerprintEvalSourceClosure(input: {
  readonly projectRoot: string;
  readonly entryFile: string;
  /** Canonical entry source to hash while imports are parsed from authored source. */
  readonly entryIdentitySource?: string;
}): Promise<EvalSourceClosureIdentity> {
  await init;
  const projectRoot = await realpath(resolve(input.projectRoot));
  const entry = await realpath(resolve(projectRoot, input.entryFile));
  const queued = [entry];
  const visited = new Set<string>();
  const files: EvalSourceRecord[] = [];
  const fileRecords = new Map<string, EvalSourceRecord>();
  const graph = new Map<string, EvalSourceEdges>();
  const externals = new Set<string>();
  const issues = new Set<string>();
  let taskBindings: ReturnType<typeof findImportedTaskSpecifiers> = {
    variants: Object.freeze({}),
    all: new Set<string>(),
    hasUntrackedBindings: false,
  };
  const taskSourceRoots = new Map<
    string,
    { readonly source?: string; readonly external?: string }
  >();
  let hasUntrackedTaskBindings = false;

  while (queued.length > 0) {
    queued.sort();
    const file = queued.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const portableId = await portableSourceId(projectRoot, file);
    let source: string;
    try {
      source = await readFile(file, "utf8");
    } catch {
      issues.add(
        `${portableId ?? "outside-project source"}: source could not be read`,
      );
      continue;
    }
    const id = portableId ?? `unresolved-source:${sha256(source)}`;
    if (portableId === undefined) {
      issues.add(`${id}: source has no portable workspace identity`);
    }
    const identitySource =
      file === entry && input.entryIdentitySource !== undefined
        ? input.entryIdentitySource
        : source;
    const fileRecord = { id, contentHash: sha256(identitySource) };
    files.push(fileRecord);
    fileRecords.set(file, fileRecord);
    const edges = { sources: new Set<string>(), externals: new Set<string>() };
    graph.set(file, edges);
    if (extname(file) === ".json") continue;
    if (isUnsupportedEvalSource(file, source)) {
      issues.add(`${id}: CommonJS or generated source cannot be tracked`);
      continue;
    }

    let imports: ReturnType<typeof parse>[0];
    try {
      [imports] = parse(source);
    } catch {
      issues.add(`${id}: imports could not be parsed`);
      continue;
    }
    if (file === entry) {
      taskBindings = findImportedTaskSpecifiers(source, imports);
      hasUntrackedTaskBindings = taskBindings.hasUntrackedBindings;
    }
    const specifiers: string[] = [];
    for (const item of imports) {
      if (item.d === -2) continue;
      if (item.n === undefined) {
        issues.add(`${id}: dynamic import must use a string literal`);
        continue;
      }
      if (!BUILTINS.has(item.n)) specifiers.push(item.n);
    }
    for (const specifier of [...new Set(specifiers)].sort()) {
      const dependency = await resolveSourceDependency(file, specifier);
      if (dependency.kind === "external") {
        externals.add(dependency.identity);
        edges.externals.add(dependency.identity);
        if (file === entry && taskBindings.all.has(specifier)) {
          taskSourceRoots.set(specifier, { external: dependency.identity });
        }
        continue;
      }
      if (dependency.kind === "unresolved") {
        issues.add(`${id}: cannot resolve '${specifier}'`);
        continue;
      }
      edges.sources.add(dependency.path);
      if (file === entry && taskBindings.all.has(specifier)) {
        taskSourceRoots.set(specifier, { source: dependency.path });
      }
      queued.push(dependency.path);
    }
  }

  files.sort((left, right) => left.id.localeCompare(right.id));
  const externalDependencies = [...externals].sort();
  const dependencies = Object.freeze([
    ...files.map((file) => file.id),
    ...externalDependencies,
  ]);
  const sortedIssues = Object.freeze([...issues].sort());
  const fingerprint = sha256(
    JSON.stringify({
      epoch: 1,
      files,
      externals: externalDependencies,
      issues: sortedIssues,
    }),
  );
  const fingerprintTaskBinding = (specifier: string): string | undefined => {
    const root = taskSourceRoots.get(specifier);
    if (root === undefined) return undefined;
    return fingerprintTaskSourceClosure({
      roots: new Set(root.source === undefined ? [] : [root.source]),
      externalRoots: new Set(
        root.external === undefined ? [] : [root.external],
      ),
      fileRecords,
      graph,
    });
  };
  const taskSourceFingerprint =
    taskBindings.base === undefined
      ? undefined
      : fingerprintTaskBinding(taskBindings.base);
  const taskSourceFingerprints = Object.freeze(
    Object.fromEntries([
      ...(taskSourceFingerprint === undefined
        ? []
        : [["current", taskSourceFingerprint]]),
      ...Object.entries(taskBindings.variants).flatMap(([name, specifier]) => {
        const fingerprint = fingerprintTaskBinding(specifier);
        return fingerprint === undefined ? [] : [[name, fingerprint]];
      }),
    ]),
  );
  const common = {
    fingerprint,
    dependencies,
    hasUntrackedTaskBindings,
    ...(taskSourceFingerprint !== undefined ? { taskSourceFingerprint } : {}),
    ...(Object.keys(taskSourceFingerprints).length > 0
      ? { taskSourceFingerprints }
      : {}),
  };
  return sortedIssues.length === 0
    ? Object.freeze({ reusable: true as const, ...common })
    : Object.freeze({
        reusable: false as const,
        reason: "unresolved_source_dependency" as const,
        ...common,
        issues: sortedIssues,
      });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
