package projectindex_test

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestProjectIndexPackagesUseBoundedContextLayout(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("could not determine test file location")
	}

	projectIndexDir := filepath.Dir(filename)
	internalDir := filepath.Dir(projectIndexDir)

	expectedPackages := []string{
		"projectindex/cache",
		"projectindex/model",
		"projectindex/readmodel",
		"projectindex/service",
		"projectindex/wire",
	}
	for _, packagePath := range expectedPackages {
		if info, err := os.Stat(filepath.Join(internalDir, packagePath)); err != nil || !info.IsDir() {
			t.Fatalf("expected Project Index package %q to exist under internal/", packagePath)
		}
	}

	oldRoots := []string{
		"indexread",
		"indexservice",
		"projectindexstore",
		"projectindexwire",
	}
	for _, packagePath := range oldRoots {
		if _, err := os.Stat(filepath.Join(internalDir, packagePath)); !os.IsNotExist(err) {
			t.Fatalf("old Project Index package root %q must be moved under internal/projectindex/", packagePath)
		}
	}
}
