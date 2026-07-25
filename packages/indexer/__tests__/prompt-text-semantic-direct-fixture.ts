import type { SemanticBackendParityFixture } from "./semantic-backend-parity-fixtures";
import { promptTextRef } from "./prompt-text-semantic-fixture-helpers";

const file = "src/prompt-text-direct.ts";
const fileKey = "src-prompt-text-direct.ts-226b0abf8dcb039a";
const source = `import { context, md, prompt } from '@use-crux/core'
import { md as text } from '@use-crux/core'
import type { md as typeMd } from '@use-crux/core'
import * as crux from '@use-crux/core'
import type * as typeCrux from '@use-crux/core'
import { md as otherMd } from '@other/tags'

const localTag = (strings: TemplateStringsArray) => strings.raw.join('')
const valueAlias = md
const named = md\`Named\`
const inner = md\`Inner\`
const outer = md\`Outer \${inner}\`
const inlineNested = md\`Outer \${md\`Inline\`}\`
const fragments = { answer: md\`Object\` }
let mutable = md\`Mutable\`
var legacy = md\`Legacy\`

export const directSystem = prompt({ id: 'direct-system', system: md\`System\` })
export const directPrompt = prompt({ id: 'direct-prompt', prompt: text\`Prompt\` })
export const directContext = context({ id: 'direct-context', system: crux.md\`Context\` })
export const namedSystem = prompt({ id: 'named-system', system: named })
export const objectPrompt = prompt({ id: 'object-prompt', prompt: fragments.answer })
export const outerSystem = prompt({ id: 'outer-system', system: outer })
export const nestedPrompt = prompt({ id: 'nested-prompt', prompt: inlineNested })
export const mutableSystem = prompt({ id: 'mutable-system', system: mutable })
export const legacyPrompt = prompt({ id: 'legacy-prompt', prompt: legacy })
export const localPrompt = prompt({ id: 'local-prompt', prompt: localTag\`Local\` })
export const otherPrompt = prompt({ id: 'other-prompt', prompt: otherMd\`Other\` })
export const typeOnlyPrompt = prompt({ id: 'type-only', prompt: typeMd\`Type only\` })
export const typeOnlyNamespacePrompt = prompt({ id: 'type-only-namespace', prompt: typeCrux.md\`Type only namespace\` })
export const valueAliasPrompt = prompt({ id: 'value-alias', prompt: valueAlias\`Value alias\` })

export const concisePrompt = prompt({ id: 'concise', prompt: () => md\`Concise\` })
export const functionPrompt = prompt({ id: 'function', prompt: function () { return md\`Function\` } })
export const methodPrompt = prompt({ id: 'method', prompt() { return md\`Method\` } })
export const conditionalPrompt = prompt({ id: 'conditional', prompt: (flag: boolean) => flag ? md\`Yes\` : md\`No\` })
function blockValue(flag: boolean) { if (flag) return md\`If\`; else { if (Date.now()) return md\`Nested if\` } return md\`Fallback\` }
export const blockPrompt = prompt({ id: 'block', prompt: blockValue })
const namedCallback = () => named
export const callbackNamedPrompt = prompt({ id: 'callback-named', prompt: namedCallback })
let mutableCallback = () => md\`Mutable callback\`
var legacyCallback = () => md\`Legacy callback\`
const callbackObject = { value() { return md\`Object callback\` } }
export const mutableCallbackPrompt = prompt({ id: 'mutable-callback', prompt: mutableCallback })
export const legacyCallbackPrompt = prompt({ id: 'legacy-callback', prompt: legacyCallback })
export const propertyCallbackPrompt = prompt({ id: 'property-callback', prompt: callbackObject.value })
export const accessorPrompt = prompt({ id: 'accessor', prompt: () => { const holder = { get value() { return md\`Getter\` } }; void holder; return md\`Owned\` } })
function shadowedPrompt() { const md = localTag; return md\`Shadowed\` }
export const shadowed = prompt({ id: 'shadowed', prompt: shadowedPrompt })
`;

const ref = (
  definitionId: string,
  role: "system" | "prompt",
  authoredSource: string,
  lifecycle: "static" | "dynamic",
  options: { readonly symbol?: string; readonly occurrence?: number } = {},
) =>
  promptTextRef({
    definitionId,
    file,
    fileSource: source,
    fileKey,
    role,
    source: authoredSource,
    lifecycle,
    ...options,
  });

/** Same-file prompt-text shapes required on both shared and native-direct paths. */
export const promptTextSemanticDirectFixture: SemanticBackendParityFixture = {
  name: "prompt-text-direct-and-callbacks",
  workspacePackages: ["core"],
  files: {
    [file]: source,
    "src/node_modules/@other/tags/index.ts":
      "export const md = (strings: TemplateStringsArray) => strings.raw.join('')",
  },
  expect: {
    sourceRefRoles: ["prompt", "system"],
    promptTextSourceRefs: [
      ref("prompt:direct-system", "system", "md`System`", "static"),
      ref("prompt:direct-prompt", "prompt", "text`Prompt`", "static"),
      ref("context:direct-context", "system", "crux.md`Context`", "static"),
      ref("prompt:named-system", "system", "md`Named`", "static", {
        symbol: "named",
      }),
      ref("prompt:object-prompt", "prompt", "md`Object`", "static", {
        symbol: "fragments.answer",
      }),
      ref("prompt:outer-system", "system", "md`Inner`", "static", {
        symbol: "inner",
      }),
      ref("prompt:outer-system", "system", "md`Outer ${inner}`", "static", {
        symbol: "outer",
      }),
      ref(
        "prompt:nested-prompt",
        "prompt",
        "md`Outer ${md`Inline`}`",
        "static",
        { symbol: "inlineNested" },
      ),
      ref("prompt:nested-prompt", "prompt", "md`Inline`", "static"),
      ref("prompt:concise", "prompt", "md`Concise`", "dynamic"),
      ref("prompt:function", "prompt", "md`Function`", "dynamic"),
      ref("prompt:method", "prompt", "md`Method`", "dynamic"),
      ref("prompt:conditional", "prompt", "md`Yes`", "dynamic"),
      ref("prompt:conditional", "prompt", "md`No`", "dynamic"),
      ref("prompt:block", "prompt", "md`If`", "dynamic"),
      ref("prompt:block", "prompt", "md`Nested if`", "dynamic"),
      ref("prompt:block", "prompt", "md`Fallback`", "dynamic"),
      ref("prompt:callback-named", "prompt", "md`Named`", "dynamic", {
        symbol: "named",
      }),
      ref("prompt:accessor", "prompt", "md`Owned`", "dynamic"),
    ],
  },
};
