import { canonicalJson } from "../../internal/evidence/canonical-json";
import type { LoadedEvalCase } from "../cases";

/** Serialize one sidecar row with stable keys and a terminating newline. */
export function canonicalReviewRow(value: unknown): string {
  return `${canonicalJson(value)}\n`;
}

/** Project the Case fields that define semantic Review deduplication. */
export function canonicalCaseSemantics(entry: LoadedEvalCase): string {
  return canonicalJson({
    input: entry.authored.input,
    ...(entry.authored.call !== undefined ? { call: entry.authored.call } : {}),
    ...(entry.authored.expected !== undefined
      ? { expected: entry.authored.expected }
      : {}),
  });
}
