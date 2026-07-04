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
		"pnpm-workspace.yaml",
		"package.json",
		"pnpm-lock.yaml",
		"crux.config.js",
		"crux.config.mjs",
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
	if !pathInsideIgnoredDir(root, filepath.Join(root, ".crux", "cache", "index.json")) {
		t.Fatal(".crux path not ignored")
	}
	if !pathInsideIgnoredDir(root, filepath.Join(root, ".cache", "indexer", "state.json")) {
		t.Fatal(".cache path not ignored")
	}
	if !pathInsideIgnoredDir(root, filepath.Join(root, "generated", "client.ts")) {
		t.Fatal("generated path not ignored")
	}
	if !pathInsideIgnoredDir(root, filepath.Join(root, "crux.generated", "next.ts")) {
		t.Fatal("crux.generated path not ignored")
	}
	if !pathInsideIgnoredDir(root, filepath.Join(root, "convex", "_crux", "generated.ts")) {
		t.Fatal("convex/_crux path not ignored")
	}
	if pathInsideIgnoredDir(root, filepath.Join(root, "src", "prompt.ts")) {
		t.Fatal("src path ignored unexpectedly")
	}
}
