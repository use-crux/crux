import type { SemanticBackendParityFixture } from "./semantic-backend-parity-fixtures";
import { promptTextRef } from "./prompt-text-semantic-fixture-helpers";

const fragmentAFile = "src/fragments-a.ts";
const fragmentBFile = "src/fragments-b.ts";
const importedFile = "src/imported.ts";
const fragmentASource = `import { md } from '@use-crux/core'
export const fragmentA = md\`Shared A\`
`;
const fragmentBSource = `import { md } from '@use-crux/core'
export const fragmentB = md\`Shared B\`
`;
const importedSource = `import { prompt } from '@use-crux/core'
import { fragmentA } from './fragments-a'
import { fragmentB } from './fragments-b'
import { reexported } from './fragments-barrel'

export const importedA = prompt({ id: 'imported-a', system: fragmentA })
export const importedB = prompt({ id: 'imported-b', system: fragmentB })
export const importedAlias = prompt({ id: 'imported-alias', prompt: reexported })
`;

const importedRef = (
  definitionId: string,
  role: "system" | "prompt",
  file: string,
  fileSource: string,
  fileKey: string,
  source: string,
  symbol: string,
) =>
  promptTextRef({
    definitionId,
    file,
    fileSource,
    fileKey,
    role,
    source,
    lifecycle: "static",
    symbol,
  });

export const importedFragmentsFixture: SemanticBackendParityFixture = {
  name: "prompt-text-imported-fragments",
  workspacePackages: ["core"],
  files: {
    [fragmentAFile]: fragmentASource,
    [fragmentBFile]: fragmentBSource,
    "src/fragments-barrel.ts":
      "export { fragmentA as reexported } from './fragments-a'",
    [importedFile]: importedSource,
  },
  expect: {
    sourceRefRoles: ["prompt", "system"],
    promptTextSourceRefs: [
      importedRef(
        "prompt:imported-a",
        "system",
        fragmentAFile,
        fragmentASource,
        "src-fragments-a.ts-2c027218494fcaca",
        "md`Shared A`",
        "fragmentA",
      ),
      importedRef(
        "prompt:imported-b",
        "system",
        fragmentBFile,
        fragmentBSource,
        "src-fragments-b.ts-54800410f5ee1715",
        "md`Shared B`",
        "fragmentB",
      ),
      importedRef(
        "prompt:imported-alias",
        "prompt",
        fragmentAFile,
        fragmentASource,
        "src-fragments-a.ts-2c027218494fcaca",
        "md`Shared A`",
        "reexported",
      ),
    ],
  },
};

const rootTagsFile = "src/root-tags.ts";
const reexportUserFile = "src/reexport-user.ts";
const rootTagsSource = "export { md as promptText } from '@use-crux/core'\n";
const reexportUserSource = `import { prompt } from '@use-crux/core'
import { promptText as text } from './root-tags'

export const reexportPrompt = prompt({ id: 'root-reexport', prompt: text\`Re-exported\` })
`;

export const localRootReexportFixture: SemanticBackendParityFixture = {
  name: "prompt-text-local-root-reexport",
  workspacePackages: ["core"],
  files: {
    [rootTagsFile]: rootTagsSource,
    [reexportUserFile]: reexportUserSource,
  },
  expect: {
    sourceRefRoles: ["prompt"],
    promptTextSourceRefs: [
      promptTextRef({
        definitionId: "prompt:root-reexport",
        file: reexportUserFile,
        fileSource: reexportUserSource,
        fileKey: "src-reexport-user.ts-054701b9c2ebde1f",
        role: "prompt",
        source: "text`Re-exported`",
        lifecycle: "static",
      }),
    ],
  },
};

const defaultTagBarrelFile = "src/default-tag-barrel.ts";
const defaultTagUserFile = "src/default-tag-user.ts";
const defaultTagBarrelSource = `import { md } from '@use-crux/core'

export default md
`;
const defaultTagUserSource = `import { prompt } from '@use-crux/core'
import text from './default-tag-barrel'

export const defaultTagPrompt = prompt({ id: 'default-tag-reexport', prompt: text\`Default re-export\` })
`;

