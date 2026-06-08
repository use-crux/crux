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
extensions: [
  {
    package: '@acme/crux-indexer',
    export: 'default',
    version: '^1.0.0',
    options: {},
  },
]
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

Cache identity should include compiler/profile/schema/parser/extension/intrinsic versions. Rule-only
changes should not force syntax reparsing unless they affect extraction dependencies.

The production readiness bar for public loading includes package typecheck/tests, devtools worker
build, CLI embed/build, real `crux dev` and `crux eval` smoke tests, source resolver worker smoke
tests, cold/warm cache timing reports, and representative fixture projects.
