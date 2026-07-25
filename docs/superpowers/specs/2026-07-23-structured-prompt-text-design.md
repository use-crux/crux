# Structured prompt text

**Status:** Design approved on 2026-07-23; implementation not started

## Summary

Crux will add an optional Markdown-oriented tagged template named `md`. It
produces an opaque `PromptText` value that can be used anywhere Crux currently
accepts authored system or user-prompt text:

- `prompt.system`;
- `prompt.prompt`; and
- `context.system`.

`md` improves multiline indentation, conditional sections, repeated sections,
composition, diagnostics, previews, and runtime provenance without introducing
a second control language. TypeScript remains responsible for conditions,
loops, schemas, tools, settings, caching, and orchestration. The tag executes as
ordinary JavaScript and requires no compiler transform, precompiler, generated
file, or build plugin.

Existing strings remain first-class and preserve their current behavior
byte-for-byte. The new API is additive.

V1 deliberately contains only:

```ts
md`...`             // PromptText
md.json(value)      // PromptText
type PromptText
```

There is no `md.join`, `md.use`, helper language, include system, or whole-prompt
configuration syntax in V1.

## Problem

Ordinary template literals are an excellent control-language boundary, but
larger prompts expose recurring authoring friction:

- source indentation leaks into the rendered prompt;
- optional multiline sections leave unpredictable blank lines;
- mapped fragments require awkward joining and indentation;
- arbitrary objects stringify as `[object Object]` unless handled manually;
- composed strings discard the distinction between authored and interpolated
  content; and
- an editor cannot safely explain or preview the final structure after ordinary
  string concatenation has erased it.

Established prompt formats solve some of this by introducing XML-like markup,
Jinja/Handlebars control flow, TSX, or standalone prompt files. Those approaches
also split the programming model, duplicate TypeScript capabilities, or require
a build/runtime boundary that Crux does not need.

Crux needs a smaller abstraction: structured authored text that still looks and
behaves like TypeScript.

## Product principles

1. **Optional means optional.** Strings remain supported and do not acquire new
   whitespace or interpolation behavior.
2. **Prompts read as prose.** Markdown content should dominate the source rather
   than tags, helper syntax, or configuration punctuation.
3. **TypeScript is the only control language.** Users use normal variables,
   functions, conditions, `.map()`, and refactoring tools.
4. **No hidden compilation.** Runtime meaning must be derivable from
   `TemplateStringsArray` and captured values.
5. **Position, not value kind, controls whitespace.** A string and a nested
   `PromptText` inserted in the same position follow the same indentation rule.
6. **Authored output is predictable without a preview.** Preview verifies the
   result; it must not be required to understand the basic rendering rules.
7. **Composition is not a security boundary.** Existing validation,
   sanitization, and model-ingress safety remain authoritative.
8. **The first release stays small.** New helpers require demonstrated use cases
   rather than speculative completeness.

## Public API

`@use-crux/core` exports the `md` value and nominal `PromptText` type from its
root entry point.

Conceptually, the public typing is:

```ts
type PromptTextValue =
  | string
  | number
  | PromptText
  | false
  | null
  | undefined
  | readonly PromptTextValue[];

interface MdTag {
  (strings: TemplateStringsArray, ...values: PromptTextValue[]): PromptText;

  json(value: unknown): PromptText;
}

export declare const md: MdTag;
```

`PromptTextValue` and `MdTag` above describe the contract but are not exported in
V1. `PromptText` is the stable public result type. It is nominal, immutable, and
structurally distinct from `string`. Its internal nodes are not public API, and
it is not implicitly string-coercible.

The tag is used as follows:

```ts
import { context, md, prompt, type PromptText } from "@use-crux/core";

const sharedRules = context({
  id: "shared-rules",
  system: md`
    ## Rules

    - Be concise.
    - State uncertainty.
  `,
});

function accountSection(account: Account | undefined): PromptText | undefined {
  if (!account) return undefined;

  return md`
    ## Account

    ${md.json(account)}
  `;
}

export const support = prompt({
  id: "support",
  use: [sharedRules],
  input: SupportInput,

  system: ({ input }) => md`
    # Role

    You are a support specialist.

    ${accountSection(input.account)}

    ## Recent events

    ${input.events.map((event) => md`- **${event.type}:** ${event.summary}`)}
  `,

  prompt: ({ input }) => md`
    ${input.question}
  `,
});
```

