#!/usr/bin/env bash
# tui-shots.sh — boot the real Crux TUI and capture every screen at multiple sizes.
#
# Usage (from packages/local or via make):
#   make -C packages/local tui-shots
#   TUI_SHOTS_PROJECT=examples/node-basic ./scripts/tui-shots.sh
#
# Requires: built ./crux binary, tmux. Optional: vhs (~/go/bin/vhs) for PNG/GIF.
# Does not build TypeScript/Rust assets.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd -- "${LOCAL_DIR}/../.." && pwd)"

BINARY="${LOCAL_DIR}/crux"
OUT_ROOT="${LOCAL_DIR}/tapes/out/shots"
TAPE_GEN_DIR="${LOCAL_DIR}/tapes/out/generated"
PROJECT_REL="${TUI_SHOTS_PROJECT:-examples/node-basic}"
NODE_BIN="${HOME}/.nvm/versions/node/v24.16.0/bin"
VHS_BIN="${TUI_SHOTS_VHS:-}"
BOOT_TIMEOUT_S="${TUI_SHOTS_BOOT_TIMEOUT:-90}"
SETTLE_MS="${TUI_SHOTS_SETTLE_MS:-600}"
NO_IMAGES="${TUI_SHOTS_NO_IMAGES:-0}"

# Unique per run to avoid collisions when run concurrently.
RUN_ID="$$-${RANDOM}"
SESSION="tui-shots-${RUN_ID}"
PORT=""
CRUX_PID=""
VHS_OK=0
VHS_SKIP_REASON=""
FAILURES=0
PRODUCED=()

# Pixel size ≈ cols*font + padding so VHS terminal cells roughly match.
# FontSize 14 ≈ 14px cell height; mono advance ≈ 0.6*size for charm fonts.
declare -A SIZE_PIXELS=(
  ["160x45"]="1400x700"
  ["100x30"]="900x480"
  ["70x24"]="640x400"
)

log() { printf 'tui-shots: %s\n' "$*"; }
err() { printf 'tui-shots: ERROR: %s\n' "$*" >&2; }

die() {
  err "$*"
  exit 1
}

ms_to_vhs_sleep() {
  # VHS Sleep accepts Ns / Nms.
  local ms="$1"
  if (( ms >= 1000 )); then
    printf '%ds' "$((ms / 1000))"
  else
    printf '%dms' "$ms"
  fi
}

pick_free_port() {
  local p candidate
  for _ in $(seq 1 40); do
    candidate=$((45000 + RANDOM % 10000))
    if ! ss -ltn 2>/dev/null | grep -qE ":${candidate}\\b"; then
      # Double-check with a bind if python is available.
      if command -v python3 >/dev/null 2>&1; then
        if python3 -c "import socket;s=socket.socket();s.bind(('127.0.0.1',${candidate}));s.close()" 2>/dev/null; then
          echo "$candidate"
          return 0
        fi
      else
        echo "$candidate"
        return 0
      fi
    fi
  done
  # Last resort: OS-assigned port via python.
  python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()'
}

