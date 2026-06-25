package node

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestScanLineHandlesMissingReader(t *testing.T) {
	result := scanLine(nil, defaultMaxResponseBytes)
	if result.err == nil {
		t.Fatal("scanLine(nil) error = nil, want stdout unavailable error")
	}
	if !strings.Contains(result.err.Error(), "stdout unavailable") {
		t.Fatalf("error = %q, want stdout unavailable", result.err)
	}
}

func TestScanLineRejectsOversizedResponse(t *testing.T) {
	reader := bufio.NewReader(strings.NewReader(strings.Repeat("x", 32) + "\n"))

	result := scanLine(reader, 8)

	if result.err == nil {
		t.Fatal("scanLine error = nil, want oversized response error")
	}
	if !strings.Contains(result.err.Error(), "response exceeded") {
		t.Fatalf("scanLine error = %v, want response exceeded", result.err)
	}
}

func TestWorkerCallTypedAndWorkerError(t *testing.T) {
	worker := New(Script{Name: "fake"}, WithCommand(shellPath(t), fakePersistentWorker(t)))
	defer worker.Close()

	resp, err := Call[struct {
		Value string `json:"value"`
	}](context.Background(), worker, map[string]string{"mode": "ok"})
	if err != nil {
		t.Fatalf("Call error = %v", err)
	}
	if resp.Value != "ok" {
		t.Fatalf("resp.Value = %q, want ok", resp.Value)
	}

	_, err = Call[struct{}](context.Background(), worker, map[string]string{"mode": "error"})
	var workerErr *WorkerError
	if !errors.As(err, &workerErr) {
		t.Fatalf("Call error = %T %v, want WorkerError", err, err)
	}
	if workerErr.Script != "fake" || workerErr.Message != "bad request" {
		t.Fatalf("WorkerError = %#v, want fake bad request", workerErr)
	}
}

func TestWorkerPrewarmStartsProcess(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "started")
	worker := New(Script{Name: "fake-prewarm"}, WithCommand(shellPath(t), fakePrewarmWorker(t), marker))
	defer worker.Close()

	if err := worker.Prewarm(context.Background()); err != nil {
		t.Fatalf("Prewarm error = %v", err)
	}
	waitForFile(t, marker)

	resp, err := Call[struct {
		Value string `json:"value"`
	}](context.Background(), worker, map[string]string{"mode": "ok"})
	if err != nil {
		t.Fatalf("Call error = %v", err)
	}
	if resp.Value != "ok" {
		t.Fatalf("resp.Value = %q, want ok", resp.Value)
	}
}

func TestWorkerKillsAndRespawnsAfterOversizedResponse(t *testing.T) {
	worker := New(Script{Name: "fake"}, WithMaxResponseBytes(32), WithCommand(shellPath(t), fakePersistentWorker(t)))
	defer worker.Close()

	_, err := CallRaw(context.Background(), worker, map[string]string{"mode": "large"})
	if err == nil || !strings.Contains(err.Error(), "response exceeded") {
		t.Fatalf("large CallRaw error = %v, want response exceeded", err)
	}

	resp, err := Call[struct {
		Value string `json:"value"`
	}](context.Background(), worker, map[string]string{"mode": "ok"})
	if err != nil {
		t.Fatalf("second Call error = %v, want respawn success", err)
	}
	if resp.Value != "ok" {
		t.Fatalf("resp.Value = %q, want ok", resp.Value)
	}
}

func TestWorkerCancellationKillsAndRespawns(t *testing.T) {
	worker := New(Script{Name: "fake"}, WithCommand(shellPath(t), fakePersistentWorker(t)))
	defer worker.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := CallRaw(ctx, worker, map[string]string{"mode": "slow"})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("slow CallRaw error = %v, want deadline exceeded", err)
	}

	resp, err := Call[struct {
		Value string `json:"value"`
	}](context.Background(), worker, map[string]string{"mode": "ok"})
	if err != nil {
		t.Fatalf("second Call error = %v, want respawn success", err)
	}
	if resp.Value != "ok" {
		t.Fatalf("resp.Value = %q, want ok", resp.Value)
	}
}

func TestWorkerEOFRespawnsOnNextCall(t *testing.T) {
	worker := New(Script{Name: "fake"}, WithCommand(shellPath(t), fakePersistentWorker(t)))
	defer worker.Close()

	_, err := CallRaw(context.Background(), worker, map[string]string{"mode": "crash"})
	if err == nil || !strings.Contains(err.Error(), "no output") {
		t.Fatalf("crash CallRaw error = %v, want no output EOF", err)
	}

	resp, err := Call[struct {
		Value string `json:"value"`
	}](context.Background(), worker, map[string]string{"mode": "ok"})
	if err != nil {
		t.Fatalf("second Call error = %v, want respawn success", err)
	}
	if resp.Value != "ok" {
		t.Fatalf("resp.Value = %q, want ok", resp.Value)
	}
}