export const localDefaultReexportFixture: SemanticBackendParityFixture = {
  name: "prompt-text-local-default-reexport",
  workspacePackages: ["core"],
  files: {
    [defaultTagBarrelFile]: defaultTagBarrelSource,
    [defaultTagUserFile]: defaultTagUserSource,
  },
  expect: {
    sourceRefRoles: ["prompt"],
    promptTextSourceRefs: [
      promptTextRef({
        definitionId: "prompt:default-tag-reexport",
        file: defaultTagUserFile,
        fileSource: defaultTagUserSource,
        fileKey: "src-default-tag-user.ts-1a7d9799e5064600",
        role: "prompt",
        source: "text`Default re-export`",
        lifecycle: "static",
      }),
    ],
  },
};

const packageReexportFile = "src/package-reexport.ts";
const packageReexportSource = `import { prompt } from '@use-crux/core'
import { text } from '@acme/prompt-text'

export const packageReexportPrompt = prompt({ id: 'package-reexport', prompt: text\`Package re-export\` })
`;

export const packageRootReexportFixture: SemanticBackendParityFixture = {
  name: "prompt-text-package-root-reexport",
  workspacePackages: ["core"],
  files: {
    "src/node_modules/@acme/prompt-text/index.ts":
      "export { md as text } from '@use-crux/core'\n",
    [packageReexportFile]: packageReexportSource,
  },
  expect: {
    sourceRefRoles: ["prompt"],
    promptTextSourceRefs: [
      promptTextRef({
        definitionId: "prompt:package-reexport",
        file: packageReexportFile,
        fileSource: packageReexportSource,
        fileKey: "src-package-reexport.ts-6f617a0c67a88269",
        role: "prompt",
        source: "text`Package re-export`",
        lifecycle: "static",
      }),
    ],
  },
};

export const typeOnlyReexportFixture: SemanticBackendParityFixture = {
  name: "prompt-text-type-only-reexport",
  workspacePackages: ["core"],
  files: {
    "src/type-only-tags.ts":
      "export type { md as typeText } from '@use-crux/core'\n",
    "src/type-only-user.ts": `import { prompt } from '@use-crux/core'
import { typeText } from './type-only-tags'

export const typeOnlyPrompt = prompt({ id: 'type-only-reexport', prompt: typeText\`Type only\` })
`,
  },
  expect: {
    promptTextSourceRefs: [],
  },
};

export const typeOnlyEdgeFixture: SemanticBackendParityFixture = {
  name: "prompt-text-type-only-default-and-star",
  workspacePackages: ["core"],
  files: {
    "src/value-default-tags.ts":
      "export { md as default } from '@use-crux/core'\n",
    "src/type-star-tags.ts": "export type * from '@use-crux/core'\n",
    "src/type-only-edges-user.ts": `import { prompt } from '@use-crux/core'
import type typeDefault from './value-default-tags'
import { md as typeStar } from './type-star-tags'

export const typeDefaultPrompt = prompt({ id: 'type-default', prompt: typeDefault\`Type default\` })
export const typeStarPrompt = prompt({ id: 'type-star', prompt: typeStar\`Type star\` })
`,
  },
  expect: {
    promptTextSourceRefs: [],
  },
};

const valueStarUserFile = "src/value-star-user.ts";
const valueStarUserSource = `import { prompt } from '@use-crux/core'
import { md as text } from './value-star-tags'

export const valueStarPrompt = prompt({ id: 'value-star', prompt: text\`Value star\` })
`;