resolve_project() {
  local rel="$1"
  if [[ "$rel" = /* ]]; then
    printf '%s\n' "$rel"
    return
  fi
  if [[ -d "${REPO_ROOT}/${rel}" ]]; then
    printf '%s\n' "${REPO_ROOT}/${rel}"
    return
  fi
  if [[ -d "${LOCAL_DIR}/${rel}" ]]; then
    printf '%s\n' "${LOCAL_DIR}/${rel}"
    return
  fi
  if [[ -d "$rel" ]]; then
    cd -- "$rel" && pwd
    return
  fi
  die "project directory not found: ${rel} (set TUI_SHOTS_PROJECT)"
}

kill_port_listeners() {
  local port="$1"
  [[ -n "$port" ]] || return 0
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" >/dev/null 2>&1 || true
  fi
  # Fallback: ss + kill by inode-less match on port (avoid self-matching pkill -f).
  if command -v ss >/dev/null 2>&1; then
    local pids
    pids="$(ss -lptn "sport = :${port}" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u || true)"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill $pids >/dev/null 2>&1 || true
      sleep 0.2
      # shellcheck disable=SC2086
      kill -9 $pids >/dev/null 2>&1 || true
    fi
  fi
}

cleanup() {
  local ec=$?
  set +e
  if [[ -n "${SESSION:-}" ]]; then
    tmux kill-session -t "$SESSION" >/dev/null 2>&1
  fi
  # Kill any leftover sessions from this script pattern for this RUN_ID only.
  tmux list-sessions -F '#{session_name}' 2>/dev/null | while read -r s; do
    case "$s" in
      "tui-shots-${RUN_ID}"*) tmux kill-session -t "$s" >/dev/null 2>&1 ;;
    esac
  done
  if [[ -n "${CRUX_PID:-}" ]] && kill -0 "$CRUX_PID" >/dev/null 2>&1; then
    kill "$CRUX_PID" >/dev/null 2>&1 || true
    sleep 0.2
    kill -9 "$CRUX_PID" >/dev/null 2>&1 || true
  fi
  kill_port_listeners "${PORT:-}"
  # Best-effort: orphan workers sometimes linger briefly after parent death.
  sleep 0.3
  return "$ec"
}
trap cleanup EXIT INT TERM HUP

require_binary() {
  if [[ ! -x "$BINARY" ]]; then
    die "missing built binary at ${BINARY}
Build it first (from repo root): make local
or (from packages/local): make build / make build-go
This target does not build TypeScript/Rust assets."
  fi
}

require_tmux() {
  command -v tmux >/dev/null 2>&1 || die "tmux is required but not installed"
}

detect_vhs() {
  if [[ -n "$VHS_BIN" && -x "$VHS_BIN" ]]; then
    return 0
  fi
  if [[ -x "${HOME}/go/bin/vhs" ]]; then
    VHS_BIN="${HOME}/go/bin/vhs"
    return 0
  fi
  if command -v vhs >/dev/null 2>&1; then
    VHS_BIN="$(command -v vhs)"
    return 0
  fi
  return 1
}

probe_vhs() {
  VHS_OK=0
  VHS_SKIP_REASON=""
  if ! detect_vhs; then
    VHS_SKIP_REASON="vhs not found (install charmbracelet/vhs or set TUI_SHOTS_VHS)"
    return 1
  fi
  if ! command -v ttyd >/dev/null 2>&1 && [[ ! -x "${HOME}/.local/bin/ttyd" ]]; then
    VHS_SKIP_REASON="ttyd not found (VHS dependency)"
    return 1
  fi
  # VHS Output/Screenshot paths must be relative (absolute paths fail to parse).
  # Short tapes sometimes omit Screenshot PNGs; a non-empty GIF is enough to prove
  # headless VHS+ttyd works. Full crux tapes produce per-screen PNGs.
  local rel_probe="packages/local/tapes/out/shots/_probe"
  local probe_gif="${REPO_ROOT}/${rel_probe}/probe-${RUN_ID}.gif"
  local probe_tape="${TAPE_GEN_DIR}/probe-${RUN_ID}.tape"
  mkdir -p "${REPO_ROOT}/${rel_probe}" "$TAPE_GEN_DIR"
  cat >"$probe_tape" <<EOF
Output ${rel_probe}/probe-${RUN_ID}.gif
Set Shell "bash"
Set FontSize 14
Set Width 400
Set Height 200
Set TypingSpeed 1ms
Type "echo vhs-probe-ok"
Enter
Sleep 1s
EOF
  local path_extra="${HOME}/.local/bin:${HOME}/go/bin"
  local probe_log="${TAPE_GEN_DIR}/probe-${RUN_ID}.log"
  if ! (
    cd "$REPO_ROOT"
    PATH="${path_extra}:${PATH}"
    timeout 90 "$VHS_BIN" "$probe_tape"
  ) >"$probe_log" 2>&1; then
    VHS_SKIP_REASON="vhs probe failed (see ${probe_log})"
    return 1
  fi
  if [[ ! -s "$probe_gif" ]]; then
    VHS_SKIP_REASON="vhs probe produced empty/missing GIF"
    return 1
  fi
  VHS_OK=1
  rm -rf "${REPO_ROOT}/${rel_probe}"
  return 0
}

# Captures model a modern truecolor terminal, independent of the invoking
# shell's CI/color preferences. TERM cannot retain tmux's screen-* value here:
# colorprofile deliberately ignores COLORTERM for screen/tmux terminals unless
# an attached tmux client reports Tc/RGB, while these sessions are detached.
crux_env_prefix() {
  printf 'env -u CI -u GITHUB_ACTIONS -u BUILDKITE -u GITLAB_CI -u CIRCLECI -u TEAMCITY_VERSION -u NO_COLOR TERM=xterm-256color COLORTERM=truecolor'
}

export_node_path() {
  if [[ -d "$NODE_BIN" ]]; then
    export PATH="${NODE_BIN}:${PATH}"
  fi
}

wait_for_tui_header() {
  local session="$1"
  local deadline=$((SECONDS + BOOT_TIMEOUT_S))
  local out plain
  while (( SECONDS < deadline )); do
    out="$(tmux capture-pane -t "$session" -p -e 2>/dev/null || true)"
    # Strip CSI / OSC for matching.
    plain="$(printf '%s' "$out" | sed -E 's/\x1b\[[0-9;?]*[a-zA-Z]//g; s/\x1b\][^\x07\x1b]*(\x07|\x1b\\)//g')"
    if printf '%s' "$plain" | grep -qE '◇ Crux|[[:space:]]Overview[[:space:]]|INSPECT|OPEN INSIGHTS'; then
      return 0
    fi
    # Early failure surfaces.
    if printf '%s' "$plain" | grep -qE 'requires an interactive terminal|address already in use'; then
      err "TUI failed to start:"
      printf '%s\n' "$plain" | head -20 >&2
      return 1
    fi
    sleep 0.25
  done
  err "timed out after ${BOOT_TIMEOUT_S}s waiting for TUI header"
  tmux capture-pane -t "$session" -p 2>/dev/null | head -40 >&2 || true
  return 1
}

settle() {
  # Prefer short fixed settle after navigation; header is already present.
  local ms="${1:-$SETTLE_MS}"
  sleep "$(awk -v ms="$ms" 'BEGIN{printf "%.3f", ms/1000}')"
}

capture_pane_to() {
  local session="$1"
  local dest="$2"
  mkdir -p "$(dirname -- "$dest")"
  tmux capture-pane -t "$session" -p -e >"$dest" || true
  if [[ ! -s "$dest" ]]; then
    err "empty capture: $dest"
    FAILURES=$((FAILURES + 1))
    return 0
  fi
  PRODUCED+=("$dest")
  return 0
}

send_key() {
  local session="$1"
  local key="$2"
  # -l sends literally (important for ':' which tmux might otherwise mishandle).
  case "$key" in
    Escape|Esc) tmux send-keys -t "$session" Escape ;;
    Enter) tmux send-keys -t "$session" Enter ;;
    *) tmux send-keys -t "$session" -l "$key" ;;
  esac
}

start_tmux_crux() {
  local cols="$1"
  local rows="$2"
  local project="$3"
  local port="$4"

  tmux kill-session -t "$SESSION" >/dev/null 2>&1 || true

  # shellcheck disable=SC2086
  tmux new-session -d -s "$SESSION" -x "$cols" -y "$rows" \
    "cd $(printf '%q' "$project") && \
     PATH=$(printf '%q' "${NODE_BIN}:${PATH}") \
     $(crux_env_prefix) \
     $(printf '%q' "$BINARY") dev --port ${port} --tui; \
     echo CRUX_EXIT=\$?; sleep 2"

  wait_for_tui_header "$SESSION"

  # Track crux PID via pane children for cleanup.
  local pane_pid
  pane_pid="$(tmux list-panes -t "$SESSION" -F '#{pane_pid}' 2>/dev/null | head -1 || true)"
  if [[ -n "$pane_pid" ]]; then
    CRUX_PID="$(pgrep -P "$pane_pid" 2>/dev/null | head -1 || true)"
  fi
}

stop_tmux_crux() {
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    # Prefer graceful quit so workers wind down.
    send_key "$SESSION" "q" || true
    sleep 0.4
    tmux kill-session -t "$SESSION" >/dev/null 2>&1 || true
  fi
  CRUX_PID=""
  kill_port_listeners "$PORT"
}

capture_screen_set_tmux() {
  local size="$1"
  local cols="${size%%x*}"
  local rows="${size##*x}"
  local project="$2"
  local out_dir="${OUT_ROOT}/${size}"
  mkdir -p "$out_dir"

  log "tmux capture ${size} (port ${PORT}) → ${out_dir}"
  start_tmux_crux "$cols" "$rows" "$project" "$PORT"

  # Overview is default.
  settle 800
  capture_pane_to "$SESSION" "${out_dir}/overview.txt"

  send_key "$SESSION" "2"
  settle
  capture_pane_to "$SESSION" "${out_dir}/insights.txt"

  send_key "$SESSION" "3"
  settle
  capture_pane_to "$SESSION" "${out_dir}/runs.txt"

  send_key "$SESSION" "4"
  settle
  capture_pane_to "$SESSION" "${out_dir}/index.txt"

  if [[ "$size" == "160x45" ]]; then
    send_key "$SESSION" "1"
    settle
    send_key "$SESSION" ":"
    settle 400
    capture_pane_to "$SESSION" "${out_dir}/palette.txt"
    send_key "$SESSION" "Escape"
    settle 300

    send_key "$SESSION" "?"
    settle 400
    capture_pane_to "$SESSION" "${out_dir}/help.txt"
    send_key "$SESSION" "Escape"
    settle 300

    send_key "$SESSION" "!"
    settle 400
    capture_pane_to "$SESSION" "${out_dir}/diagnostics.txt"
    send_key "$SESSION" "Escape"
    settle 300
  fi

  stop_tmux_crux
}

write_vhs_tape() {
  local size="$1"
  local project="$2"
  local port="$3"
  local tape_path="$4"
  local out_dir="${OUT_ROOT}/${size}"
  local pixels="${SIZE_PIXELS[$size]}"
  local px_w="${pixels%%x*}"
  local px_h="${pixels##*x}"
  local boot_sleep="10s"
  local settle_sleep
  settle_sleep="$(ms_to_vhs_sleep "$SETTLE_MS")"

  mkdir -p "$out_dir" "$(dirname -- "$tape_path")"

  # VHS Output/Screenshot paths must parse as relative path tokens (no leading /tmp).
  local rel_out="packages/local/tapes/out/shots/${size}"
  local q_project q_binary
  q_project="$(printf '%q' "$project")"
  q_binary="$(printf '%q' "$BINARY")"

  cat >"$tape_path" <<EOF
# Generated by tui-shots.sh — do not edit; regenerated each run.
Output ${rel_out}/_session.gif
Set Shell "bash"
Set FontSize 14
Set Width ${px_w}
Set Height ${px_h}
Set TypingSpeed 1ms
Env CI ""
Env GITHUB_ACTIONS ""
Env NO_COLOR ""
Env TERM "xterm-256color"
Env COLORTERM "truecolor"
Env PATH "${NODE_BIN}:${HOME}/.local/bin:${HOME}/go/bin:/usr/local/bin:/usr/bin:/bin"
Type "cd ${q_project} && $(crux_env_prefix) ${q_binary} dev --port ${port} --tui"
Enter
Sleep ${boot_sleep}
Screenshot ${rel_out}/overview.png
Type "2"
Sleep ${settle_sleep}
Screenshot ${rel_out}/insights.png
Type "3"
Sleep ${settle_sleep}
Screenshot ${rel_out}/runs.png
Type "4"
Sleep ${settle_sleep}
Screenshot ${rel_out}/index.png
EOF

  if [[ "$size" == "160x45" ]]; then
    cat >>"$tape_path" <<EOF
Type "1"
Sleep ${settle_sleep}
Type ":"
Sleep 400ms
Screenshot ${rel_out}/palette.png
Escape
Sleep 300ms
Type "?"
Sleep 400ms
Screenshot ${rel_out}/help.png
Escape
Sleep 300ms
Type "!"
Sleep 400ms
Screenshot ${rel_out}/diagnostics.png
Escape
Sleep 300ms
EOF
  fi

  cat >>"$tape_path" <<EOF
Type "q"
Sleep 1s
EOF
}

run_vhs_size() {
  local size="$1"
  local project="$2"
  local port="$3"
  local tape="${TAPE_GEN_DIR}/shots-${size}-${RUN_ID}.tape"
  local out_dir="${OUT_ROOT}/${size}"

  write_vhs_tape "$size" "$project" "$port" "$tape"
  log "vhs capture ${size} (port ${port}) → ${out_dir}"

  # Run from repo root so relative Output/Screenshot paths resolve.
  local vhs_log="${TAPE_GEN_DIR}/vhs-${size}-${RUN_ID}.log"
  if ! (
    cd "$REPO_ROOT"
    PATH="${HOME}/.local/bin:${HOME}/go/bin:${NODE_BIN}:${PATH}"
    # Scrub CI for the vhs process itself too (Env in tape handles the shell).
    env -u CI -u GITHUB_ACTIONS -u NO_COLOR \
      TERM=xterm-256color COLORTERM=truecolor "$VHS_BIN" "$tape"
  ) >"$vhs_log" 2>&1; then
    err "vhs failed for ${size} (see ${vhs_log})"
    kill_port_listeners "$port"
    return 1
  fi

  local name names=(overview insights runs index)
  if [[ "$size" == "160x45" ]]; then
    names+=(palette help diagnostics)
  fi
  for name in "${names[@]}"; do
    local png="${out_dir}/${name}.png"
    if [[ ! -s "$png" ]]; then
      err "missing/empty VHS screenshot: $png"
      FAILURES=$((FAILURES + 1))
    else
      PRODUCED+=("$png")
    fi
  done
  if [[ -s "${out_dir}/_session.gif" ]]; then
    PRODUCED+=("${out_dir}/_session.gif")
  fi
  kill_port_listeners "$port"
}

expected_names_for_size() {
  local size="$1"
  local names=(overview insights runs index)
  if [[ "$size" == "160x45" ]]; then
    names+=(palette help diagnostics)
  fi
  printf '%s\n' "${names[@]}"
}

validate_outputs() {
  local size name path missing=0
  for size in 160x45 100x30 70x24; do
    while read -r name; do
      path="${OUT_ROOT}/${size}/${name}.txt"
      if [[ ! -s "$path" ]]; then
        err "missing/empty text capture: $path"
        missing=$((missing + 1))
      fi
      if (( VHS_OK )); then
        path="${OUT_ROOT}/${size}/${name}.png"
        if [[ ! -s "$path" ]]; then
          err "missing/empty image capture: $path"
          missing=$((missing + 1))
        fi
      fi
    done < <(expected_names_for_size "$size")
  done
  FAILURES=$((FAILURES + missing))
}

print_summary() {
  log "──────── summary ────────"
  log "project: ${PROJECT_PATH}"
  log "binary:  ${BINARY}"
  log "out:     ${OUT_ROOT}"
  if (( VHS_OK )); then
    log "images:  VHS OK (${VHS_BIN})"
  else
    log "images:  SKIPPED — ${VHS_SKIP_REASON}"
    log "TODO: restore image capture (install vhs+ttyd, or fix headless chrome)"
  fi
  log "produced files:"
  if [[ -d "$OUT_ROOT" ]]; then
    # shellcheck disable=SC2012
    ls -laR "$OUT_ROOT" | sed 's/^/  /'
  fi
  if (( FAILURES > 0 )); then
    err "${FAILURES} capture(s) missing or empty"
    return 1
  fi
  log "all required captures present"
  return 0
}

main() {
  require_binary
  require_tmux
  export_node_path

  PROJECT_PATH="$(resolve_project "$PROJECT_REL")"
  PORT="$(pick_free_port)"
  mkdir -p "$OUT_ROOT" "$TAPE_GEN_DIR"

  # Fresh shot tree for this run (keep generated tapes dir).
  rm -rf "${OUT_ROOT}/160x45" "${OUT_ROOT}/100x30" "${OUT_ROOT}/70x24" "${OUT_ROOT}/_probe" "${OUT_ROOT}/test"
  mkdir -p "${OUT_ROOT}/160x45" "${OUT_ROOT}/100x30" "${OUT_ROOT}/70x24"

  log "binary=${BINARY}"
  log "project=${PROJECT_PATH}"
  log "port=${PORT}"
  log "session=${SESSION}"

  if [[ "$NO_IMAGES" == "1" ]]; then
    VHS_SKIP_REASON="disabled by TUI_SHOTS_NO_IMAGES=1"
  elif probe_vhs; then
    log "VHS available: ${VHS_BIN}"
  else
    log "VHS unavailable: ${VHS_SKIP_REASON}"
  fi

  local size
  for size in 160x45 100x30 70x24; do
    # Fresh port per size to avoid TIME_WAIT / leftover listeners.
    PORT="$(pick_free_port)"
    capture_screen_set_tmux "$size" "$PROJECT_PATH"
  done

  if (( VHS_OK )); then
    for size in 160x45 100x30 70x24; do
      PORT="$(pick_free_port)"
      if ! run_vhs_size "$size" "$PROJECT_PATH" "$PORT"; then
        err "VHS capture failed for ${size}"
        FAILURES=$((FAILURES + 1))
      fi
    done
  fi

  validate_outputs
  print_summary
}

main "$@"
