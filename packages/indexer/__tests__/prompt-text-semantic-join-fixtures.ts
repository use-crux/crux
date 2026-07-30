import type { ProjectSourceRef } from "@use-crux/core/project-index";
import type { SemanticBackendParityFixture } from "./semantic-backend-parity-fixtures";
import {
  promptTextRef,
  sourceRange,
} from "./prompt-text-semantic-fixture-helpers";

const fragmentFile = "src/dual-fragment.ts";
const writerFile = "src/dual-writer.ts";
const fragmentSource = `import { md } from '@use-crux/core'
export const shared = md\`Shared\`
`;
const writerSource = `import { md, prompt } from '@use-crux/core'
import { shared } from './dual-fragment'

export const writer = prompt({
  id: 'dual',
  system: md\`System \${shared}\`,
  prompt: md\`Prompt \${(shared as unknown)!}\`,
})
`;
const definitionId = "prompt:dual";

function ref(
  role: "system" | "prompt",
  file: string,
  fileSource: string,
  fileKey: string,
  source: string,
  symbol?: string,
) {
  return promptTextRef({
    definitionId,
    role,
    file,
    fileSource,
    fileKey,
    source,
    lifecycle: "static",
    ...(symbol ? { symbol } : {}),
  });
}

const targetSystem = ref(
  "system",
  fragmentFile,
  fragmentSource,
  "src-dual-fragment.ts-a21aad95c8eac334",
  "md`Shared`",
  "shared",
);
const targetPrompt = ref(
  "prompt",
  fragmentFile,
  fragmentSource,
  "src-dual-fragment.ts-a21aad95c8eac334",
  "md`Shared`",
  "shared",
);
const ownerSystem = ref(
  "system",
  writerFile,
  writerSource,
  "src-dual-writer.ts-a9f6e1d3bb5dca5e",
  "md`System ${shared}`",
);
const ownerPrompt = ref(
  "prompt",
  writerFile,
  writerSource,
  "src-dual-writer.ts-a9f6e1d3bb5dca5e",
  "md`Prompt ${(shared as unknown)!}`",
);

function withJoin(
  owner: (typeof ownerSystem)["ref"],
  target: (typeof targetSystem)["ref"],
  expression: string,
  expressionOccurrence: number,
): ProjectSourceRef {
  return {
    ...owner,
    metadata: {
      ...owner.metadata,
      promptText: {
        ...owner.metadata!.promptText!,
        fragmentJoins: [
          {
            kind: "named-fragment",
            ownerSourceRefId: owner.id,
            ownerTemplateRange: owner.snippet!.range,
            interpolationIndex: 0,
            expressionRange: {
              file: writerFile,
              ...sourceRange(
                writerSource,
                expression,
                expressionOccurrence,
              ),
            },
            targetSourceRefId: target.id,
            targetTemplateRange: target.snippet!.range,
            proof: "semantic-exact",
          },
        ],
      },
    },
  };
}

/** Locks join identity to the owning definition property and lifecycle. */
export const promptTextRoleScopedJoinFixture: SemanticBackendParityFixture = {
  name: "prompt-text-role-scoped-fragment-joins",
  workspacePackages: ["core"],
  files: {
    [fragmentFile]: fragmentSource,
    [writerFile]: writerSource,
  },
  expect: {
    sourceRefRoles: ["prompt", "system"],
    promptTextSourceRefs: [
      targetSystem,
      targetPrompt,
      {
        ...ownerSystem,
        ref: withJoin(ownerSystem.ref, targetSystem.ref, "shared", 1),
      },
      {
        ...ownerPrompt,
        ref: withJoin(
          ownerPrompt.ref,
          targetPrompt.ref,
          "(shared as unknown)!",
          0,
        ),
      },
    ],
  },
};

const ambiguousObjectFile = "src/ambiguous-fragments.ts";
const ambiguousObjectSource = `import { md, prompt } from '@use-crux/core'

const key = 'note'
const duplicate = { note: md\`Duplicate private\`, note: getValue() }
const spread = { note: md\`Spread private\`, ...getCatalogue() }
const computed = { note: md\`Computed private\`, [key]: getValue() }

export const value = prompt({
  id: 'ambiguous-fragments',
  prompt: md\`\${duplicate.note}|\${spread.note}|\${computed.note}\`,
})
`;

/** Rejects object properties whose runtime value can be overwritten. */
export const promptTextAmbiguousObjectJoinFixture: SemanticBackendParityFixture =
  {
    name: "prompt-text-ambiguous-object-fragment-joins",
    workspacePackages: ["core"],
    files: {
      [ambiguousObjectFile]: ambiguousObjectSource,
    },
    expect: {
      sourceRefRoles: ["prompt"],
      promptTextSourceRefs: [
        promptTextRef({
          definitionId: "prompt:ambiguous-fragments",
          role: "prompt",
          file: ambiguousObjectFile,
          fileSource: ambiguousObjectSource,
          fileKey: "src-ambiguous-fragments.ts-fd77cce013ba4a6c",
          source: "md`${duplicate.note}|${spread.note}|${computed.note}`",
          lifecycle: "static",
        }),
      ],
    },
  };
