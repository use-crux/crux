//go:build linux

package assets

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInstallAnydocRuntimeRejectsTamperedTreeAndReattestsFiles(t *testing.T) {
	t.Setenv("CRUX_CACHE_DIR", t.TempDir())
	runtime, err := InstallAnydocRuntime(embeddedAnydocRuntime)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(runtime.Root(), 0o700) })
	if info, err := os.Stat(runtime.Runner()); err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0o444 {
		t.Fatalf("runner = %#v, %v", info, err)
	}
	runner := filepath.Join(runtime.Root(), "runner.mjs")
	if err := os.Chmod(runner, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(runner, []byte("tampered"), 0o400); err != nil {
		t.Fatal(err)
	}
	if _, err := InstallAnydocRuntime(embeddedAnydocRuntime); err == nil {
		t.Fatal("tampered runtime accepted")
	}
}

func TestResolveAnydocNodeRejectsGroupWritableExecutable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "node")
	if err := os.WriteFile(path, []byte("node"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o775); err != nil {
		t.Fatal(err)
	}
	if _, err := resolveAnydocNode(func() (string, error) { return path, nil }); err == nil {
		t.Fatal("group-writable node accepted")
	}
}
