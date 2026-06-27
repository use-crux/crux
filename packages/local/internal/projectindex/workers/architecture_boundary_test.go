package workers_test

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestProjectIndexWorkersOwnWorkerHostingLayout(t *testing.T) {
	t.Helper()

	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	workersDir := filepath.Dir(file)

	requiredPaths := []string{
		"bundle.go",
		"stream.go",
		"source",
		"requestwire",
		"node",
		"runtime",
		"semantic",
	}
	for _, rel := range requiredPaths {
		if _, err := os.Stat(filepath.Join(workersDir, rel)); err != nil {
			t.Fatalf("Project Index workers layout is missing %s: %v", rel, err)
		}
	}

	// The old worker hosting names (the all-in-one worker/compiler files, the
	// shared "client" package, and the "indexwire" request package) must be
	// gone, not aliased.
	forbiddenPaths := []string{
		"worker.go",
		"compiler",
		"client",
		"indexwire",
		"native",
	}
	for _, rel := range forbiddenPaths {
		if _, err := os.Stat(filepath.Join(workersDir, rel)); err == nil {
			t.Fatalf("Project Index workers must not expose retired worker hosting path %s", rel)
		} else if !os.IsNotExist(err) {
			t.Fatalf("stat forbidden Project Index workers path %s: %v", rel, err)
		}
	}
}
