# Crux Local demo fixture

`demo-project` is a deterministic, key-free Crux Local project. It combines
authored prompt/context/tool/Eval source with replayable schema-V4
observability, a validated Eval V4 run, and a committed Baseline V3.

From the repository root, run:

```sh
cd packages/local/fixtures/demo-project
../../scripts/seed-demo.sh --port 4466 >/tmp/crux-demo-seed.log 2>&1 &
../../crux dev --tui --port 4466
```

The seeder waits up to 30 seconds for Local, replays the data, and exits. Its
result is available in `/tmp/crux-demo-seed.log`. Port 4466 is intentionally
non-default; port 4400 may already belong to another development server. Pass
the same alternate port to both commands if 4466 is unavailable.

After seeding:

- **Overview** shows five runs, non-empty pass-rate/cost/latency KPIs, recent
  runs, derived insights, and live ingest activity.
- **Runs** shows five ok/error/suspended operations. The refund regression has
  an at-least-ten-span waterfall with repeated tool calls, retrieval and
  guardrail failures, and terminal error diagnosis.
- **Index** shows authored contexts, tools, prompts, Eval Cases, and the Eval.
- **Insights** is populated by the product-owned Inspect analyzer. The seeded
  slow, high-token, costly, repeated-tool, retrieval, guardrail, and error
  evidence crosses its normal derivation thresholds; no insight record is
  written through a fixture-only side channel.

## Mechanism and trade-offs

`seed-demo.sh` POSTs the recorded batch to the existing
`/api/observability/records` endpoint. Local validates and persists it in the
project's normal `.crux/observability.sqlite`; the TUI continues to read the
same in-process observability and Inspect services as browser Devtools. The
script installs the versioned Eval run under the normal `.crux/evals/runs`
boundary before replaying observability, while the Baseline remains beside its
authored Eval source.

Stable record IDs make replay idempotent. Recorded timestamps are deliberately
fixed so repeated seeding cannot conflict with canonical record identity; this
means relative ages drift over time, but the fixture remains deterministic and
the current Runs query still presents the records. This avoids raw SQLite/cache
fixtures, startup-only product branches, public flags, and alternate TUI read
paths.

In an unbootstrapped checkout with no workspace `node_modules`, Local may show
a Runtime artifact preparation warning after static indexing. This does not
affect the demo read models or the eight authored Index definitions, and it is
unrelated to API credentials.

The script uses `CRUX_DEVTOOLS_TOKEN` when set, otherwise reads the token Local
creates at `.crux/devtools/ingest-token`. The default loopback listener does
not require the bearer, but using it keeps the replay compatible with the
product's authenticated ingest path.
