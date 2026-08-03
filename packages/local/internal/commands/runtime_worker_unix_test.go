//go:build !windows

package commands

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestRuntimeWorkerCancellationStopsTheProcessGroup(t *testing.T) {
	marker := t.TempDir() + "/child.pid"
	cmd := exec.Command("sh", "-c", `sleep 60 & echo $! > "$1"; wait`, "runtime-worker-test", marker)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- superviseRuntimeWorkerProcess(ctx, cmd) }()

	childPID := waitForChildPID(t, marker)
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("superviseRuntimeWorkerProcess() error = %v, want context canceled", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for processExists(childPID) && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if processExists(childPID) {
		t.Fatalf("child process %d survived Runtime worker shutdown", childPID)
	}
}

func waitForChildPID(t *testing.T, marker string) int {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		raw, err := os.ReadFile(marker)
		if err == nil {
			pid, parseErr := strconv.Atoi(strings.TrimSpace(string(raw)))
			if parseErr != nil {
				t.Fatalf("parse child pid: %v", parseErr)
			}
			return pid
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("child pid marker was not written")
	return 0
}

func processExists(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || !errors.Is(err, syscall.ESRCH)
}