export const valueStarTagFixture: SemanticBackendParityFixture = {
  name: "prompt-text-value-star-tag-reexport",
  workspacePackages: ["core"],
  files: {
    "src/value-star-tags.ts":
      "export type * from './missing-type-tags'\nexport * from '@use-crux/core'\n",
    [valueStarUserFile]: valueStarUserSource,
  },
  expect: {
    sourceRefRoles: ["prompt"],
    promptTextSourceRefs: [
      promptTextRef({
        definitionId: "prompt:value-star",
        file: valueStarUserFile,
        fileSource: valueStarUserSource,
        fileKey: "src-value-star-user.ts-8a7b807e48dfaac0",
        role: "prompt",
        source: "text`Value star`",
        lifecycle: "static",
      }),
    ],
  },
};

export const ambiguousStarTagFixture: SemanticBackendParityFixture = {
  name: "prompt-text-ambiguous-value-star-tag-reexport",
  workspacePackages: ["core"],
  files: {
    "src/left-tags.ts":
      "export const md = (strings: TemplateStringsArray) => strings[0]\n",
    "src/right-tags.ts":
      "export const md = (strings: TemplateStringsArray) => strings[0]\n",
    "src/ambiguous-tags.ts":
      "export * from './left-tags'\nexport * from './right-tags'\n",
    "src/ambiguous-user.ts": `import { prompt } from '@use-crux/core'
import { md as text } from './ambiguous-tags'

export const ambiguousPrompt = prompt({ id: 'ambiguous-star', prompt: text\`Ambiguous\` })
`,
  },
  expect: {
    promptTextSourceRefs: [],
  },
};

export const pathsInterceptTagFixture: SemanticBackendParityFixture = {
  name: "prompt-text-paths-intercepted-package-root",
  workspacePackages: ["core"],
  compilerOptions: {
    baseUrl: ".",
    paths: {
      "@use-crux/core": ["node_modules/@use-crux/core/src/index.ts"],
    },
  },
  files: {
    "src/paths-user.ts": `import { md, prompt } from '@use-crux/core'

export const pathsPrompt = prompt({ id: 'paths-intercept', prompt: md\`Intercepted\` })
`,
  },
  expect: {
    promptTextSourceRefs: [],
  },
};

export const wrongPackageIdentityFixture: SemanticBackendParityFixture = {
  name: "prompt-text-wrong-package-identity",
  files: {
    "node_modules/@use-crux/core/package.json": JSON.stringify({
      name: "@use-crux/lookalike",
      exports: { ".": "./index.ts" },
    }),
    "node_modules/@use-crux/core/index.ts": `export const md = (strings: TemplateStringsArray) => strings[0]
export const prompt = (config: unknown) => config
`,
    "src/wrong-package-user.ts": `import { md, prompt } from '@use-crux/core'

export const wrongPackagePrompt = prompt({ id: 'wrong-package', prompt: md\`Wrong package\` })
`,
  },
  expect: {
    promptTextSourceRefs: [],
  },
};

const defaultFragmentFile = "src/default-fragment.ts";
const defaultFragmentSource = `import { md } from '@use-crux/core'
const answer = md\`Default fragment\`
export default answer
`;
const starFragmentFile = "src/star-fragment.ts";
const starFragmentSource = `import { md } from '@use-crux/core'
export const starAnswer = md\`Star fragment\`
`;
const esmAliasUserFile = "src/esm-fragment-user.ts";
const esmAliasUserSource = `import { prompt } from '@use-crux/core'
import defaultFragment from './default-fragment'
import { starAnswer as starFragment } from './star-fragment-barrel'

export const defaultPrompt = prompt({ id: 'default-fragment', prompt: defaultFragment })
export const starPrompt = prompt({ id: 'star-fragment', prompt: starFragment })
`;

export const esmFragmentAliasFixture: SemanticBackendParityFixture = {
  name: "prompt-text-default-and-star-fragment-aliases",
  workspacePackages: ["core"],
  files: {
    [defaultFragmentFile]: defaultFragmentSource,
    [starFragmentFile]: starFragmentSource,
    "src/star-fragment-barrel.ts": "export * from './star-fragment'\n",
    [esmAliasUserFile]: esmAliasUserSource,
  },
  expect: {
    sourceRefRoles: ["prompt"],
    promptTextSourceRefs: [
      importedRef(
        "prompt:default-fragment",
        "prompt",
        defaultFragmentFile,
        defaultFragmentSource,
        "src-default-fragment.ts-189a1228b8e66bc2",
        "md`Default fragment`",
        "defaultFragment",
      ),
      importedRef(
        "prompt:star-fragment",
        "prompt",
        starFragmentFile,
        starFragmentSource,
        "src-star-fragment.ts-1c424bd840087a35",
        "md`Star fragment`",
        "starFragment",
      ),
    ],
  },
};

