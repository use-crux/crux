# Extension Loading, Trust, And Compatibility

Status: Accepted
Date: 2026-06-08

Public Indexer extension loading must be deterministic, explicit, and honest about trust. Importing a
package in Node is code execution, not a sandbox. Crux should not promise safety it does not enforce.

**Decision**

Extension loading is config-driven and deterministic. There is no global registration and no magic
import side effect contract.

Target config shape:

```ts
defineConfig({
  indexer: {
    extensions: [
      {
        package: '@acme/crux-indexer',
        export: 'default',
        version: '^1.0.0',
        options: {},
      },
    ],
    trust: {
      mode: 'allowlisted',
      allow: ['@acme/crux-indexer'],
    },
  },
})
```

Each extension declares compatibility:

```ts
interface IndexerCompatibility {
  indexer: string
  projectIndexSchema?: number
}
```

Example:

```ts
crux: {
  indexer: '^0.2.0',
  projectIndexSchema: 1,
}
```

Incompatible extensions fail before indexing starts.

Use explicit trust modes:

```ts
type ExtensionTrustMode = 'first-party-only' | 'allowlisted' | 'unsafe-local-dev'
```

Default to `first-party-only`. Public third-party loading requires an allowlist or explicit
`unsafe-local-dev`.

**Consequences**

The loader normalizes extension manifests, validates compatibility, applies trust policy, and then
hands plain extension declarations to the compiler profile/runtime boundary. The compiler still owns
execution ordering, diagnostics policy, graph projection, and cache identity.

The implementation has two gates:

- `resolveIndexerExtensionReferences(...)` is pure. It accepts already-known manifests, normalizes
  references, applies trust policy, validates manifests, checks requested package versions, checks
  `crux.indexer`/Project Index schema compatibility, and returns diagnostics.
- `loadIndexerExtensionReferences(...)` is effectful. It preflights trust by configured package name
  before import, resolves package entries from the project root, reads installed package versions from
  package metadata, imports the selected package export, and delegates accepted manifests to the pure
  gate.

Dynamic loading is therefore available only through explicit config plus `allowlisted` or
`unsafe-local-dev` trust. It is not a sandbox: a package that passes preflight trust is trusted
JavaScript code. Stronger isolation would need a separate process/worker policy and a dedicated
sandbox ADR.

ADR 0009 narrows the role of this config: extension loading config is trust and code-execution
policy, not primitive registration. Local tooling should still discover authored prompts, contexts,
tools, and relationships from source when possible.

Cache identity should include compiler/profile/schema/parser/extension/intrinsic versions. Rule-only
changes should not force syntax reparsing unless they affect extraction dependencies.

The production readiness bar for public loading includes package typecheck/tests, fixture extension
package tests, local worker build, CLI embed/build, real `crux dev` and `crux eval run` smoke tests,
source resolver worker smoke tests, cold/warm cache timing reports, and representative fixture
projects.
