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
	cmd := exec.Command("sh", "-c", `trap 'exit 0' TERM; sleep 60 & echo $! > "$1"; wait`, "runtime-worker-test", marker)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- superviseRuntimeWorkerProcess(ctx, cmd) }()

	childPID := waitForChildPID(t, marker)
	cancel()
	if err := <-done; err != nil {
		t.Fatalf("superviseRuntimeWorkerProcess() error = %v, want nil", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for processExists(childPID) && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if processExists(childPID) {
		t.Fatalf("child process %d survived Runtime worker shutdown", childPID)
	}
}

func TestRuntimeWorkerShutdownDeliveryFailureForcesImmediateStop(t *testing.T) {
	want := errors.New("shutdown delivery failed")
	cmd := exec.Command("sh", "-c", `trap '' TERM; while :; do sleep 1; done`)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	started := time.Now()
	err := superviseRuntimeWorkerProcessWithShutdown(ctx, cmd, func() error { return want })
	if !errors.Is(err, want) {
		t.Fatalf("superviseRuntimeWorkerProcessWithShutdown() error = %v, want %v", err, want)
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("shutdown delivery failure took %s, want immediate forced stop", elapsed)
	}
	if cmd.ProcessState == nil {
		t.Fatal("Runtime worker was not reaped after shutdown delivery failed")
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