The name `md` describes the authoring notation. `PromptText` describes the
provider-neutral runtime value. Crux does not parse, validate, or render
CommonMark; Markdown is the editor language and authoring convention, while the
resolved output remains plain text.

## Accepted fields and callback compatibility

The following public unions gain `PromptText`:

| Field            | Static value                                   | Callback result                                 |
| ---------------- | ---------------------------------------------- | ----------------------------------------------- |
| `prompt.system`  | `string \| ContextSystemContent \| PromptText` | Existing system-result union plus `PromptText`  |
| `prompt.prompt`  | `string \| PromptText`                         | `string \| PromptText`                          |
| `context.system` | `string \| ContextSystemContent \| PromptText` | Existing context-result union plus `PromptText` |

Existing outer callback timing is preserved. A system or context callback that
is currently allowed to be async may resolve to `PromptText`. The `md` tag
itself does not accept Promise interpolation. `prompt.prompt` retains its
existing synchronous callback contract.

A direct `PromptText` context contribution is static for context lifecycle,
memo, and provider-cache classification just like a direct string. A callback
returning `PromptText` remains dynamic for those lifecycle decisions.

`messages` content is unchanged in V1. This avoids prematurely defining
structured text across roles, multimodal parts, and provider-native content.
The canonical `Message` and `MessageContent` types do not gain `PromptText`, so
assigning it there remains a type error. The existing `prompt({ messages })`
callback deliberately remains `AnyMessage[]`, whose `content: unknown` is the
provider-open escape hatch; it cannot and does not statically exclude one
nominal value. Existing message runtime guards are unchanged. RFC #273 owns any
future typed or runtime `PromptText` message integration.

## PromptText representation

Each `md` invocation creates a deeply immutable content tree containing:

- normalized literal chunks;
- scalar interpolations;
- nested `PromptText` fragments;
- snapshotted recursive sequences; and
- explicit JSON fragments.

Values are validated and snapshotted when the tag or helper runs. Arrays are
copied recursively rather than retained by reference. `md.json()` snapshots its
serialized output. A later mutation of an input array or object therefore
cannot change an already-created `PromptText` value.

Construction does not flatten the tree to a string. Nested fragments retain
their literal/interpolation boundaries until the resolver lowers the value.
Module-scoped fragments are consequently cheap to reuse and preserve their own
segment structure.

`PromptText` is an in-process authoring value, not a wire format. Crux lowers it
before provider adapters, context memo storage, generated artifacts, or other
RPC boundaries that currently carry resolved text. No adapter package depends
on the private tree shape.

## Value rendering

V1 accepts these interpolation values:

- strings, including multiline and empty strings;
- finite numbers;
- nested `PromptText` values;
- `false`, `null`, and `undefined`, which omit content; and
- readonly or mutable arrays containing accepted values recursively.

The literal type `false` is intentionally accepted so normal TypeScript
conditionals work. Named intermediate fragments keep multiline parents easy to
read and format:

```ts
const warning = input.warning && md`> Warning: ${input.warning}`;

return md`
  # Result

  ${warning}
`;
```

General booleans and `true` are rejected. Interpolating a boolean directly is
usually accidental, while `condition && fragment` evaluates to
`false | PromptText` and remains supported. `NaN`, positive or negative
infinity, bigint, symbols, functions, Promises, and arbitrary objects are also
rejected.

Objects must be made explicit with `md.json()`. This prevents the silent
`[object Object]` output produced by native string interpolation.

Invalid-value descriptions are intentionally coarse and trap-free. Every
unsupported non-null object-like value, including a native Promise, thenable,
ordinary object, or object Proxy, reports the safe kind `object`. Promise
interpolation remains invalid; the runtime does not inspect properties,
prototypes, constructors, or coercion hooks merely to give it a more specific
diagnostic label. A revoked Proxy must produce the same stable Crux error rather
than leaking its native exception.

