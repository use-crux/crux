package host_test

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestProjectIndexHostOwnsWorkerHostingLayout(t *testing.T) {
	t.Helper()

	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	hostDir := filepath.Dir(file)

	requiredPaths := []string{
		"worker.go",
		"stream.go",
		"client",
		"compiler",
		"indexwire",
		"node",
		"runtime",
		"semantic",
	}
	for _, rel := range requiredPaths {
		if _, err := os.Stat(filepath.Join(hostDir, rel)); err != nil {
			t.Fatalf("Project Index host layout is missing %s: %v", rel, err)
		}
	}

	oldNativeDir := filepath.Join(hostDir, "native")
	if _, err := os.Stat(oldNativeDir); err == nil {
		t.Fatalf("old Static Index host package still exists at %s", oldNativeDir)
	} else if !os.IsNotExist(err) {
		t.Fatalf("stat old Static Index host package: %v", err)
	}
}
