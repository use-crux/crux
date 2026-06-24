package indexhost_test

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestIndexHostOwnsWorkerHostingLayout(t *testing.T) {
	t.Helper()

	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	hostDir := filepath.Dir(file)

	requiredPaths := []string{
		"worker.go",
		"stream.go",
		filepath.Join("native", "protocol"),
		filepath.Join("native", "staticcache"),
		filepath.Join("native", "staticcompile"),
		filepath.Join("native", "staticplan"),
		filepath.Join("native", "sourceprofile"),
		filepath.Join("native", "syntax"),
	}
	for _, rel := range requiredPaths {
		if _, err := os.Stat(filepath.Join(hostDir, rel)); err != nil {
			t.Fatalf("indexhost layout is missing %s: %v", rel, err)
		}
	}

	oldHostDir := filepath.Join(filepath.Dir(hostDir), "projectindexer")
	if _, err := os.Stat(oldHostDir); err == nil {
		t.Fatalf("old Go host package still exists at %s", oldHostDir)
	} else if !os.IsNotExist(err) {
		t.Fatalf("stat old Go host package: %v", err)
	}
}