## Whitespace contract

Whitespace behavior is determined by the interpolation's source position, not
whether its value happens to be a string or `PromptText`.

### Template normalization

Each `md` template is normalized independently:

1. Remove leading and trailing blank lines around the template body.
2. Find the common leading indentation shared by nonblank authored lines.
3. Remove that indentation while preserving all relative indentation and
   intentional blank lines inside the body.

A blank line contains only spaces or tabs. The common indentation is the shared
source-whitespace prefix, so consistently indented spaces or tabs work without
assigning a visual width to tabs. Cooked template-literal escape behavior stays
the same as native JavaScript.

Crux does not globally collapse blank lines. Intentional spacing, including
blank lines inside fenced examples, remains authored content.

### Block and inline interpolation

An interpolation is a **block interpolation** when the literal text before it
on the same line contains only indentation and the literal text after it reaches
the line boundary without non-whitespace content. Template start and end count
as line boundaries. Every other interpolation is **inline**.

For a block interpolation:

- the rendered value's first line occupies the carrier line;
- each subsequent line receives the carrier line's indentation;
- nested-fragment relative indentation is preserved;
- sequence items are joined with one newline; and
- an empty result removes the entire carrier line.

For an inline interpolation:

- scalar or fragment text is inserted verbatim at that position;
- multiline output remains verbatim and receives no automatic continuation
  indentation; and
- a sequence is rejected, even if it contains zero or one item.

These rules apply equally to strings and nested `PromptText` values. Authors
choose block position when they want multiline alignment.

For example:

```ts
md`
  - Evidence:
    ${md`
      1. First
      2. Second
    `}
`;
```

renders:

```md
- Evidence:
  1. First
  2. Second
```

Mapped fragments render naturally in block position:

```ts
md`
  ## Events

  ${events.map((event) => md`- ${event.summary}`)}
`;
```

An inline scalar list uses ordinary TypeScript:

```ts
md`Enabled regions: ${regions.join(", ")}`;
```

V1 does not provide an inline join operation for `PromptText[]`. That gap is
preferable to adding a helper before real usage establishes its correct
semantics.

### Empty block seams

Removing an empty block must not add a visual hole. When removal joins authored
blank-line runs immediately before and after the carrier line, the renderer
retains the larger run rather than adding the two runs together. All other
blank-line runs remain untouched.

Run size is the number of blank lines, not their character length. On equal
sizes, the earlier run wins and its exact post-normalization spaces, tabs, and
line boundaries survive. Across adjacent omitted carriers, this is equivalent
to retaining the earliest of the longest authored runs in that maximal seam
cluster.

Conceptually:

```ts
md`
  # Role

  ${undefined}

  ## Output
`;
```

renders with one authored blank line between `# Role` and `## Output`, not two.
The same local seam rule composes across adjacent omitted blocks.

This is the only blank-line cleanup beyond outer trimming. It can be stated to
users more simply as: **an empty block disappears without leaving an extra
blank line.**

## JSON helper

`md.json(value)` returns a `PromptText` snapshot using the semantics of:

```ts
JSON.stringify(value, null, 2);
```

The output is always two-space-indented JSON. It does not change based on block
or inline position and does not add Markdown fences. Authors who want a fenced
block write it explicitly:

````ts
md`
  ## Account

  ```json
  ${md.json(input.account)}
  ```
`
````

Native JSON behavior for object properties and array entries remains
documented behavior: unsupported object properties are omitted and unsupported
array entries become `null`. A top-level value for which `JSON.stringify`
returns `undefined`, a cyclic value, or a value containing bigint fails with a
stable Crux error rather than leaking a native exception or producing no text.

`md.json` is a serializer, not a sanitizer, redactor, canonical key sorter, or
security escape hatch.

## Resolver integration

The lowering boundary lives inside `@use-crux/core` prompt resolution:

