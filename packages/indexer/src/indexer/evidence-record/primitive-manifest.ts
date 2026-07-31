import { extractEvidenceRecord } from "./static-facts";

/** Declarative contributions composed into the first-party Core manifest. */
export const evidenceRecordPrimitiveContributions = Object.freeze({
  extractors: [
    {
      name: "evidence.record",
      patterns: [{ kind: "call" as const, name: "record", configArg: 0 }],
      extract: extractEvidenceRecord,
    },
  ],
  relations: [
    {
      type: "evidence.record.declared_in",
      fromKinds: ["evidence.record"] as const,
      presentation: "detail" as const,
      fidelity: "resolved" as const,
      runtimeJoin: false,
    },
  ],
});
