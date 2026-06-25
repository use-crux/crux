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
		"bundle.go",
		"stream.go",
		"client",
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

	forbiddenPaths := []string{
		"worker.go",
		"compiler",
	}
	for _, rel := range forbiddenPaths {
		if _, err := os.Stat(filepath.Join(hostDir, rel)); err == nil {
			t.Fatalf("Project Index host must not expose old all-in-one worker/compiler path %s", rel)
		} else if !os.IsNotExist(err) {
			t.Fatalf("stat forbidden Project Index host path %s: %v", rel, err)
		}
	}

	oldNativeDir := filepath.Join(hostDir, "native")
	if _, err := os.Stat(oldNativeDir); err == nil {
		t.Fatalf("old Static Index host package still exists at %s", oldNativeDir)
	} else if !os.IsNotExist(err) {
		t.Fatalf("stat old Static Index host package: %v", err)
	}
}