func TestWorkerCloseWaitsCleanly(t *testing.T) {
	worker := New(Script{Name: "fake"}, WithCommand(shellPath(t), fakePersistentWorker(t)))

	if _, err := CallRaw(context.Background(), worker, map[string]string{"mode": "ok"}); err != nil {
		t.Fatalf("CallRaw error = %v", err)
	}
	if err := worker.Close(); err != nil {
		t.Fatalf("Close error = %v", err)
	}
	if err := worker.Close(); err != nil {
		t.Fatalf("second Close error = %v", err)
	}
}

func TestStreamDeliversEventsAndCapturesExitErr(t *testing.T) {
	var events []string
	result, err := Stream(context.Background(), OneShot{
		CommandPath: shellPath(t),
		CommandArgs: []string{fakeStreamWorker(t)},
	}, func(raw json.RawMessage) error {
		var event struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(raw, &event); err != nil {
			t.Fatalf("unmarshal event: %v", err)
		}
		events = append(events, event.Type)
		return nil
	})
	if err != nil {
		t.Fatalf("Stream error = %v", err)
	}
	if result.ExitErr == nil {
		t.Fatal("Stream ExitErr = nil, want nonzero exit")
	}
	if !strings.Contains(result.Stderr, "stream stderr") {
		t.Fatalf("Stream stderr = %q, want captured stderr", result.Stderr)
	}
	if strings.Join(events, ",") != "first,second" {
		t.Fatalf("events = %v, want first,second", events)
	}
}

func TestStreamCallSessionSendsGeneratedRequests(t *testing.T) {
	worker := New(Script{Name: "fake-session"}, WithCommand(shellPath(t), fakeSessionWorker(t)))
	defer worker.Close()

	var events []string
	err := StreamCallSession(
		context.Background(),
		worker,
		func(send StreamSender) error {
			if err := send(map[string]string{"kind": "start"}); err != nil {
				return err
			}
			if err := send(RawJSONLine(`{"kind":"chunk"}`)); err != nil {
				return err
			}
			return send(map[string]string{"kind": "done"})
		},
		func(raw json.RawMessage) (bool, error) {
			var event struct {
				Type string `json:"type"`
			}
			if err := json.Unmarshal(raw, &event); err != nil {
				return false, err
			}
			events = append(events, event.Type)
			return event.Type == "done", nil
		},
	)
	if err != nil {
		t.Fatalf("StreamCallSession error = %v", err)
	}
	if strings.Join(events, ",") != "summary,done" {
		t.Fatalf("events = %v, want summary,done", events)
	}
}

func TestStreamCancellationKillsProcess(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	start := time.Now()
	_, err := Stream(ctx, OneShot{
		CommandPath: shellPath(t),
		CommandArgs: []string{fakeSlowStreamWorker(t)},
	}, func(json.RawMessage) error {
		t.Fatal("unexpected event")
		return nil
	})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Stream error = %v, want deadline exceeded", err)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("Stream took %s, want bounded cancellation", elapsed)
	}
}

func fakePersistentWorker(t *testing.T) string {
	t.Helper()
	script := `while IFS= read -r line; do
case "$line" in
  *slow*) sleep 10 ;;
  *crash*) exit 3 ;;
  *error*) printf '{"error":"bad request"}\n' ;;
  *large*) printf '{"value":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}\n' ;;
  *) printf '{"value":"ok"}\n' ;;
esac
done
`
	return writeShellScript(t, "persistent-worker.sh", script)
}

func fakePrewarmWorker(t *testing.T) string {
	t.Helper()
	script := `printf started > "$1"
while IFS= read -r line; do
  printf '{"value":"ok"}\n'
done
`
	return writeShellScript(t, "prewarm-worker.sh", script)
}

func fakeStreamWorker(t *testing.T) string {
	t.Helper()
	script := `printf '{"type":"first"}\n'
printf 'not-json\n'
printf '{"type":"second"}\n'
printf 'stream stderr\n' >&2
exit 7
`
	return writeShellScript(t, "stream-worker.sh", script)
}

func fakeSessionWorker(t *testing.T) string {
	t.Helper()
	script := `count=0
while IFS= read -r line; do
  count=$((count + 1))
  case "$line" in
    *done*)
      printf '{"type":"summary","count":%s}\n' "$count"
      printf '{"type":"done"}\n'
      ;;
  esac
done
`
	return writeShellScript(t, "session-worker.sh", script)
}

func fakeSlowStreamWorker(t *testing.T) string {
	t.Helper()
	return writeShellScript(t, "slow-stream-worker.sh", "sleep 10\n")
}

func writeShellScript(t *testing.T, name string, script string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell script subprocess tests require a POSIX shell")
	}
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
	return path
}

func shellPath(t *testing.T) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell script subprocess tests require a POSIX shell")
	}
	return "/bin/sh"
}

func waitForFile(t *testing.T, path string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for {
		if _, err := os.Stat(path); err == nil {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("file %s was not created", path)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
