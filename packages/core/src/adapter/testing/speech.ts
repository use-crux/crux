/** Test-only speech support rows shared by first-party adapters. */
export type SpeechFixtureAdapter =
  | "ai-sdk"
  | "anthropic"
  | "convex"
  | "google"
  | "openai";

export interface SpeechConformanceRow {
  readonly adapter: SpeechFixtureAdapter;
  readonly support: "native" | "exact-ai-re-export" | "absent";
}

/** Frozen all-five parity expectation; not a public capability registry. */
export const SPEECH_CONFORMANCE = Object.freeze([
  Object.freeze({ adapter: "ai-sdk", support: "native" }),
  Object.freeze({ adapter: "anthropic", support: "absent" }),
  Object.freeze({ adapter: "convex", support: "exact-ai-re-export" }),
  Object.freeze({ adapter: "google", support: "native" }),
  Object.freeze({ adapter: "openai", support: "native" }),
] satisfies readonly SpeechConformanceRow[]);

/** Read one adapter expectation from the internal support fixture. */
export function speechConformanceRow(
  adapter: SpeechFixtureAdapter,
): SpeechConformanceRow {
  const row = SPEECH_CONFORMANCE.find(
    (candidate) => candidate.adapter === adapter,
  );
  if (!row) throw new Error(`Missing speech conformance row for ${adapter}.`);
  return row;
}
