# Compiler Profiles Before Public Extension Loading

`@use-crux/indexer` will use compiler profiles to assemble first-party Crux Indexer Extensions,
compiler-owned projections, and Extension Runtime instances before adding public third-party extension
loading.

**Context**

The Project Index Compiler already had an experimental extension boundary with extractors, relation
specs, reserved rule/resolver/emitter slots, and a functional Extension Runtime. The remaining risk
was that production code still depended on adjacent singleton values and hidden parser special cases:
static parsing, full compilation, and incremental AST partial execution could each choose extension
state differently. Public package wildcard exports also made internal compiler modules importable.

**Decision**

Introduce a Compiler Profile as the compiler-owned assembly unit for first-party extensions and
compiler-owned projections. `createProjectIndexCompiler(...)` creates an isolated compiler instance from a profile
and constructs the Extension Runtime for that instance. The default profile is
`cruxCoreCompilerProfile`.

Compiler-owned behavior that is not public extension authoring API is declared as a Compiler
Intrinsic. The default profile currently declares Convex agent extraction, Agent constructor
compatibility, runtime prepare use-entry projection, and prompt/context tree path projection.
Intrinsics are explicit implementation records, not parser plugins.

Index rules now require metadata before they can run. Rule metadata includes docs, option schema,
messages, and default options. Registry construction validates rule declarations so malformed rules
fail before source discovery begins.

The package export map is intentionally narrow. `@use-crux/indexer` exports the stable indexing
entry points, `@use-crux/indexer/extensions` exports the experimental extractor authoring surface,
and `@use-crux/indexer/source-resolver` exports the source resolver facade. Internal `indexer/*`
modules are not package exports.

**Consequences**

Compiler runs can be tested with different extension sets without mutating process-global state.
Static cache identity now comes from the parser/runtime cache inputs rather than a global first-party
extension list.

Degraded extractor diagnostics and source-file dependency declarations are preserved through static
parse results, discovery diagnostics, and source rows. The static parse cache version was bumped
because the cached parse result shape changed.

Public third-party loading remains deliberately unsupported. Before public loading, Crux still needs
a loading/configuration model, trust and sandboxing decisions, extension version compatibility
checks, relation namespace policy, and author-facing docs. Until then, custom rules, resolvers,
emitters, sources, parsers, compiler profiles, compiler-owned projections, and runtime construction remain
internal.
