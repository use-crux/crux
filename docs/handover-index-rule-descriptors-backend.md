# Backend Handover: Index Rule Descriptors

This handover records the backend/read-model work that exposes lint rule metadata from the Crux indexer. It deliberately does not cover UI rendering. The goal is to give devtools and other consumers enough structured data to explain available rules, fired findings, suppression support, fix affordances, and extension-provided rules without hard-coding rule knowledge outside the compiler/indexer layer.

## Goal

Expose a stable `ruleDescriptors` alongside Project Index snapshots.

Rule descriptors are rule metadata. They exist even when a rule has no findings. Concrete findings stay in `lintFindings`.

This split keeps the compiler/indexer responsible for rule semantics and lets devtools/backend consumers treat rule information as data.

## Current State

Concrete lint findings are already rich. The core type is `IndexLintFinding` in:

- `packages/core/project-index/index.ts`

Important existing fields include:

- `id`
- `severity`
- `ruleId`
- `category`
- `maturity`
- `confidence`
- `profiles`
- `title`
- `message`
- `rationale`
- `impact`
- `source`
- `primaryDefinitionId`
- `relatedDefinitionIds`
- `affectedDefinitionIds`
- `evidence`
- `fixes`
- `docsUrl`
- `suppression`
- `suppressed`
- `suppressedBy`
- `propagatedDefinitionIds`
- `propagationPaths`

Project snapshots include:

- `lintFindings: IndexLintFinding[]`
- `ruleDescriptors: IndexRuleDescriptor[]`

The TypeScript compiler path, core schema/serializers, AST patches, Go API/store mirrors, and local
patch application now preserve `ruleDescriptors`.

## Where Rule Metadata Lives Today

Built-in rule metadata lives in:

- `packages/indexer/indexer/index-lint-rules.ts`

Important exports:

- `indexLintRuleIds`
- `indexLintRules`
- `knownIndexLintRuleId(value)`
- `indexLintFinding(input)`

`indexLintRules` currently contains the canonical built-in metadata for each rule:

- `id`
- `severity`
- `category`
- `maturity`
- `confidence`
- `profiles`
- `title`
- `rationale`
- `impact`
- `docsSlug`
- `fixes`
- `suppression`

The helper `indexLintFinding(input)` copies that metadata into every concrete finding and builds docs/suppression fix data.

The built-in lint adapter lives in:

- `packages/indexer/indexer/index-lint-extension.ts`

It exposes one indexer extension rule:

- `cruxIndexLintRule`
- `name: "crux.index-lints"`

This adapter calls `indexLintFindings({ definitions, relations })` and emits all built-in findings.

Do not expose only `crux.index-lints` as the descriptor entry for built-ins. The descriptor list must expose the individual built-in rules from `indexLintRules`.

Extension rule metadata is defined by the extension API in:

- `packages/indexer/indexer/extensions/types.ts`

Relevant shapes:

- `IndexerExtension.rules?: readonly IndexRule[]`
- `IndexRule`
- `IndexRuleMeta`

Extension rules have:

- `name`
- `meta`
- `requires?`
- `check(ctx)`

Their metadata is converted into rule descriptor entries.

## Backend Transport To Update

Project index snapshot and serializer types:

- `packages/core/project-index/index.ts`
- `packages/core/project-index/serializers.ts`

Indexer emitters and compiler/read-model construction:

- `packages/indexer/indexer/compiler/index.ts`
- `packages/indexer/indexer/index.ts`
- `packages/indexer/indexer/patches.ts`

Extension runtime/registry paths to inspect:

- `packages/indexer/indexer/extensions/runtime.ts`
- `packages/indexer/indexer/extensions/registry.ts`
- `packages/indexer/indexer/extensions/types.ts`

Local server Go mirrors:

- `packages/local/internal/store/types.go`
- `packages/local/internal/api/types.go`

If index patches explicitly mirror fields, also inspect:

- `packages/local/internal/devtools/index_patch.go`

The Go server mostly passes JSON through existing API/store structs. Add the new field wherever `IndexData` or project index snapshot structs are mirrored.

## Public Data Shape

Add a core project-index type similar to:

```ts
export interface IndexRuleDescriptor {
  id: string
  source: "builtin" | "extension"
  extension?: {
    name: string
    version?: string
  }
  severity?: IndexLintFinding["severity"]
  category?: CruxLintCategory
  maturity?: CruxLintMaturity
  confidence?: CruxLintConfidence
  profiles?: readonly CruxLintProfile[]
  title: string
  description: string
  rationale?: string
  impact?: string
  docsUrl?: string
  fixes?: readonly IndexLintFix[]
  suppression?: {
    supported: boolean
    scope: "next-line" | "line" | "file"
    directive?: string
  }
  requires?: readonly AnalysisTier[]
  optionSchema?: unknown
  messageIds?: readonly string[]
  defaultOptions?: unknown
}
```

Recommended snapshot field:

```ts
export interface ProjectIndexSnapshot {
  // existing fields...
  lintFindings: readonly IndexLintFinding[]
  ruleDescriptors: readonly IndexRuleDescriptor[]
}
```

Prefer `ruleDescriptors` over `rules` to avoid confusion with configuration such as `lint.rules`.

Use `IndexRuleDescriptor` unless the surrounding code strongly suggests `ProjectIndexRuleDescriptor`.

## Mapping Built-In Rules

Create a pure mapper near the built-in rule metadata, likely in:

- `packages/indexer/indexer/index-lint-rules.ts`

Suggested export:

