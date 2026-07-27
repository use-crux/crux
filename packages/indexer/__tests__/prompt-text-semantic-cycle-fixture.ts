import type { SemanticBackendParityFixture } from "./semantic-backend-parity-fixtures";
import { promptTextRef } from "./prompt-text-semantic-fixture-helpers";

const file = "src/prompt-cycle.ts";
const source = `import { md, prompt } from '@use-crux/core'

const first = md\`First \${second}\`
const second = md\`Second \${first}\`

export const writer = prompt({ id: 'cycle', prompt: first })
`;
const definitionId = "prompt:cycle";
const fileKey = "src-prompt-cycle.ts-af589c738a2b0d44";

/**
 * A semantic cycle contributes no saved fragment joins. Rust still handles
 * same-document syntax cycles independently with its active rendering stack.
 */
export const promptTextSemanticCycleFixture: SemanticBackendParityFixture = {
  name: "prompt-text-semantic-fragment-cycle",
  workspacePackages: ["core"],
  files: { [file]: source },
  expect: {
    sourceRefRoles: ["prompt"],
    promptTextSourceRefs: [
      promptTextRef({
        definitionId,
        file,
        fileSource: source,
        fileKey,
        role: "prompt",
        source: "md`First ${second}`",
        lifecycle: "static",
        symbol: "first",
      }),
      promptTextRef({
        definitionId,
        file,
        fileSource: source,
        fileKey,
        role: "prompt",
        source: "md`Second ${first}`",
        lifecycle: "static",
        symbol: "second",
      }),
    ],
  },
};
