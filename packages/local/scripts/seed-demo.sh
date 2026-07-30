#!/usr/bin/env bash

set -euo pipefail

readonly DEFAULT_PORT=4466
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="${PWD}"
readonly FIXTURE_DIR="${SCRIPT_DIR}/../fixtures/demo-project"
readonly BATCH_PATH="${FIXTURE_DIR}/observability-batch.v4.json"
readonly EVAL_FIXTURE_PATH="${FIXTURE_DIR}/eval-artifacts/eval-run-demo-support-v4.json"

port="${DEFAULT_PORT}"

usage() {
  cat <<'EOF'
Usage: seed-demo.sh [--port PORT]

Replay the deterministic Crux flagship demo into a running Crux Local server.

Options:
  --port PORT   Crux Local port (default: 4466)
  -h, --help    Show this help
EOF
}

fail() {
  printf 'seed-demo: %s\n' "$1" >&2
  exit 1
}

while (($# > 0)); do
  case "$1" in
    --port)
      (($# >= 2)) || fail "--port requires a value"
      port="$2"
      shift 2
      ;;
    --port=*)
      port="${1#*=}"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
done

[[ "${port}" =~ ^[0-9]+$ ]] &&
  ((port >= 1 && port <= 65535)) ||
  fail "port must be an integer from 1 to 65535"

command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v node >/dev/null 2>&1 || fail "Node.js is required"
[[ -f "${BATCH_PATH}" ]] || fail "missing fixture: ${BATCH_PATH}"
[[ -f "${EVAL_FIXTURE_PATH}" ]] || fail "missing fixture: ${EVAL_FIXTURE_PATH}"

response_path="$(mktemp "${TMPDIR:-/tmp}/crux-demo-response.XXXXXX")"
trap 'rm -f -- "${response_path}"' EXIT

url="http://127.0.0.1:${port}/api/observability/records"
health_url="http://127.0.0.1:${port}/api/stats"
printf 'Waiting for Crux Local at http://127.0.0.1:%s ...\n' "${port}"
ready=false
for _attempt in {1..60}; do
  if curl --fail --silent --max-time 1 --output /dev/null "${health_url}"; then
    ready=true
    break
  fi
  sleep 0.5
done
[[ "${ready}" == true ]] ||
  fail "Timed out waiting for 'crux dev --port ${port}'"

eval_runs_dir="${PROJECT_ROOT}/.crux/evals/runs"
mkdir -p -- "${eval_runs_dir}"
cp -- "${EVAL_FIXTURE_PATH}" \
  "${eval_runs_dir}/eval-run-demo-support-v4.json"

curl_args=(
  --silent
  --show-error
  --output "${response_path}"
  --write-out '%{http_code}'
  --request POST
  --header 'Content-Type: application/json'
  --data-binary "@${BATCH_PATH}"
  "${url}"
)
ingest_token="${CRUX_DEVTOOLS_TOKEN:-}"
if [[ -z "${ingest_token}" && -f "${PROJECT_ROOT}/.crux/devtools/ingest-token" ]]; then
  ingest_token="$(tr -d '\r\n' <"${PROJECT_ROOT}/.crux/devtools/ingest-token")"
fi
if [[ -n "${ingest_token}" ]]; then
  curl_args=(
    --header "Authorization: Bearer ${ingest_token}"
    "${curl_args[@]}"
  )
fi

printf 'Seeding Crux demo at %s ...\n' "${url}"
if ! http_status="$(curl "${curl_args[@]}")"; then
  fail "Failed to seed Crux Local at ${url}; verify that 'crux dev --port ${port}' is running"
fi
if [[ ! "${http_status}" =~ ^2[0-9][0-9]$ ]]; then
  response_excerpt="$(head -c 500 "${response_path}" | tr '\n' ' ')"
  fail "Failed to seed Crux Local: HTTP ${http_status}${response_excerpt:+ — ${response_excerpt}}"
fi

accepted_count="$(
  node - "${response_path}" "${BATCH_PATH}" <<'NODE'
const { readFileSync } = require("node:fs");

let response;
let batch;
try {
  response = JSON.parse(readFileSync(process.argv[2], "utf8"));
  batch = JSON.parse(readFileSync(process.argv[3], "utf8"));
} catch {
  process.stderr.write("seed-demo: response or fixture contains invalid JSON\n");
  process.exit(1);
}

if (!Array.isArray(response.dispositions)) {
  process.stderr.write("seed-demo: Crux Local response omitted dispositions\n");
  process.exit(1);
}
if (
  !Array.isArray(batch.records) ||
  response.dispositions.length !== batch.records.length
) {
  process.stderr.write(
    "seed-demo: Crux Local returned an incomplete disposition set\n",
  );
  process.exit(1);
}

const rejected = response.dispositions.filter(
  (disposition) => disposition.outcome !== "accepted",
);
if (rejected.length > 0) {
  const codes = [
    ...new Set(rejected.map((item) => item.code || "unknown")),
  ].join(", ");
  process.stderr.write(
    `seed-demo: Crux Local rejected ${rejected.length} record(s): ${codes}\n`,
  );
  process.exit(1);
}

process.stdout.write(String(response.dispositions.length));
NODE
)"

printf 'Demo data accepted: %s observability records.\n' "${accepted_count}"
printf 'Eval V4 installed: %s\n' \
  "${eval_runs_dir}/eval-run-demo-support-v4.json"
