import type { SemanticBackendParityFixture } from "./semantic-backend-parity-fixtures";
import { promptTextSemanticDirectFixture } from "./prompt-text-semantic-direct-fixture";
import { promptTextSemanticSharedFixtures } from "./prompt-text-semantic-shared-fixtures";

/** Prompt-text fixtures shared by JavaScript and native semantic backends. */
export const promptTextSemanticParityFixtures: readonly SemanticBackendParityFixture[] =
  [
    promptTextSemanticDirectFixture,
    ...promptTextSemanticSharedFixtures,
    {
      name: "prompt-text-rejects-other-core-root-export-as-tag",
      workspacePackages: ["core"],
      files: {
        "src/wrong-export.ts": `
          import { context as wrongTag, prompt } from '@use-crux/core'

          export const writer = prompt({
            id: 'writer',
            prompt: wrongTag\`Wrong export\`,
          })
        `,
      },
      expect: {
        promptTextSourceRefs: [],
      },
    },
  ];
