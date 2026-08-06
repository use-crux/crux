package workerproc

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func TestWaitForWindowsPIDRetriesPartialMarker(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "child.pid")
	if err := os.WriteFile(marker, []byte("1x"), 0o600); err != nil {
		t.Fatal(err)
	}
	go func() {
		time.Sleep(30 * time.Millisecond)
		_ = os.WriteFile(marker, []byte("42"), 0o600)
	}()

	if got := waitForWindowsPID(t, marker); got != 42 {
		t.Fatalf("waitForWindowsPID() = %d, want 42", got)
	}
}

func waitForWindowsPID(t *testing.T, marker string) uint32 {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		raw, err := os.ReadFile(marker)
		if err == nil {
			pid, parseErr := strconv.ParseUint(string(raw), 10, 32)
			if parseErr == nil {
				return uint32(pid)
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("valid descendant pid marker was not written")
	return 0
}
