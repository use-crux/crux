import { readFileSync } from "node:fs";
import type { SemanticBackendParityFixture } from "./semantic-backend-parity-fixtures";

const conformanceSource = readFileSync(
  new URL("./fixtures/prompt-text-editor-conformance-v1.ts", import.meta.url),
  "utf8",
);

/** Direct-native source shapes that freeze normalized PromptText diagnostics. */
export const promptTextDiagnosticParityFixture: SemanticBackendParityFixture = {
  name: "prompt-text-diagnostic-conclusions",
  workspacePackages: ["core"],
  files: {
    "src/diagnostics.ts": conformanceSource,
  },
  expect: {
    diagnosticCodes: [
      "CRUX_PROMPT_TEXT_INLINE_SEQUENCE",
      "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
      "CRUX_PROMPT_TEXT_JSON_SERIALIZATION",
    ],
    diagnosticDefinitionIds: ["prompt:editor-conformance"],
  },
};
