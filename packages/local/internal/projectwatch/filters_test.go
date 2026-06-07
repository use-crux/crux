package projectwatch

import (
	"path/filepath"
	"testing"
)

func TestShouldWatchSourceAndBoundaryFiles(t *testing.T) {
	for _, path := range []string{
		"src/prompt.ts",
		"src/tool.tsx",
		"src/config.mjs",
		"package.json",
		"pnpm-lock.yaml",
		"crux.config.ts",
		"tsconfig.json",
	} {
		if !shouldWatchFile(path) {
			t.Fatalf("shouldWatchFile(%q) = false, want true", path)
		}
	}
}

func TestShouldIgnoreGeneratedAndHiddenFiles(t *testing.T) {
	for _, path := range []string{
		"README.md",
		".env",
		"src/image.png",
		"src/generated.wasm",
	} {
		if shouldWatchFile(path) {
			t.Fatalf("shouldWatchFile(%q) = true, want false", path)
		}
	}
}

func TestPathInsideIgnoredDir(t *testing.T) {
	root := filepath.Join("repo")
	if !pathInsideIgnoredDir(root, filepath.Join(root, "node_modules", "pkg", "index.ts")) {
		t.Fatal("node_modules path not ignored")
	}
	if !pathInsideIgnoredDir(root, filepath.Join(root, ".crux", "cache", "catalog.json")) {
		t.Fatal(".crux path not ignored")
	}
	if pathInsideIgnoredDir(root, filepath.Join(root, "src", "prompt.ts")) {
		t.Fatal("src path ignored unexpectedly")
	}
}