```text
authoring value
  -> existing input validation and sanitization
  -> prompt/context callback evaluation
  -> PromptText lowering
  -> existing system composition, context ordering, budgets, and adaptations
  -> existing provider-neutral resolved prompt
  -> adapter
```

Lowering returns normalized text plus contiguous structural segments. The
system path maps those segments into the existing `ResolvedSystemContent` and
`ContextTextSegment` contracts before system composition. The user-prompt path
keeps the same public resolved `prompt: string` while making optional segment
detail available to inspection and observability.

The provider-neutral outputs consumed by adapters remain strings and existing
system blocks. Provider packages do not learn about `PromptText`.

Prompt and system adaptations run after lowering, exactly where they run for
strings today. Context token budgeting, priority, conditions, memoization,
provider-cache grouping, and ordering also retain their existing behavior.

String and `PromptText` paths are equivalent at this downstream boundary when
they lower to the same text. They are not promised to produce identical bytes
from visually similar source because `md` applies its documented normalization
and ordinary strings do not.

## Context placement remains unchanged

`use: []` remains the only declaration of context authority. A context's
`PromptText` controls formatting within that context contribution; it does not
move the contribution inside the owning prompt's text.

V1 does not reserve or ship `md.use()`, a placeholder node, or a catch-all slot.
A future context-placement design must be complete enough to define:

- selective versus catch-all placement;
- nested contexts;
- repeated or missing placement;
- multiple contribution kinds;
- conditions and exclusions;
- token-budget decisions;
- context memoization; and
- provider-cache boundaries.

Until that design exists, contexts continue to resolve around prompt-owned
system text according to the current resolver contract.

## Provenance and observability

The tree preserves structural provenance through lowering:

- literal chunks are authored/static segments;
- scalar and JSON nodes are interpolated/dynamic segments;
- nested fragments retain their own boundaries; and
- sequences retain the boundaries of their items.

Here, `dynamic` means interpolated rather than literal; it does not promise that
the value changes on every resolution. Existing direct-value versus callback
classification remains the authority for lifecycle and cache behavior.

Every character in lowered output belongs to exactly one segment. Rendering
assigns whitespace as follows:

- whitespace already present in a literal chunk remains authored/static;
- indentation copied from the parent carrier line onto later block-value lines
  is authored/static because the parent template authored that layout;
- newlines inserted between sequence items are interpolated/dynamic because
  their presence depends on the sequence shape; these structural separators
  carry no source or freshness metadata;
- whitespace contained inside an interpolated string or JSON value remains
  interpolated/dynamic;
- nested-fragment text retains the nested fragment's ownership, with any parent
  carrier indentation represented by separate authored/static segments; and
- trimmed indentation, removed carrier lines, and removed seam whitespace do
  not appear in any output segment.

After rendering, adjacent segments with identical dynamic/source/freshness
metadata are coalesced and empty segments are discarded. Concatenating segment
text must reproduce the exact lowered text. Static and dynamic token attribution
uses these final segments and the active tokenizer, including after a context
memo hit.

The runtime can guarantee segment boundaries and owning prompt/context IDs. It
cannot derive an interpolation's exact source expression or file position from
`TemplateStringsArray`: JavaScript does not provide those locations. Existing
definition-source capture and Project Index evidence may associate the owning
definition or statically analyzed expression where available, but exact
character-level runtime source mapping is not a V1 guarantee.

Source-key inference for interpolated primitive input values remains
best-effort under the existing ambiguity rules. The API must not pretend that a
runtime string value proves which TypeScript expression produced it.

`.inspect()` and devtools expose, where applicable:

- exact resolved text;
- static/interpolated segment boundaries;
- prompt/context ownership;
- token counts; and
- existing freshness and cache provenance.

For system content, this continues through the existing segment-bearing
`InspectPart` and `ResolvedSystemContent` contracts. For user-prompt content,
V1 additively extends the existing inspection shape:

```ts
prompt:
  | {
      text: string;
      tokens: number;
      segments?: readonly ContextTextSegment[];
      staticTokens?: number;
      dynamicTokens?: number;
    }
  | undefined;
```

