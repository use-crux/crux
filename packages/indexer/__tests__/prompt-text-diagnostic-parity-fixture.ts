import type { SemanticBackendParityFixture } from "./semantic-backend-parity-fixtures";

/** Direct-native source shapes that freeze normalized PromptText diagnostics. */
export const promptTextDiagnosticParityFixture: SemanticBackendParityFixture = {
  name: "prompt-text-diagnostic-conclusions",
  workspacePackages: ["core"],
  files: {
    "src/diagnostics.ts": `
      import { md, prompt } from '@use-crux/core'

      const exactTrue = true
      const values = ['first', 'second'] as string[]

      export const invalid = prompt({
        id: 'invalid',
        prompt: md\`Value: \${exactTrue}\`,
      })
      export const sequence = prompt({
        id: 'sequence',
        prompt: md\`Values: \${values}\`,
      })
      export const json = prompt({
        id: 'json',
        prompt: md\`Value: \${md.json(undefined)}\`,
      })
      export const object = prompt({
        id: 'object',
        prompt: md\`Value: \${Promise.resolve('value')}\`,
      })
    `,
  },
  expect: {
    diagnosticCodes: [
      "CRUX_PROMPT_TEXT_INLINE_SEQUENCE",
      "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
      "CRUX_PROMPT_TEXT_JSON_SERIALIZATION",
    ],
    diagnosticDefinitionIds: [
      "prompt:invalid",
      "prompt:sequence",
      "prompt:json",
      "prompt:object",
    ],
  },
};
