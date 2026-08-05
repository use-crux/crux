/** Pure Agent Prompt input parsing for Session Signal ingress. */

import type { JsonObject } from "../storage";
import type { AnyAgent } from "../agent";
import { sessionInputRecord, sessionInputValue } from "./input";

export type AgentSessionInputParseResult =
  | { readonly ok: true; readonly value: JsonObject }
  | { readonly ok: false; readonly reason: "invalid" | "unavailable" };

/**
 * Parse one Signal payload with an explicit Agent Prompt input schema.
 *
 * @remarks Callers must supply the Agent from immutable Runtime Program
 * authority (or the Session create target). This helper never reads process
 * registries or module caches.
 */
export function parseAgentSessionInputWithAgent(
  agent: AnyAgent,
  payload: unknown,
): AgentSessionInputParseResult {
  const schema = agent.prompt.inputSchema;
  if (!schema) {
    return Object.freeze({ ok: false, reason: "unavailable" });
  }
  try {
    const parsed = schema.parse(payload);
    return Object.freeze({
      ok: true,
      value: sessionInputRecord(sessionInputValue(parsed)),
    });
  } catch {
    return Object.freeze({ ok: false, reason: "invalid" });
  }
}

/**
 * Parse with an explicit schema object (Zod-compatible).
 *
 * @remarks Prefer {@link parseAgentSessionInputWithAgent} when the Agent
 * definition is available.
 */
export function parseAgentSessionInputWithSchema(
  schema: { parse(input: unknown): unknown } | undefined,
  payload: unknown,
): AgentSessionInputParseResult {
  if (!schema) {
    return Object.freeze({ ok: false, reason: "unavailable" });
  }
  try {
    const parsed = schema.parse(payload);
    return Object.freeze({
      ok: true,
      value: sessionInputRecord(sessionInputValue(parsed)),
    });
  } catch {
    return Object.freeze({ ok: false, reason: "invalid" });
  }
}