A nonempty `PromptText` user prompt includes segments and its token split. An
ordinary string retains the current `{ text, tokens }` shape without inferred
segments. `.resolve()` continues to expose only the provider-neutral prompt
string; segment detail belongs to inspection and observability.

When a provider adaptation prepends or appends user-prompt text, those authored
adaptation strings become static segments around the lowered `PromptText`
segments. They carry no interpolation source or freshness metadata. The final
inspection segments and token split therefore reconstruct and describe the
same post-adaptation prompt text returned by `.inspect()` and `.resolve()`.

## Security boundary

`md` performs composition only. It neither marks content trusted nor bypasses
Crux input handling.

The existing order remains:

1. schema validation;
2. configured sanitization;
3. configured automatic escaping and security diagnostics;
4. callback evaluation and `md` construction; and
5. resolver/model-ingress safety.

Interpolating sanitized `input.*` values therefore behaves like returning those
values from an ordinary string callback today. `md.json()` does not recursively
sanitize nested strings, and it does not alter the existing warning or
`rawFields` contracts.

There is no `md.raw`, `md.trusted`, or equivalent escape hatch in V1. Devtools
may later make input-derived segments visually prominent, but such presentation
does not replace the authoritative safety pipeline.

## Errors and diagnostics

Unsupported values fail close to authoring with stable codes:

| Code                                     | Condition                                                                                        | Suggested remedy                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `CRUX_PROMPT_TEXT_INVALID_INTERPOLATION` | Object, Promise, function, symbol, bigint, `true`, non-finite number, or other unsupported value | Select a scalar field, return a fragment, or use `md.json()` for JSON |
| `CRUX_PROMPT_TEXT_INLINE_SEQUENCE`       | An array is interpolated inline                                                                  | Move it to a block line or join scalar values with native `.join()`   |
| `CRUX_PROMPT_TEXT_JSON_SERIALIZATION`    | `md.json()` cannot produce JSON text                                                             | Remove cycles/bigint or serialize explicitly before interpolation     |

An interpolation error identifies its zero-based interpolation index and nested
array path. When resolution knows the prompt/context ID and field, it adds that
context without replacing the stable underlying code. Error formatting must not
serialize the entire rejected value or leak secrets. Safe-kind classification
does not execute user code; unsupported object-like values, including Promises,
are described as `object`.

TypeScript catches the common object, Promise, boolean, and unsupported-array
cases through the interpolation union. Runtime validation remains authoritative
for JavaScript, `any`, non-finite numbers, cyclic arrays, and position-dependent
sequence rules.

## Language-server follow-up boundary

The repository now contains the `crux lsp` server and VS Code extension shipped
by #274. The landed server attaches to or owns the save-based Project Index,
retains bounded incremental document buffers, transforms indexed ranges through
unsaved edits, and already sends cache-bypassing current-buffer queries to the
persistent Rust/Oxc compiler for completion.

The landed foundation does not own a TypeScript language service, a Markdown
virtual-document host, PromptText-specific folding or highlighting providers, or
a full dirty-buffer Project Index overlay. #266 remains the design boundary for
session-scoped unsaved graph and semantic evidence.

Core V1 supplies the contracts that future tooling consumes: import-resolvable
`md` syntax, stable interpolation/error rules, Project Index classification,
definition source ranges, exact `.inspect()` output, and renderer golden
fixtures. It does not add PromptText-specific LSP methods, editor providers, or
a workspace evaluation host. Those features remain the separate editor RFC
#271 so the runtime and index contracts can land without making editor support
load-bearing.

The follow-up must extend the existing server rather than create a second
process, parser service, or index. A request-only document-analysis query over
the current in-memory buffer is the preferred seam for syntax/ranges, folding,
and static preview, following the same privacy, cancellation, size, source-mode,
document-version, and index-generation rules as semantic completion. Saved
Project Index prompt-text evidence remains authoritative for ownership and
cross-file semantic identity.

