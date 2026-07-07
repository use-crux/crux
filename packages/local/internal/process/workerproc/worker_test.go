package workerproc

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

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

func TestWorkerCloseKillsProcessThatIgnoresStdinClose(t *testing.T) {
	worker := New(Script{Name: "fake-stubborn"}, WithCommand(shellPath(t), fakeStubbornWorker(t)))

	if _, err := CallRaw(context.Background(), worker, map[string]string{"mode": "ok"}); err != nil {
		t.Fatalf("CallRaw error = %v", err)
	}
	started := time.Now()
	err := worker.Close()
	if err == nil || !strings.Contains(err.Error(), "close timed out") {
		t.Fatalf("Close error = %v, want bounded forced-kill error", err)
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("Close took %s, want bounded shutdown", elapsed)
	}
}
