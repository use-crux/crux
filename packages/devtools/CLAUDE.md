# Crux Devtools

The browser UI is embedded in Crux Local and reads same-origin REST and
WebSocket endpoints. TanStack Query owns server-shaped state; the runtime store
owns push-only connection and in-flight state.

Current user-facing domains are Runs, Insights, Runtime, Evals, Eval runs,
Baselines, Review, and the Library. New REST reads belong in a feature service
and query hook. Filesystem-backed Eval reads use bounded polling until the local
server publishes a durable change event.

Do not add compatibility routes or UI concepts for removed pre-launch Quality,
Experiment, Suite, Dataset, or Cassette workflows. Eval evidence is rendered
from the V3 run/Baseline contracts, and observed generation runs link to Run
Detail through their authoritative run IDs.
