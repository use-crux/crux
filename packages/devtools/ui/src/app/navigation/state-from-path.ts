import type { RunLens } from "@/features/run-detail/types";
import type { NavState } from "./navigation-state";

/** Strictly decode a browser path and query into Devtools navigation state. */
export function stateFromPath(path: string, search?: string): NavState {
  const params = new URLSearchParams(search ?? "");
  const cleaned = path === "/" ? "/" : path.replace(/\/+$/, "");
  const segments = cleaned.split("/").filter(Boolean);
  if (segments.length === 0) return { view: "overview" };
  const [root, a, b, c, d] = segments;

  switch (root) {
    case "insights":
      return insightState(a, params);
    case "runs":
      return runsState(a, params);
    case "runtime":
      return { view: "runtime" };
    case "baselines":
      return { view: "baselines" };
    case "evals":
      return a
        ? { view: "evals", evalId: decodeURIComponent(a) }
        : { view: "evals" };
    case "eval-runs":
      return a
        ? { view: "eval-runs", runId: decodeURIComponent(a) }
        : { view: "eval-runs" };
    case "review":
      return a
        ? { view: "review", reviewId: decodeURIComponent(a) }
        : { view: "review" };
    case "library":
      return libraryState(path, segments, a, b, c, d);
    default:
      return { view: "overview" };
  }
}

function insightState(
  insightId: string | undefined,
  params: URLSearchParams,
): NavState {
  if (insightId)
    return { view: "insights", insightId: decodeURIComponent(insightId) };
  const severity = splitMatching(params.get("sev"), [
    "high",
    "medium",
    "low",
  ] as const);
  const status = splitMatching(params.get("status"), [
    "open",
    "dismissed",
    "resolved",
  ] as const);
  const group = params.get("group");
  const groupBy =
    group === "severity" ||
    group === "target" ||
    group === "status" ||
    group === "title" ||
    group === "tag"
      ? group
      : undefined;
  const target = splitValues(params.get("target"), ",");
  const title = splitValues(params.get("title"), "|");
  const tag = splitValues(params.get("tag"), ",");
  const search = params.get("q") ?? undefined;
  return {
    view: "insights",
    ...(severity.length ? { severity } : {}),
    ...(target.length ? { target } : {}),
    ...(status.length ? { status } : {}),
    ...(title.length ? { title } : {}),
    ...(tag.length ? { tag } : {}),
    ...(groupBy ? { groupBy } : {}),
    ...(search ? { search } : {}),
  };
}

function runsState(
  operationId: string | undefined,
  params: URLSearchParams,
): NavState {
  if (operationId) {
    const requestedLens = params.get("lens");
    const lenses: readonly RunLens[] = ["tree", "timeline", "graph", "story"];
    const lens = lenses.includes(requestedLens as RunLens)
      ? (requestedLens as RunLens)
      : "tree";
    const spanId = params.get("spanId") ?? undefined;
    return {
      view: "run-detail",
      traceId: decodeURIComponent(operationId),
      lens,
      ...(params.get("summary") === "1" ? { summary: true } : {}),
      ...(spanId ? { spanId: decodeURIComponent(spanId) } : {}),
    };
  }
  const group = params.get("group");
  const groupBy =
    group === "primitive" || group === "session" || group === "target"
      ? group
      : "none";
  const last = params.get("last");
  const lastValid =
    last === "1h" || last === "24h" || last === "7d" || last === "30d"
      ? last
      : undefined;
  const status = splitValues(params.get("status"), ",");
  const target = splitValues(params.get("target"), ",");
  const model = splitValues(params.get("model"), ",");
  const search = params.get("q") ?? undefined;
  const definitionId = params.get("definitionId") ?? undefined;
  return {
    view: "runs",
    groupBy,
    ...(status.length ? { status } : {}),
    ...(target.length ? { target } : {}),
    ...(model.length ? { model } : {}),
    ...(lastValid ? { last: lastValid } : {}),
    ...(search ? { search } : {}),
    ...(definitionId ? { definitionId } : {}),
  };
}

function libraryState(
  path: string,
  segments: readonly string[],
  section: string | undefined,
  b: string | undefined,
  c: string | undefined,
  d: string | undefined,
): NavState {
  if (section === "index") return indexState(path, segments, b, c, d);
  if (section === "memory")
    return b
      ? { view: "library-memory", memoryId: decodeURIComponent(b) }
      : { view: "library-memory" };
  if (section === "workspaces") {
    if (!b) return { view: "library-workspaces" };
    const workspaceId = decodeURIComponent(b);
    const filePath = segments.slice(3).map(decodeURIComponent).join("/");
    return filePath
      ? { view: "library-workspaces", workspaceId, filePath }
      : { view: "library-workspaces", workspaceId };
  }
  if (section === "plans")
    return b
      ? { view: "library-plans", planId: decodeURIComponent(b) }
      : { view: "library-plans" };
  return { view: "overview" };
}

function indexState(
  path: string,
  segments: readonly string[],
  b: string | undefined,
  c: string | undefined,
  d: string | undefined,
): NavState {
  if (
    b === "prompt" &&
    c &&
    (d === "preview" || d === "latest-run") &&
    segments.length === 5
  ) {
    const raw = path.split("/");
    if (
      raw.length !== 6 ||
      raw[0] !== "" ||
      raw[1] !== "library" ||
      raw[2] !== "index" ||
      raw[3] !== "prompt" ||
      raw[4] !== c ||
      raw[5] !== d
    )
      return { view: "overview" };
    const definitionId = decodePathComponent(c);
    if (definitionId === undefined) return { view: "overview" };
    return d === "preview"
      ? { view: "prompt-preview", definitionId }
      : { view: "prompt-latest-run", definitionId };
  }
  if (b === "prompt") return { view: "overview" };
  if (b === "health" && !c) return { view: "library-index", tab: "health" };
  if (b === "tool" && c)
    return { view: "library-index", toolName: decodeURIComponent(c) };
  if (b === "context" && c)
    return { view: "library-index", contextId: decodeURIComponent(c) };
  if (!b) return { view: "library-index" };
  const promptId = decodeURIComponent(b);
  return c
    ? { view: "library-index", promptId, tab: decodeURIComponent(c) }
    : { view: "library-index", promptId };
}

function splitValues(value: string | null, separator: string): string[] {
  return value ? value.split(separator).filter(Boolean) : [];
}

function splitMatching<const T extends string>(
  value: string | null,
  allowed: readonly T[],
): readonly T[] {
  return splitValues(value, ",").filter((item): item is T =>
    allowed.includes(item as T),
  );
}

function decodePathComponent(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
