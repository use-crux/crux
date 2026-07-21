package projectroot

import (
	"os"
	"path/filepath"
	"testing"
)

func TestConfigFileFromMatchesCompilerConfigNamesAndOrdering(t *testing.T) {
	root := t.TempDir()
	writeConfig(t, filepath.Join(root, "crux.config.mjs"))
	writeConfig(t, filepath.Join(root, "crux.config.ts"))
	if got := ConfigFileFrom(root); got != filepath.Join(root, "crux.config.ts") {
		t.Fatalf("root config = %q, want TypeScript preference", got)
	}

	nestedRoot := t.TempDir()
	writeConfig(t, filepath.Join(nestedRoot, "packages", "app", "crux.config.js"))
	if got := ConfigFileFrom(nestedRoot); got != filepath.Join(nestedRoot, "packages", "app", "crux.config.js") {
		t.Fatalf("nested config = %q", got)
	}

	unsupportedRoot := t.TempDir()
	writeConfig(t, filepath.Join(unsupportedRoot, "crux.config.mts"))
	if got := ConfigFileFrom(unsupportedRoot); got != "" {
		t.Fatalf("unsupported config discovered as %q", got)
	}
}

func writeConfig(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("export default {}"), 0o600); err != nil {
		t.Fatal(err)
	}
}
