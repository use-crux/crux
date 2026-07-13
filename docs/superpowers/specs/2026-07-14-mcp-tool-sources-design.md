# RFC: MCP tool sources

Status: **proposed**

Related: [#166](https://github.com/use-crux/crux/issues/166), tool middleware,
Safety, Quality, canonical observability, Project Index, and Devtools Catalog.

## Summary

Crux should treat a Model Context Protocol server as a first-class, portable
tool source. An authored `mcp()` value composes through a prompt or context's
`use` array. At execution time the selected adapter connects to the server,
discovers its tools, and materializes them before Crux creates the ordinary tool
lifecycle.

The selected adapter delegates to its underlying SDK when that SDK already owns
MCP client behavior. `@use-crux/ai` uses `@ai-sdk/mcp`. The OpenAI, Anthropic,
and Google core-step adapters use one shared implementation in
`@use-crux/mcp`, backed by the official MCP TypeScript client. Both paths must
pass the same behavioral conformance suite.

Materialized MCP tools are normal Crux tools at the policy boundary. Tool
middleware, approval, Safety tool policies, timeouts, cancellation,
observability, Quality, and tool mocks apply without an MCP-specific execution
path. MCP servers and discovered tools also become canonical Project Index
definitions with detailed Run and Catalog presentation.

The initial release supports stdio and Streamable HTTP. It does not implement an
MCP server, provider-executed remote MCP, resources, prompts, sampling,
elicitation, tasks, or persistent application-scoped connections.

## Goals

- Let one MCP declaration work with every first-party Crux model adapter.
- Delegate connection, discovery, and tool conversion to an adapter SDK when it
  already provides those semantics.
- Preserve one Crux policy and evidence path for authored and MCP tools.
- Make connection, discovery, calls, failures, and approvals fully visible in
  Runs.
- Index the authored server and its discovered tools with exact runtime-to-
  Catalog joins.
- Keep `@use-crux/core` provider- and MCP-agnostic.
- Fail closed on ambiguous discovery, schema, collision, and approval-resume
  conditions.

## Non-goals

- Acting as an MCP server.
- Provider-hosted remote MCP execution in the OpenAI or Anthropic API. That
  moves execution and policy into the provider and is not semantically
  equivalent to this client-side tool source.
- MCP resources as Workspace mounts. The `WorkspaceCustomMountSource` contract
  already supports a later resource adapter.
- MCP prompts, sampling, elicitation, tasks, roots, or server installation.
- Automatic discovery of desktop/IDE MCP configuration files.
- A persistent connection pool or application-scoped client lifecycle.
- Static TypeScript inference from schemas that exist only on a remote server.
- A second MCP-specific Quality cassette system.

## Terminology

### MCP server

The authored, portable `mcp()` definition. Its canonical Project Index identity
is `mcp.server:<safeId(id)>`.

### Remote tool name

The exact name advertised by the MCP server.

### Exposed tool name

The name made available to the model after an optional prefix. Existing Crux
middleware, approval, policy matching, Quality mocks, and runtime tool identity
use this name.

### Tool source

A provider-neutral Core contract that can be materialized by an execution
dialect into a bounded session containing executable tools.

### Tool source session

The tools and cleanup handle created for one Crux `generate()` or `stream()`
invocation.

## Public API

The canonical package is `@use-crux/mcp`:

```ts
import { mcp, stdio } from '@use-crux/mcp'
import { prompt } from '@use-crux/core'

const github = mcp({
  id: 'github',
  transport: stdio({
    command: 'npx',
    args: ['@modelcontextprotocol/server-github'],
  }),
  tools: {
    allow: ['get_issue', 'create_issue'],
  },
})

export const assistant = prompt({
  id: 'github-assistant',
  system: 'Help manage GitHub issues.',
  use: [github],
})
```

Streamable HTTP uses the same source:

```ts
import { mcp, streamableHttp } from '@use-crux/mcp'

const linear = mcp({
  id: 'linear',
  transport: streamableHttp({
    url: 'https://mcp.linear.app/mcp',
    headers: {
      Authorization: `Bearer ${process.env.LINEAR_TOKEN}`,
    },
  }),
})
```

The transport may be resolved per invocation so credentials can come from
typed runtime context without rebuilding the prompt:

```ts
const linear = mcp<{ accessToken: string }>({
  id: 'linear',
  transport: ({ runtimeContext }) =>
    streamableHttp({
      url: 'https://mcp.linear.app/mcp',
      headers: {
        Authorization: `Bearer ${runtimeContext.accessToken}`,
      },
    }),
})
```

### Proposed configuration

```ts
type Awaitable<T> = T | PromiseLike<T>

interface McpConfig<TRuntimeContext = unknown> {
  readonly id: string
  readonly transport:
    | McpTransportConfig
    | ((context: {
        readonly runtimeContext: TRuntimeContext
        readonly abortSignal?: AbortSignal
      }) => Awaitable<McpTransportConfig>)
  readonly tools?: McpToolSelection
}

interface McpToolSelection {
  /** Exact remote names to expose. Mutually exclusive with deny. */
  readonly allow?: readonly string[]
  /** Exact remote names to omit. Mutually exclusive with allow. */
  readonly deny?: readonly string[]
  /** Prepended to remote names before ordinary Crux collision checks. */
  readonly prefix?: string
}

interface McpStdioTransportConfig {
  readonly type: 'stdio'
  readonly command: string
  readonly args?: readonly string[]
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
}

interface McpStreamableHttpTransportConfig {
  readonly type: 'streamable-http'
  readonly url: string | URL
  readonly headers?: Readonly<Record<string, string>>
  /** Defaults to error to avoid credential-bearing cross-origin redirects. */
  readonly redirect?: 'error' | 'follow'
}
```

`mcp()` validates a non-empty ID and mutually exclusive filters, returns a
frozen definition, and performs no I/O. Transport helpers return inert frozen
configuration. OAuth-specific client types are not exposed in v1; applications
may supply bearer credentials through static or runtime-resolved headers.

Tool names remain unchanged by default. Crux never silently renames a tool.
Normal collision errors identify both source owners and recommend an explicit
prefix.

## Core tool-source boundary

Core gains a small generic contract under `@use-crux/core/tools`:

```ts
interface ToolSource {
  readonly id: string
  readonly kind: string
}

interface ToolSourceSession {
  readonly tools: Readonly<Record<string, unknown>>
  close(): void | Promise<void>
}
```

The concrete internal materialization result also carries source provenance,
schema fingerprints, and runtime facts. The authored source carries only inert
configuration and identity; it does not smuggle an executable MCP client into
Core.

`Contribution` and `ResolvedPrompt` gain a `toolSources` channel. A tool source
is a valid `ContextEntry`, so `mcp()` works in a prompt or nested context's
`use` array and follows existing conditional contribution and collision
semantics.

Resolving this entry never opens an MCP network connection or spawns a process.
It returns an unresolved source and records its authored contribution. (Other
contributor kinds retain their existing resolution semantics.) The adapter
execution layer materializes sources after prompt resolution and input Safety,
but before cache lookup, provider I/O, or `createToolLifecycle()`.

Core does not import MCP or any provider SDK. Its execution dialect exposes a
generic materialization port keyed by source kind. Provider runtime packages
supply that port: `@use-crux/ai` implements `mcp` through `@ai-sdk/mcp`, while
the core-step provider packages delegate their `mcp` case to the shared export
from `@use-crux/mcp`. Unsupported custom execution dialects fail with a clear
`TOOL_SOURCE_UNSUPPORTED` error naming the source kind and dialect.

The resulting dependency direction is:

```text
@use-crux/mcp -> @use-crux/core
@use-crux/ai -> @use-crux/mcp + @use-crux/core
core-step provider packages -> @use-crux/mcp + @use-crux/core
```

`@use-crux/core` never depends on `@use-crux/mcp`. MCP and provider SDK
versions remain outside Core and follow the repository's peer-dependency rules
where consumers are expected to control them.

## Adapter delegation

### AI SDK

`@use-crux/ai` uses `createMCPClient()` from `@ai-sdk/mcp`, calls
`client.tools()`, and keeps the resulting AI SDK-native tool representation.
"Native" is limited to MCP connection, discovery, schema conversion, execution,
and model-output conversion. It is not permission to bypass Crux policy.

The native tool map is handed to the existing structural SDK-regime
`createToolLifecycle()` exactly like authored AI SDK tools. Core applies tool
middleware, Safety argument/result policy, approvals, execution options,
instrumentation, definition references, and active-tool filtering before the
AI SDK sees the tools. `@use-crux/ai` must not pass the raw `client.tools()` map
directly to `generateText()` or `streamText()`.

The integration delegates model-facing MCP result conversion to the AI SDK
where it already owns that behavior, while Crux retains the application-facing
result and canonical evidence needed for behavioral parity. The MCP client
closes when the Crux invocation finishes.

### Core-step adapters

OpenAI, Anthropic, and Google use one shared materializer in `@use-crux/mcp`
backed by the official MCP TypeScript client:

1. Connect using stdio or Streamable HTTP.
2. Collect every paginated `tools/list` page within a bounded page limit.
3. Filter and name the tools.
4. Convert input JSON Schema to Zod runtime validation without `any`.
5. Produce ordinary `ToolDef<Record<string, unknown>, McpToolResult>` values.
6. Execute with `client.callTool()` and the active Crux abort signal.
7. Convert the result through canonical `ToolModelOutput`.
8. Close the client on completion, failure, cancellation, or suspension.

Provider SDK versions remain peer-controlled. MCP implementation code must be
tree-shakeable/lazily loaded so applications that do not author an MCP source do
not open transports or initialize MCP clients.

### Behavioral parity

The public promise is that MCP tools behave as standard Crux tools. Dialects do
not need identical private tool objects. A shared conformance suite verifies
the observable contract across the AI SDK materializer and official-client
materializer.

## Execution lifecycle

One source session is created lazily for each Crux invocation. Its connection
is reused for discovery and every tool call in that invocation, then closed:

```text
prompt.resolve
  -> materialize tool sources
  -> connect
  -> discover/filter/name/validate
  -> merge with authored and call-site tools
  -> create ToolLifecycle
  -> model/tool loop
  -> close source sessions in reverse order
```

Materialization failures occur before the model request. V1 does not silently
drop an unavailable source. If several sources were opened before a later one
fails, already-opened sessions close in reverse order.

For streaming, cleanup is attached to terminal completion, failure,
cancellation, and consumer disposal. Cleanup is idempotent and bounded; cleanup
failure is recorded but does not replace an earlier primary error.

Each invocation performs fresh discovery. Tool-list-change notifications and
long-lived refresh state are unnecessary in this lifecycle.

## Discovery, schemas, and naming

- `allow` and `deny` apply to exact remote names before prefixing.
- Supplying both is a definition-time error.
- Documentation recommends an allowlist for production so a server cannot add
  newly model-visible tools without application review.
- Invalid names, duplicate exposed names, invalid JSON Schema, unsupported
  schema constructs, or collisions with another prompt-time owner fail closed.
- Call-site tools retain the existing intentional final-word override.
- Dynamically discovered input is typed as `Record<string, unknown>` at compile
  time and validated precisely at runtime. It is never `any`.
- Input is validated before it crosses the MCP transport.
- Advertised output schemas validate `structuredContent`; mismatches become
  tool execution errors.
- Stable canonical JSON fingerprints identify input schema, output schema, and
  the exposed tool-list projection.

An authored schema map for compile-time direct tool invocation is deferred. It
may later mirror the AI SDK's schema-definition mode without changing the
source or lifecycle contract.

## Result mapping

The application-facing fallback result preserves the MCP result:

```ts
interface McpToolResult {
  readonly content: readonly McpContent[]
  readonly structuredContent?: JsonValue
  readonly isError?: boolean
}
```

Model-facing conversion follows MCP semantics:

- Ordered text, image, and audio content maps to canonical Crux content parts.
- Embedded text resources retain their URI as attribution alongside content.
- Embedded binary resources map to bounded canonical file/media parts.
- Resource links remain attributed links and are never fetched implicitly.
- `structuredContent` remains available to application code and validation. It
  becomes model-facing JSON only when normal content is empty.
- `_meta` is retained only where required for protocol continuity. It is not
  sent to the model, persisted in Quality artifacts, or treated as trusted
  policy input.
- `isError: true` becomes a model-visible tool execution error so the model may
  correct its call.
- JSON-RPC, transport, timeout, and protocol errors throw through the ordinary
  Crux tool error path.

All binary projection obeys the existing capture policy and bounded media
descriptor rules. Raw base64 never enters ordinary text previews or traces.

## Composition, middleware, and Safety

Materialization completes before the ordinary tool lifecycle, so MCP tools
fully inherit:

- Prompt- and call-level `toolMiddleware()` ordering.
- `approvalMiddleware()` and declarative `toolApproval`.
- `toolPolicy()` allow, block, report, and approval decisions.
- `toolPolicy.args()` validation, blocking, and input rewriting before the
  transport call.
- `toolPolicy.result()` validation, blocking, and result rewriting before the
  result returns to the model.
- Per-tool and total timeout budgets.
- Abort propagation.
- Tool memory capture and normal model-facing output conversion.

Input/output guardrails still protect the overall generation. Constraints
still evaluate guarded model-output candidates and may retry the model after an
MCP-assisted attempt. Tool arguments and results use tool policies rather than
model-output constraints.

MCP annotations such as `readOnlyHint`, `destructiveHint`, `idempotentHint`,
and `openWorldHint` are retained for inspection. They are untrusted hints and
never automatically permit execution, bypass approval, or weaken Safety.

Policy matchers use the final exposed name. Catalog and Run UI always show both
remote and exposed names when they differ.

## Approval resumption

Suspending for approval ends the current invocation and closes its source
session. A resumed invocation reconnects and rediscovers before executing the
approved call.

The approval identity must bind:

- MCP server ID.
- Remote and exposed tool names.
- Tool call ID and arguments.
- Input-schema fingerprint.
- Existing Crux approval policy/token identity.

If the tool disappeared or its name/schema fingerprint changed, the previous
approval is invalid for the new contract. Crux fails safely and requires a new
model decision and approval. It never executes a changed remote contract under
an earlier decision.

## Observability contract

Source materialization emits canonical `mcp.connect` and `mcp.discover` spans
before the first model call. They record:

- MCP server `DefinitionRef`.
- Safe transport identity.
- Selected implementation: `ai-sdk` or `official-client`.
- Connection and discovery duration.
- Negotiated protocol/server version when available.
- Discovered, allowed, denied, and exposed counts.
- Tool-list fingerprint.
- Cleanup outcome.
- Structured failure phase.

Every invocation remains a canonical `tool.call` span and gains:

- `origin: 'mcp'`.
- MCP server and discovered tool definition references.
- Server ID.
- Remote and exposed names.
- Transport kind.
- Schema fingerprints.
- MCP execution-error state.

Existing `tool.request`, `tool.args`, `tool.result`, `tool.approval`, Safety
decisions, Turn Decision Reports, definition activity, and causal edges remain
authoritative. No parallel MCP trace graph is introduced.

Headers, tokens, URL credentials/query values, stdio environment values, and
raw binary content are excluded from span attributes, artifacts, errors, and
Project Index facts.

## Project Index contract

### Authored server definition

Static indexing recognizes `mcp()` as `mcp.server` and records:

- Canonical ID and authored source location.
- Variable/export identity.
- Transport kind.
- Sanitized HTTP origin/path or stdio executable, never credentials, query,
  arguments, or environment values.
- Allow/deny/prefix policy.
- Static conditionality and composition evidence.

Prompt and context `use` references create exact relations to the server.
Suggested relation vocabulary is:

```text
prompt.uses_mcp_server
context.uses_mcp_server
mcp.server.provides_tool
```

The final naming must enter the closed relation policy tables rather than using
ad hoc strings.

### Discovered tool definitions

Discovered tools are ordinary `tool` definitions using the final exposed name,
augmented with MCP origin facts:

- Parent server ID.
- Remote name and exposed name.
- Description/title.
- Input/output schemas and fingerprints.
- Annotations marked as untrusted.
- Protocol/server identity.
- Discovery fingerprint and timestamp.
- Availability.

Allowlisted names may appear as partial expected tool definitions before first
discovery, but Crux must not fabricate descriptions or schemas.

Runtime discovery contributes a replacement-scoped Project Index overlay owned
by the server definition. A new successful discovery atomically replaces that
server's prior dynamic child set. Removed tools become unavailable/removed
rather than accumulating forever through the existing append-style runtime
snapshot merge.

Project Index owns this overlay contract. Observability may carry the runtime
evidence, but it must not become an unstructured second index database. The
Local read model must preserve provenance and truthfully distinguish authored,
partial, runtime-observed, stale, and removed facts.

### Runtime joins

`mcp.connect` and `mcp.discover` carry the server definition reference.
`tool.call` carries both the invoked tool and providing server references.
Catalog activity counts and View Runs are backed by exact recorded IDs, never
display-name inference.

## Devtools presentation

### Run Detail

Run Detail shows an MCP preparation node before generation with:

- Server label and safe transport identity.
- Connect/discovery status and timing.
- Selected materializer.
- Protocol/server version.
- Discovered versus exposed counts.
- Filtering/prefix facts.
- Schema or transport failure phase.
- Links to the server and discovered tool Catalog definitions.

MCP executions remain normal tool cards with an MCP/server badge. They show
remote/exposed names, ordinary arguments/results under capture policy, approval
and Safety decisions, timing, errors, and causal links to the requesting model
step. Resumed approvals show the second discovery and link back through the
stable tool call ID.

### Catalog server page

The `mcp.server` detail page shows:

- Authored source and safe configuration.
- Used-by prompts and contexts.
- Last discovery health, implementation, and protocol.
- Allow/deny/prefix policy.
- Current, partial, stale, and removed tools.
- Recent runs, failures, and latency.
- A truthful configured-but-never-observed state.

### Catalog tool page

An MCP-provided tool reuses the ordinary Tool detail page with an MCP Origin
section containing:

- Parent server link.
- Remote and exposed names.
- Description/title.
- Input/output schemas.
- Untrusted annotations.
- Discovery/schema fingerprints.
- Last observed availability.

Existing middleware, approval, Safety, Quality, observability, relations, and
View Runs sections remain visible.

## Quality integration

- Tool-call, result, approval, middleware, Safety, and decision-report
  assertions work unchanged.
- Tool mocks override MCP tools by final exposed name.
- Materialized schema fingerprints participate in existing normalized-call and
  task identity before cache lookup.
- A changed remote schema misses stale reusable artifacts.
- MCP-assisted eval evidence links to both server and tool definitions.
- Live MCP calls remain live external effects unless mocked. Documentation must
  warn against mutating production systems from deterministic evals.
- Tests should prefer the fixture server or explicit tool mocks.

If current cache identity is computed before source materialization, the
ordering must change and the affected cassette, output, and baseline epochs
must be bumped with red tests. If existing identities already observe the final
materialized schemas, no Quality epoch changes are required.

## Error model

Source setup failures use a structured MCP/tool-source error with:

- Source/server ID.
- Phase: transport configuration, connect, initialize, discover, filter,
  schema, merge, close, or resume validation.
- Transport kind and safe endpoint identity.
- Original error as `cause` without secrets.

Setup failures happen before provider I/O. Tool execution failures retain the
existing Crux tool error taxonomy. An MCP `isError` result is a completed
model-visible tool error, not a transport exception.

## Testing

A shared conformance suite runs against both materializers.

| Area          | Required coverage                                                            |
| ------------- | ---------------------------------------------------------------------------- |
| Discovery     | Pagination, bounds, filters, prefixes, duplicates, malformed definitions     |
| Schemas       | Conversion, validation, output schema, canonical fingerprints                |
| Results       | Structured content, text/media/resources, `_meta`, `isError`                 |
| Lifecycle     | Lazy connect, generate/stream cleanup, reverse cleanup, cancellation         |
| Approval      | Suspend, close, reconnect, resume, schema-change rejection                   |
| Middleware    | Ordering, rewrites, blocks, thrown errors, call-site overrides               |
| Safety        | Approval, argument/result screening, report and decision evidence            |
| Adapters      | AI SDK native path plus OpenAI/Anthropic/Google fallback path                |
| Quality       | Mocks, assertions, cache-key invalidation, evidence joins                    |
| Observability | Spans, artifacts, refs, causal edges, redaction, resumed calls               |
| Index         | Static definitions, semantic relations, replacement overlay, cache migration |
| Devtools      | Run nodes/cards, Catalog pages, View Runs, stale/removed tools               |

Fixtures include an in-process Streamable HTTP server and a spawned stdio
server. The fixture supports pagination, authentication, delayed/aborted calls,
structured and multimodal results, execution errors, and a tool-list/schema
change between approval and resumption.

Static/source extraction and semantic changes require JavaScript/native backend
parity fixtures. The native Rust/Oxc extractor and both semantic backends must
emit identical normalized MCP definitions, relations, and source refs.

## Cache identity

This feature changes static output, semantic facts, and the Go-owned Project
Index snapshot/runtime overlay. Implementation must update the applicable
identities in the same change:

- `STATIC_PARSE_CACHE_EPOCH` for new static MCP definitions/relations.
- `SEMANTIC_FACTS_CACHE_EPOCH` for new semantic evidence not already captured
  by existing identity fields.
- `SEMANTIC_COMPILER_OPTIONS_ID` only if compiler-option meaning changes.
- `ProjectIndexSnapshotCacheEpoch` for the new definition/fact shape and
  replacement overlay semantics.

Quality identity epochs change only when the final materialized schema or tool
call is not already represented in the relevant key.

Verification includes `make build`, restart of Crux Local, and
`crux index reindex`; users must not delete `.crux/cache` manually.

## Documentation

- `@use-crux/mcp` README.
- Core README and architecture description of the tool-source boundary.
- MCP reference page.
- Connect-an-MCP-server guide.
- Stdio development and Streamable HTTP production guidance.
- Runtime-context authentication and secret-handling guidance.
- Approval, middleware, and Safety example.
- Quality fixture/mocking example.
- Run and Catalog screenshots after implementation.
- Explicit deferred-feature list.

## Delivery slices

All slices are required to close #166, but each should be independently
reviewable:

1. **Portable composition and execution** — package, source contract,
   transports, materializers, lifecycle, schema/result parity.
2. **Policy, Quality, and observability** — middleware/Safety conformance,
   approval resumption, cache identity, canonical spans, and Run Detail.
3. **Project Index and Catalog** — static/native/semantic parity, runtime
   replacement overlay, exact joins, server/tool Catalog presentation.

This is new public behavior and requires a minor changeset for directly
affected packages. Implementation must inspect pending changesets first and
update a relevant release-theme file instead of creating a duplicate.

## Acceptance criteria

- The same `mcp()` source runs through AI SDK, OpenAI, Anthropic, and Google
  adapters with normalized behavioral parity.
- A source composes through nested `use` arrays and conditional contributors.
- Tool middleware, approval, Safety, guardrails around the generation,
  constraints, timeouts, cancellation, Quality, and mocks behave as documented.
- Approval cannot authorize a changed remote schema.
- Runs explain connection, discovery, policy, execution, and cleanup without
  leaking credentials or raw binary data.
- Project Index and Catalog show the authored server, discovered tools,
  relations, schemas, runtime health, and exact View Runs links.
- Removed remote tools do not remain falsely current.
- Required cache epochs and backend parity fixtures are updated.
- Focused unit, integration, conformance, UI, and end-to-end tests pass.
