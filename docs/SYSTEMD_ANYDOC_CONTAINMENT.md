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
bounded JSON containing only the input hash, byte counts, observed outcome,
effective cgroup limits, memory events/current use, CPU/wall use, and cleanup
status; it intentionally excludes document bytes and host paths. The
integration service is capped at 128 MiB (one quarter of the production
ceiling) and eight tasks.
