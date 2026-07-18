# @use-crux/mcp

Portable Model Context Protocol tool sources for Crux.

`mcp()` describes a remote tool source once and composes it through a prompt or
context `use[]`. Crux connects and discovers tools for each invocation, then
runs the selected tools through the same middleware, approval, Safety,
guardrail, timeout, observability, and Eval lifecycle as authored tools.

## Install

Install this package alongside Core and one execution adapter:

```bash
pnpm add @use-crux/core @use-crux/mcp
pnpm add @use-crux/ai ai # or @use-crux/openai, @use-crux/anthropic, @use-crux/google
```

`@use-crux/mcp` owns both the official MCP client and the AI SDK-native MCP
client. Adapter packages keep MCP as an optional peer, so ordinary Core and
provider installs do not pull an MCP client into the application.

`@use-crux/mcp` is ESM-only. Streamable HTTP remains portable; stdio
materialization requires a Node runtime and fails closed elsewhere.

## Streamable HTTP

Resolve credentials from invocation `runtimeContext`; do not put tokens in a
module-level source definition, URL query, prompt, or logs.

```ts
import { prompt, toolMiddleware } from "@use-crux/core";
import { toolPolicy } from "@use-crux/core/safety";
import { mcp, streamableHttp } from "@use-crux/mcp";

interface RuntimeContext {
  readonly mcpToken: string;
}

const crm = mcp<RuntimeContext>({
  id: "crm",
  transport: ({ runtimeContext, abortSignal }) => {
    if (abortSignal?.aborted) throw abortSignal.reason;
    return streamableHttp({
      url: "https://mcp.example.com/v1",
      headers: { Authorization: `Bearer ${runtimeContext.mcpToken}` },
      redirect: "error",
    });
  },
  tools: { allow: ["search_customer", "update_customer"], prefix: "crm_" },
});

export const support = prompt({
  id: "support",
  use: [crm],
  prompt: "Help the customer with the available CRM tools.",
  toolMiddleware: [
    toolMiddleware({
      id: "crm-audit",
      match: [/^crm_/],
      afterExecute: ({ toolName, durationMs }) =>
        audit.record({ toolName, durationMs }),
    }),
    toolPolicy({
      id: "approve-crm-writes-v1",
      match: { tool: "crm_update_customer" },
      action: "requestApproval",
      reason: "Customer changes require operator approval.",
    }),
  ],
});
```

HTTP redirects fail by default. `redirect: 'follow'` follows only safe
same-origin hops and strips configured credentials before any cross-origin
request. Prefer a stable final endpoint instead of redirects.

## stdio

Use stdio for local servers and development tools. Pass the executable and
arguments separately; never build a shell command from model input.

```ts
import { mcp, stdio } from "@use-crux/mcp";

export const localFiles = mcp({
  id: "local-files",
  transport: stdio({
    command: process.execPath,
    args: ["./servers/files.mjs"],
    env: { WORKSPACE_ROOT: process.cwd() },
  }),
  tools: { allow: ["read_file"], prefix: "files_" },
});
```

One invocation owns one fresh MCP session. Crux initializes, discovers the
complete bounded tool list, applies selection before prefixing, executes calls,
and closes the session on success, failure, cancellation, timeout, stream
disposal, or approval suspension. Approval resume creates a new session and
rediscovers before executing the exact committed request.

## Selection and names

Prefer an explicit allowlist for production servers. It limits what the model
can call and makes reviews intentional, but it does not fabricate metadata for
a configured tool the server did not discover.

`allow` and `deny` are mutually exclusive. `prefix` is applied after selection
and is useful when multiple servers expose the same name or a remote name starts
with a digit. Final exposed names must match
`^[A-Za-z_][A-Za-z0-9_-]{0,63}$`; Crux fails before provider I/O instead of
silently renaming an incompatible tool. The original remote name is preserved
for `tools/call`.

## Approval resume

Use the normal Crux approval helpers. Persist the returned messages in trusted
server-side storage, append the decision, and invoke the same prompt again:

```ts
import {
  appendToolApprovalResponse,
  findToolApprovalRequests,
} from "@use-crux/core/adapter/tool";

const [request] = findToolApprovalRequests(first.messages);
if (request) {
  const messages = appendToolApprovalResponse(first.messages, {
    approvalId: request.approvalId,
    approvalToken: request.approvalToken,
    approved: true,
  });

  await adapter.generate(support, { model, messages, runtimeContext });
}
```

The approval token and replay commitment bind the call, input, discovered MCP
identity, schema, and requesting policies. Missing or changed provenance returns
an ordinary `approval-invalid` tool result and never reaches remote execution.

## Evals

A live MCP source can affect real systems. Point an Eval at the callable
managed production task, and use a deterministic in-process or spawned MCP
fixture when the run must avoid remote side effects. Give the fixture a stable
revision so task identity changes with fixture behavior. Dynamic dependencies
whose identity cannot be proven execute normally but are not reusable.

## Devtools

With Crux Local running, Run Detail shows `mcp.connect`, `mcp.discover`, the
ordinary tool call, policy and approval evidence, and bounded cleanup. Catalog
shows the authored server, discovered tools, schemas, fingerprints, health, and
current/stale/removed availability. Self-reported server name and version are
untrusted presentation data. Credentials, raw schemas, `_meta`, binary payloads,
and raw transport errors are not retained.

## Reliability and limits

- Each selected image, audio, or embedded binary resource is strictly decoded
  and limited to 20 MiB.
- Discovery is bounded to 64 pages and rejects cursor loops, duplicate exposed
  names, malformed schemas, and non-portable names before provider I/O.
- HTTP and stdio sessions are call-scoped; there is no connection pool in v1.
- Cleanup is bounded and cannot mask the primary generation error.

## Scope

V1 supports MCP tools over Streamable HTTP and stdio. MCP resources as prompt
inputs, prompts, sampling, elicitation, tasks, roots, server pools, config
auto-discovery, rename maps, and configurable binary limits are deferred.

Provider-hosted MCP options are not equivalent to `mcp()`: they bypass Crux's
portable materialization, policy, approval replay, result normalization,
observability, Eval identity, and Project Index contracts. First-party Crux
adapters use the portable client paths instead.

See the [MCP guide](https://cruxjs.dev/docs/guides/tools/mcp) and
[API reference](https://cruxjs.dev/docs/reference/mcp).