The Crux server does not need to replace TypeScript intelligence inside
interpolations: the authored document remains TypeScript, so the editor's native
TypeScript provider stays authoritative there. Type-aware diagnostics or
unsaved re-export/graph recognition that Rust/Oxc cannot prove must wait for a
backend-neutral #266 overlay or another separately approved semantic boundary;
they must not be approximated from a tag's local spelling.

The editor follow-up should provide:

- Markdown highlighting and folding for literal regions;
- preservation of normal TypeScript navigation, completion, rename, and
  diagnostics inside interpolations;
- Crux diagnostics for unsupported interpolation types and inline sequences;
- a quick fix suggesting `md.json(value)` for an object interpolation;
- a safe static preview that renders known literal structure and labels unknown
  expressions as placeholders; and
- source navigation to the owning prompt, context, and locally resolvable named
  fragments.

It must recognize Crux's `md` by resolved symbol identity, including import
aliases; a local unrelated function named `md` must not receive Crux behavior.

Before selecting the highlighting transport, #271 must prove composition with
the editor's TypeScript highlighting. VS Code selects one best-matching
full-document semantic-token provider rather than merging providers, so a Crux
provider for TypeScript documents must not displace native TypeScript semantic
tokens. Cosmetic lexical highlighting and identity-sensitive Crux behavior may
use different layers, but any lexical fallback must document its alias and
false-positive limits.

The safe preview must never execute workspace modules, callbacks, getters, or
arbitrary user code. It may fold only syntax and values proven safe by static
analysis. Unknown values stay visibly unknown rather than being guessed.

Exact preview is explicit and comes from one of:

- user-supplied preview input through an explicit evaluation action;
- a normal `.inspect()`/resolution invocation; or
- the latest captured real run in devtools.

No future editor action may silently evaluate the workspace. Static and exact
previews must share golden fixtures with the runtime renderer so their
whitespace rules cannot drift.

Ordinary strings must retain existing editor support. A future conversion quick
fix for multiline strings must not imply that strings are deprecated.

## Project Index and cache identity

Project discovery must continue to classify prompts and contexts authored with
`md`, including aliased imports, consistently across the JavaScript TypeScript
semantic backend and the native backend. A direct `md` context system is static;
a callback returning `md` remains dynamic.

The implementation plan must keep static/source and semantic responsibilities
separate:

- the Rust/Oxc static frontend records tagged-template syntax and source ranges;
- semantic evidence resolves whether the tag is Crux's exported `md`; and
- downstream tooling consumes backend-neutral evidence rather than raw
  TypeScript or TypeScript-Go AST objects.

Static frontend parity compares each normalized `StaticSyntaxFileRecord.matches`
array in full, including match-local initializer evidence. Tagged-template
fixtures must not project away unrelated match fields merely to make the two
frontends agree, because those fields feed record-backed source resolution and
extension execution.

For the statements already supported by both frontends, the TypeScript
compatibility producer follows Rust/Oxc's existing match-local initializer
semantics: only variable initializers whose value starts before the match are
eligible; the nearest lexical scope and then the latest same-name initializer
wins; function declarations stay out of match-local initializer arrays; and an
enclosing variable initializer is visible to a nested match once its value has
started. Selected records retain Oxc's deterministic source order. This is a
normalization requirement for the existing syntax ABI, not permission to add a
new semantic pass or expand the supported statement set.

The static pass does not invent an owning-property source ref for a direct
inline tagged value such as `` prompt: md`Answer` ``. Existing owner refs remain
limited to symbol-resolvable identifiers/property accesses and callbacks, with
the same rule for `system` and `prompt`; tagged initializers reached through
those symbols retain their exact tag source and snippet. After semantic identity
is proven, the semantic pass emits the first canonical inline prompt-text ref.
For a named fragment, that prompt-text ref is additional to the existing
symbol-based owner ref rather than replacing it.

Phase 5 semantic evidence follows these bounded rules:

