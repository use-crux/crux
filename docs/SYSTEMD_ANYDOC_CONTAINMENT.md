# Systemd Anydoc containment gate

`TestSystemdContainmentIntegration` is a Linux host-integration gate for the
dormant Anydoc supervisor. It does not enable document-format routing.

Normal `go test` runs skip it. To run it, use a disposable Linux host with
systemd as PID 1, cgroup v2, a live system D-Bus, a root-owned Node 24 binary,
and permission to create transient units:

```sh
make -C packages/local build-local-workers embed-workers
cd packages/local
go test -c -o /tmp/anydoc-systemd.test ./internal/anydocsupervisor
sudo CRUX_SYSTEMD_INTEGRATION=1 \
  CRUX_SYSTEMD_EVIDENCE_PATH="$PWD/../../artifacts/anydoc-containment.json" \
  timeout 10m /tmp/anydoc-systemd.test \
  -test.run '^TestSystemdContainmentIntegration$' -test.count=1 -test.parallel=1
```

The CI job uses this exact shape. It must not replace systemd with a sandbox
emulator or silently skip an unavailable system bus. The evidence artifact is
bounded JSON containing only the input hash, byte counts, observed outcomes,
effective cgroup limits, memory events/current use, CPU/wall use, and cleanup
status; it intentionally excludes document bytes and host paths. In addition
to the canonical parse it sequentially exercises network and DNS denial,
filesystem visibility and write denial, privilege escalation, task exhaustion,
memory and swap enforcement, cumulative CPU and wall ceilings, worker failure,
caller cancellation, and descendant cleanup. Each hostile case runs in a fresh
production transient-unit sandbox through an internal probe seal that cannot be
selected by ingestion callers. Services are capped at 128 MiB or less and eight
tasks, and the entire CI job remains bounded to ten minutes.

Accounting and effective properties are captured before stop. Termination is
reported separately only after systemd reaches an inactive terminal state and
the exact original cgroup is observed empty or already absent. CPU evidence
includes throttling counters and its CPU-to-wall ratio; task exhaustion uses
`pids.events`; and private-temporary-directory checks compare host and worker
sentinels across the namespace boundary. The hostile helper itself is copied,
hashed, and mounted read-only at one fixed internal path before the same full
effective-property, cgroup, runtime-tree, and executable verification used by
the production launch releases its authorization.
