# Runtime program worker architecture

This document describes the shipped, single-owner Node execution worker across
`@use-crux/core`, `@use-crux/indexer`, `@use-crux/local-workers`, and the Go
`@use-crux/local` supervisor. User behavior is documented in the
[Node worker guide](../../../apps/docs/content/docs/guides/durable-execution/node.mdx).

## One immutable executable input

Project Index is the source of discovered Flow and durable-task definitions.
Runtime artifact planning turns eligible top-level exports into a deterministic
manifest containing target name, kind, module, and export. Duplicate or
unimportable targets produce findings before any file is activated.

Generation emits:

- `.crux/generated/runtime/manifest.json`, the canonical discovered artifact;
- `.crux/generated/runtime/program.ts`, static target imports plus one
  `createRuntimeProgram({ targets, transports })` call; and
- host projections that consume the same program or manifest target graph.

`RuntimeProgram.manifestHash` hashes the canonical executable declaration:
target identities/kinds and inert transport declarations. The generated
`runtimeArtifactManifestHash` separately hashes the exact manifest bytes. The
former identifies program meaning; the latter detects a mixed generated set.

Artifact writes are staged beside their destinations. The program and host
projections activate before the manifest, and the manifest activates last.
Rollback restores already-activated files when a later rename fails. Readers
therefore treat the manifest as the activation marker.

## Loader and configuration boundary

The worker has two independent startup inputs:

```text
crux.config.ts -> loadRuntimeWorkerHost() -> in-process Runtime definition
manifest + program.ts -> generated loader -> RuntimeProgram
```

`loadRuntimeWorkerHost()` imports config in the Indexer's `runtime-rich` mode.
It accepts only an in-process Runtime with a store-backed
`maintenanceOwnership` port. It does not discover targets, load generated code,
or start maintenance.

The private generated-program loader owns filesystem and trusted user-module
import. It requires both files, decodes the manifest, checks the program format,
binds the program to the manifest byte hash, validates the exported shape, and
compares ordered target names and kinds. It never falls back to source
rediscovery or a hand-maintained barrel. Importing static targets executes
trusted application module code with the worker's authority.

Core remains free of config, filesystem, and Indexer dependencies.
`createRuntimeProgram()` is pure validation/canonicalization;
`createRuntimeWorker()` receives already-resolved inputs.

## Go-to-Node supervision

`crux runtime worker` resolves the project root and extracts the embedded Node
worker bundle. Go finds Node, starts exactly one child with the root as its only
argument, and connects stdin/stdout/stderr to the command boundary.

The Node process loads host then program, checking for shutdown between awaits.
It constructs one Core worker and races `worker.closed` against `SIGINT` or
`SIGTERM`. Its `finally` path always removes signal listeners and calls
`worker.stop({ timeoutMs: 10_000 })` when construction succeeded.

Go gives the Node lifecycle one additional second: after cancellation it
signals the process tree, waits up to 11 seconds, then force-stops the tree and
returns a timeout error. This separates Core's semantic shutdown bound from the
outer operating-system cleanup bound.

## Durable ownership

Core first acquires process-local ownership keyed by store object identity and
namespace. It then asynchronously acquires the optional store-backed lease.
The CLI host loader makes that optional Core port mandatory for cross-process
operation. PostgreSQL implements it with database-backed ownership.

No maintenance tick starts before durable acquisition succeeds. A competing
owner rejects `closed` and executes no maintenance. Clean stop, fatal tick
failure, and eventually settled timeout paths release durable then local
ownership. Different namespaces are independent.

The current deployment contract is exactly one execution worker per durable
store namespace. Lease fencing inside Runtime work protects reclaimed work;
maintenance ownership prevents two maintenance loops from intentionally
operating the namespace at once.

## Replay and cross-process recovery

The application process commits durable Runtime records to PostgreSQL. The
worker's serial maintenance passes claim outbox rows, due timers, expired
leases and waiters, scoped-idle transitions, and retention work through the
same Runtime kernel used by other hosts.

Flow progress and buffered Runtime effects commit at suspension/completion
boundaries. A replacement process reconstructs work from durable records and
replays from the last committed snapshot. Recorded effect positions,
idempotency records, lease fencing, and terminal-state arbitration prevent a
replay from duplicating an already committed Runtime child or replacing a
committed terminal outcome. They cannot physically cancel or make arbitrary
application side effects exactly-once.

Fatal maintenance closes the worker. Shutdown stops future ticks and waits for
the current tick, but a timeout honestly reports that external work already
started may still be running; ownership release is deferred until it settles.

## Process-tree containment

On Unix, Go starts the Node child in a new process group. Cancellation sends
`SIGTERM` to the negative process-group id; timeout sends `SIGKILL`. Descendants
created by application imports or targets stay within that group unless they
explicitly detach.

On Windows, Go creates the process suspended, creates a Job Object with
`KILL_ON_JOB_CLOSE`, assigns the child, then resumes its threads. Cancellation
sends `CTRL_BREAK_EVENT` to the new process group. Timeout closes the Job Object
so the operating system terminates its assigned descendants. Assignment before
resume closes the race where the child could create an uncontained descendant.

## Composition boundary for later work

This architecture intentionally does not define an application-level spawn API.
Until such a surface ships, internal diagrams and user docs should discuss
accepted durable work generically and document only currently exported calls.