- `symbol` describes the exact named edge used to reach one tag. An outer tag
  reached through `fragment` or `fragments.answer` retains that spelling.
  Syntactically nested tags do not inherit it. A nested tag has a symbol only
  when it is independently reached through its own resolvable named fragment.
  If duplicate edges with different spellings resolve to the same ref, the
  earliest edge in source order supplies the retained symbol.
- Canonical prompt-text ref IDs include a readable, collision-resistant key for
  the tag's normalized project-relative source file before its one-based
  line/column. File position alone is insufficient because two imported
  fragments in different files can begin at the same coordinates.
- A named fragment must end at a `const` variable initializer. Transparent
  parentheses and TypeScript assertion/satisfaction wrappers are ignored. V1
  also accepts one non-computed property hop such as `fragments.answer` when
  `fragments` ends at a `const` object-literal initializer and `answer` is an
  own data-property assignment initialized directly by the tag. This is a
  stable source-authoring anchor, not a claim that the object is frozen or that
  runtime mutation is impossible. `let`, `var`, destructuring, getters,
  methods, spreads, shorthand indirection, computed members, and deeper
  property chains are not named-fragment evidence.
- Tag identity is proven against the canonical value export, not a name or
  module-specifier string. Each backend resolves the tag-site binding, follows
  compiler-resolved ECMAScript import/export and namespace alias edges with a
  cycle guard, resolves the exact package root `@use-crux/core`, canonicalizes
  that module's `md` export through its internal re-exports, and compares the
  terminal symbol/declaration identity. Unresolved modules and ordinary value
  aliases such as `const text = md` fail closed.
- Callback analysis accepts concise arrow bodies and every `return` expression
  syntactically owned by the callback, including returns nested in `if`/`else`,
  loops, `switch`, and `try` blocks. It never descends into a nested function or
  class body. Conditional expressions are split recursively into both result
  branches. The returned expression must itself be a proven tag or named
  fragment after transparent wrappers, or a conditional composed from those
  forms; helper-call results and tags merely mentioned elsewhere are not
  inferred.
- The TypeScript-Go direct projector is the common same-file fast path. It must
  directly cover exact-root named, aliased, and namespace imports; inline field
  tags; local direct-`const` and one-hop object-member fragments; concise,
  top-level block, nested `if`/`else`, and conditional-expression callback
  returns; returned local named fragments; and nested tags. Cross-file fragment
  resolution, local/package re-export chains, and other accepted control-flow
  shapes may use the complete shared analyzer. If any prompt-text candidate in
  a file falls outside the direct matrix, direct projection emits no facts for
  that file and the entire source file goes through the shared analyzer. The
  two paths may never contribute partial prompt-text evidence for the same
  file. A file containing only provably non-Crux tags may remain direct; an
  unresolved identity falls back.

If implementation changes Project Index output for unchanged source, it must
update every affected cache identity in the same change:

- `STATIC_PARSE_CACHE_EPOCH` for changed static syntax/extractor output;
- `SEMANTIC_FACTS_CACHE_EPOCH` or `SEMANTIC_COMPILER_OPTIONS_ID` for changed
  semantic output/meaning; and
- `ProjectIndexSnapshotCacheEpoch` for changed Go-owned snapshot shape or load
  semantics.

Any semantic recognition or fact change requires JavaScript/native backend
parity fixtures. Users must never be instructed to delete `.crux/cache`.

## Non-goals

V1 does not include:

- a whole prompt/configuration DSL;
- standalone prompt files;
- a precompiler, Babel/TypeScript transform, or build plugin;
- TSX or XML-style semantic tags;
- Jinja/Handlebars-style loops, conditions, filters, or macros;
- includes or a fragment registry;
- `md.join` or custom separators for fragment arrays;
- `md.use` or context-placement nodes;
- message, role, image, audio, or other multimodal construction;
- PromptText-specific language-server/editor features or TypeScript service
  integration;
- asynchronous interpolation;
- raw/trusted/safe escape hatches;
- semantic section tags or token-priority markup;
- Markdown parsing, validation, or HTML rendering; or
- public access to the internal `PromptText` node representation.