export const cyclicFragmentReexportFixture: SemanticBackendParityFixture = {
  name: "prompt-text-cyclic-fragment-reexport",
  workspacePackages: ["core"],
  files: {
    "src/cycle-a.ts": "export { fragmentB as fragmentA } from './cycle-b'\n",
    "src/cycle-b.ts": "export { fragmentA as fragmentB } from './cycle-a'\n",
    "src/tag-cycle-a.ts": "export { tagB as tagA } from './tag-cycle-b'\n",
    "src/tag-cycle-b.ts": "export { tagA as tagB } from './tag-cycle-a'\n",
    "src/cycle-user.ts": `import { prompt } from '@use-crux/core'
import { fragmentA } from './cycle-a'
import { tagA } from './tag-cycle-a'

export const cyclicPrompt = prompt({ id: 'cyclic-fragment', prompt: fragmentA })
export const cyclicTagPrompt = prompt({ id: 'cyclic-tag', prompt: tagA\`Cycle\` })
`,
  },
  expect: {
    promptTextSourceRefs: [],
  },
};

const broadFile = "src/broad-callbacks.ts";
const broadSource = `import { md, prompt } from '@use-crux/core'

function broadValue(mode: string) {
  for (const value of [mode]) {
    if (value === 'loop') return md\`Loop\`
  }
  switch (mode) {
    case 'switch': return md\`Switch\`
  }
  try {
    if (mode === 'try') return md\`Try\`
  } catch {
    return md\`Catch\`
  } finally {
    if (mode === 'finally') return md\`Finally\`
  }
  return md\`Done\`
}

export const broadPrompt = prompt({ id: 'broad', prompt: broadValue })
`;

export const broadControlFlowFixture: SemanticBackendParityFixture = {
  name: "prompt-text-broad-callback-control-flow",
  workspacePackages: ["core"],
  files: { [broadFile]: broadSource },
  expect: {
    sourceRefRoles: ["prompt"],
    promptTextSourceRefs: [
      "Loop",
      "Switch",
      "Try",
      "Catch",
      "Finally",
      "Done",
    ].map((text) =>
      promptTextRef({
        definitionId: "prompt:broad",
        file: broadFile,
        fileSource: broadSource,
        fileKey: "src-broad-callbacks.ts-b9f847665a72c472",
        role: "prompt",
        source: `md\`${text}\``,
        lifecycle: "dynamic",
      }),
    ),
  },
};

export const unresolvedIdentityFixture: SemanticBackendParityFixture = {
  name: "prompt-text-unresolved-tag-identity",
  workspacePackages: ["core"],
  files: {
    "src/unresolved.ts": `import { prompt } from '@use-crux/core'
import { md as missingMd } from '@missing/tags'

export const unresolvedPrompt = prompt({ id: 'unresolved', prompt: missingMd\`Missing\` })
`,
  },
  expect: {
    promptTextSourceRefs: [],
  },
};

export const promptTextSemanticSharedFixtures: readonly SemanticBackendParityFixture[] =
  [
    importedFragmentsFixture,
    localRootReexportFixture,
    localDefaultReexportFixture,
    packageRootReexportFixture,
    typeOnlyReexportFixture,
    typeOnlyEdgeFixture,
    valueStarTagFixture,
    ambiguousStarTagFixture,
    pathsInterceptTagFixture,
    wrongPackageIdentityFixture,
    esmFragmentAliasFixture,
    cyclicFragmentReexportFixture,
    broadControlFlowFixture,
    unresolvedIdentityFixture,
  ];
