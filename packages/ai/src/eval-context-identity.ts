/** Pure-render context projection for managed AI task identity. @internal */

import type { JsonValue } from "@use-crux/core";
import {
  isRecord,
  projectJson,
  projectPolicies,
  projectSchema,
  projectTools,
  unavailable,
  type JsonProjection,
} from "./eval-task-identity-projection";

const CONTEXT_IDENTITY = Symbol.for("@use-crux/core/context-identity");
const CONTEXT_FIELDS = new Set([
  "id",
  "description",
  "input",
  "system",
  "use",
  "priority",
  "tools",
  "toolApproval",
  "rawFields",
  "when",
  "cache",
  "memo",
  "constraints",
  "guardrails",
]);

export function projectContexts(entries: readonly unknown[]): JsonProjection {
  const result: JsonValue[] = [];
  for (const entry of entries) {
    if (entry === false || entry === null || entry === undefined) continue;
    const projected = projectContextEntry(entry);
    if (!projected.ok) return projected;
    result.push(projected.value);
  }
  return { ok: true, value: Object.freeze(result) };
}

function projectContextEntry(entry: unknown): JsonProjection {
  if (!isRecord(entry) || typeof entry._tag !== "string") {
    return unavailable("identity_unavailable");
  }
  if (entry._tag === "Context") return projectContext(entry);
  if (entry._tag === "ConditionalContext") {
    return typeof entry.predicate === "function"
      ? unavailable("untracked_external_dependency")
      : unavailable("identity_unavailable");
  }
  if (entry._tag === "MatchSpec") return projectMatch(entry);
  if (entry._tag === "Skill") return projectSkill(entry);
  return unavailable("untracked_external_dependency");
}

function projectContext(context: Record<string | symbol, unknown>): JsonProjection {
  const authored = context[CONTEXT_IDENTITY];
  if (!isRecord(authored) || context.family !== undefined) {
    return unavailable("untracked_external_dependency");
  }
  if (Object.keys(authored).some((key) => !CONTEXT_FIELDS.has(key))) {
    return unavailable("identity_unavailable");
  }
  if (context.memoTtl !== 0 || authored.memo !== undefined) {
    return unavailable("untracked_external_dependency");
  }
  if (typeof authored.tools === "function") {
    return unavailable("untracked_external_dependency");
  }
  if (
    typeof authored.system === "function" ||
    typeof authored.when === "function"
  ) {
    return unavailable("untracked_external_dependency");
  }
  const inputSchema = projectSchema(context.inputSchema);
  if (!inputSchema.ok) return inputSchema;
  const tools = projectTools(authored.tools);
  if (!tools.ok) return tools;
  const nested = projectContexts(
    Array.isArray(context.useEntries) ? context.useEntries : [],
  );
  if (!nested.ok) return nested;
  const constraints = projectPolicies(authored.constraints, "constraint");
  if (!constraints.ok) return constraints;
  const guardrails = projectPolicies(authored.guardrails, "guardrail");
  if (!guardrails.ok) return guardrails;
  const system = projectSystem(authored.system);
  if (!system.ok) return system;
  const when = projectOptionalCallback(authored.when);
  if (!when.ok) return when;
  return projectJson({
    kind: "context",
    id: authored.id ?? null,
    description: authored.description ?? null,
    inputSchema: inputSchema.value,
    system: system.value,
    use: nested.value,
    priority: authored.priority ?? 50,
    tools: tools.value,
    toolApproval: authored.toolApproval ?? null,
    rawFields: authored.rawFields ?? [],
    when: when.value,
    providerCache: authored.cache === true,
    constraints: constraints.value,
    guardrails: guardrails.value,
  });
}

function projectSystem(value: unknown): JsonProjection {
  const projected = projectJson(value);
  return projected.ok
    ? projectJson({ kind: "static", value: projected.value })
    : projected;
}

function projectOptionalCallback(value: unknown): JsonProjection {
  if (value === undefined) return { ok: true, value: null };
  return unavailable("identity_unavailable");
}

function projectMatch(entry: Record<string, unknown>): JsonProjection {
  if (typeof entry.on === "function") {
    return unavailable("untracked_external_dependency");
  }
  if (!isRecord(entry.cases)) return unavailable("identity_unavailable");
  const cases: Record<string, JsonValue> = {};
  for (const key of Object.keys(entry.cases).sort()) {
    const projected = projectBranch(entry.cases[key]);
    if (!projected.ok) return projected;
    cases[key] = projected.value;
  }
  const fallback =
    entry.default === undefined
      ? { ok: true as const, value: null }
      : projectBranch(entry.default);
  if (!fallback.ok) return fallback;
  return projectJson({
    kind: "match_context",
    on: entry.on ?? null,
    cases,
    default: fallback.value,
  });
}

function projectBranch(value: unknown): JsonProjection {
  return projectContexts(Array.isArray(value) ? value : [value]);
}

function projectSkill(skill: Record<string, unknown>): JsonProjection {
  if (skill._loaded === false) {
    return unavailable("untracked_external_dependency");
  }
  if (
    typeof skill.id !== "string" ||
    typeof skill.description !== "string" ||
    typeof skill.instructions !== "string" ||
    !Array.isArray(skill.references) ||
    !isRecord(skill.meta)
  ) {
    return unavailable("untracked_external_dependency");
  }
  return projectJson({
    kind: "skill",
    id: skill.id,
    description: skill.description,
    instructions: skill.instructions,
    references: skill.references,
    meta: skill.meta,
  });
}