Deeply nested inline fragments are also discouraged rather than given new
syntax. The documented TypeScript-native escape valve is to extract a named
fragment or helper function.

## Testing and acceptance criteria

### Runtime and types

- Golden tests cover dedent, outer trim, interpolation-only templates, nested
  indentation, inline multiline values, multiple interpolations on one line,
  empty-block seams, adjacent omissions, empty/omitted sequence items,
  sequences, fenced examples, tabs, and ordinary-string preservation.
- Type tests accept every documented value and reject arbitrary objects,
  Promises, general booleans, and unsupported callback results.
- Canonical `Message` and `MessageContent` type tests reject `PromptText`, while
  the deliberately permissive `AnyMessage[]` prompt callback remains unchanged.
- Mutation tests prove arrays and `md.json()` values are snapshotted.
- Error tests pin codes, interpolation paths, safe value descriptions, and
  remedies, including trap-free `object` classification for native Promises and
  hostile or revoked Proxies.
- Representative conditional and mapped examples remain readable after the
  repository's stock Prettier configuration; public examples require neither a
  formatter plugin nor `prettier-ignore`.
- Static and async-outer-callback tests cover prompt system, user prompt, and
  context system fields.
- Resolver integration tests prove lowering occurs before composition,
  budgeting, memo storage, provider-cache grouping, and adaptations.
- Adapter conformance tests prove provider packages continue to receive their
  existing string/provider-neutral contracts.

### Provenance and safety

- Segment tests cover literal, scalar, JSON, nested-fragment, and sequence
  boundaries after whitespace normalization.
- Token attribution is recomputed with the active tokenizer on context memo
  hits, preserving the existing cache contract.
- Sanitization and auto-escape tests prove `md` neither bypasses nor duplicates
  the current input pipeline.
- Tests prove diagnostic formatting does not stringify rejected secrets.

### Tooling

- Project Index fixtures cover direct and aliased imports, unrelated local `md`
  tags, source ranges, static/dynamic context classification, independent
  nested symbols, strict-`const` named fragments, one-hop object members,
  compiler-proven re-exports, every accepted callback-return form, and the
  direct-versus-shared native boundary.
- JavaScript/native semantic parity tests cover any new Project Index evidence.
- Cache migration tests prove old snapshots are missed automatically when an
  identity bump is required.
- Renderer fixtures are structured so the follow-up language-server design can
  reuse them instead of defining a second whitespace evaluator.

### Compatibility

- Existing string fixtures remain byte-identical.
- Existing context ordering, omission, budgets, caches, and provider adaptation
  fixtures remain unchanged.
- Existing `messages` behavior remains unchanged.
- Legacy/project metadata serializers do not expose `[object Object]` or private
  `PromptText` nodes when encountering the new public value.

## Release and documentation

This is new public behavior in `@use-crux/core` and requires a minor changeset at
implementation time. Before adding one, implementation must inspect pending
changesets and extend a relevant release-theme file when one already exists.

Public documentation leads with one small example, then explains:

1. strings remain supported;
2. `md` is Markdown-oriented text composition, not a Markdown renderer;
3. block versus inline interpolation;
4. conditional and mapped fragments;
5. explicit object serialization with `md.json()`;
6. extraction of named fragments before nesting becomes noisy; and
7. the fact that `use: []` placement is unchanged.

The API should not be described as a new language. It is an optional structured
text value built with standard tagged-template syntax.

## Success and kill criteria

The feature succeeds when developers can write realistic conditional and
repeated prompts more clearly than with ordinary string concatenation, while a
reader or coding agent can predict the resolved layout from source alone.

Before stabilization, redesign or remove the feature if:

- common whitespace output is surprising without constantly opening preview;
- runtime behavior requires a compiler transform;
- ordinary strings become second-class or behave differently;
- nested tag punctuation routinely overwhelms the prompt prose;
- users begin recreating filters, macros, or control flow inside `md`; or
- future tooling would need a second rendering contract rather than consuming
  the runtime's rules and fixtures.

Only demonstrated demand should reopen deferred helpers or context placement.