```ts
export const builtInIndexRuleDescriptors = (): readonly IndexRuleDescriptor[] =>
  Object.values(indexLintRules).map((rule) => ({
    id: rule.id,
    source: "builtin",
    severity: rule.severity,
    category: rule.category,
    maturity: rule.maturity,
    confidence: rule.confidence,
    profiles: rule.profiles,
    title: rule.title,
    description: rule.rationale,
    rationale: rule.rationale,
    impact: rule.impact,
    docsUrl: `/docs/reference/crux-core/index-lints/${rule.docsSlug}`,
    fixes: rule.fixes,
    suppression: {
      supported: rule.suppression.supported,
      scope: rule.suppression.scope,
      directive: `// crux-lint-disable-next-line ${rule.id} -- reason`,
    },
  }))
```

If a separate `description` field is later added to built-in `IndexLintRule`, map `description` from that field and keep `rationale` distinct.

## Mapping Extension Rules

The pure mapper lives in the extension runtime layer:

- `packages/indexer/indexer/extensions/runtime.ts`

The mapper inspects registered `IndexerExtension` objects and collects their `rules`.

Current behavior:

- `id`: `rule.name`
- `source`: `"extension"`
- `extension.name`: extension/package name from the extension manifest/registration object
- `extension.version`: extension version when available
- `title`: `rule.meta.docs.title` if present, otherwise `rule.name`
- `description`: `rule.meta.docs.description` if present, otherwise `rule.name`
- `docsUrl`: `rule.meta.docs.url` if present
- `optionSchema`: `rule.meta.schema` if present
- `messageIds`: `Object.keys(rule.meta.messages ?? {})`
- `defaultOptions`: `rule.meta.defaultOptions` if present
- `requires`: `rule.requires` if present

Only include metadata that exists in the extension API. Do not infer severity/category/maturity/confidence for third-party rules unless the extension API explicitly provides them.

If third-party lint rules need those fields long term, evolve `IndexRuleMeta` intentionally instead of adding side channels.

## Emission Path

`ruleDescriptors` is part of the core snapshot model:

- `packages/core/project-index/index.ts`

Implemented there:

- Add `IndexRuleDescriptor`
- Add a Zod schema for `IndexRuleDescriptor`
- Add `ruleDescriptors` to `ProjectIndexSnapshot`
- Add `ruleDescriptors` to `ProjectIndexSnapshotSchema`
- Update `serializeProjectIndex(...)`
- Default absent descriptor data to `[]` when reading older fixtures or stored snapshots

It is threaded through:

- compiler/index construction in `packages/indexer/indexer/compiler/index.ts`
- public indexer entrypoints in `packages/indexer/indexer/index.ts`
- patch/read-model code in `packages/indexer/indexer/patches.ts` if snapshots/patches are explicit
- serializers in `packages/core/project-index/serializers.ts`

The emitted descriptor list combines:

1. Built-in entries from `builtInIndexRuleDescriptors()`
2. Extension entries from registered extension rules

Keep the function composition pure:

```ts
const ruleDescriptors = [
  ...builtInIndexRuleDescriptors(),
  ...extensionRuleDescriptors(extensionRuntime),
]
```

Duplicate rule IDs fail deterministically at extension registry/runtime construction or compiler descriptor assembly. The compiler must not silently overwrite with object spreading.

## Go Mirror Shape

Mirror structs live in:

- `packages/local/internal/store/types.go`
- `packages/local/internal/api/types.go`

The field is:

```go
RuleDescriptors []IndexRuleDescriptor `json:"ruleDescriptors,omitempty"`
```

Keep optional fields as pointers or `omitempty` fields in the same style as existing structs.

For schemas like `optionSchema` and `defaultOptions`, use a JSON-compatible type already used in the package, or `map[string]any` / `any` if that is the existing local convention.

## Verified Coverage

Core schema tests:

- `ProjectIndexSnapshotSchema` accepts `ruleDescriptors`
- missing `ruleDescriptors` is normalized to `[]` if older stored snapshots are supported

Indexer tests:

- built-in descriptors contain `prompt.missing_input_schema`
- built-in entry has severity/category/profiles/suppression
- built-in entry docs URL is `/docs/reference/crux-core/index-lints/prompt-missing-input-schema`
- descriptors are emitted even when no findings fire

Extension runtime tests:

- custom extension rule appears in `ruleDescriptors`
- custom entry includes extension identity
- `requires`, docs URL, option schema, message IDs, and default options survive mapping
- duplicate rule IDs are handled deterministically

Local Go tests:

- JSON unmarshal/marshal preserves `ruleDescriptors`
- API/store mirror structs include the field

## Non-Goals

Do not implement UI rendering in this work.

Do not implement third-party package loading, sandboxing, trust policy, or marketplace behavior.

Do not change lint semantics.

Do not make devtools hard-code built-in rule knowledge.

Do not expose compiler-internal adapter rules such as `crux.index-lints` as the only built-in rule.

## Implemented Order

1. Add core `IndexRuleDescriptor` type and schema.
2. Add built-in descriptor mapper from `indexLintRules`.
3. Add extension descriptor mapper from registered `IndexerExtension.rules`.
4. Thread `ruleDescriptors` through snapshot construction and serialization.
5. Add Go API/store mirror fields.
6. Add tests for core schema, built-in descriptors, extension descriptors, and Go JSON.
7. Update package/internal docs after code changes.

## Documentation Updated

Package/internal docs:

- `packages/core/ARCHITECTURE.md`
- `packages/indexer/ARCHITECTURE.md`
- `packages/indexer/README.md`

Public docs:

- `apps/docs/content/docs/reference/indexer.mdx`
- `apps/docs/content/docs/reference/core.mdx` if new public core exports are added

Repository guidance if naming/export contracts change:

- root `AGENTS.md`

Keep the docs clear that findings are concrete occurrences and `ruleDescriptors` is available-rule metadata.
