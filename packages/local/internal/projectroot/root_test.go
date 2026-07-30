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

func TestDirFromStopsAtNearestConfigOrPackageBoundary(t *testing.T) {
	workspace := t.TempDir()
	writeConfig(t, filepath.Join(workspace, "crux.config.ts"))
	writeConfig(t, filepath.Join(workspace, "packages", "configured", "crux.config.js"))
	writePackage(t, filepath.Join(workspace, "packages", "configured", "package.json"))
	writePackage(t, filepath.Join(workspace, "packages", "plain", "package.json"))

	tests := []struct {
		name  string
		start string
		want  string
	}{
		{
			name:  "near package beats workspace config",
			start: filepath.Join(workspace, "packages", "plain", "src"),
			want:  filepath.Join(workspace, "packages", "plain"),
		},
		{
			name:  "config wins at same boundary",
			start: filepath.Join(workspace, "packages", "configured", "src"),
			want:  filepath.Join(workspace, "packages", "configured"),
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := DirFrom(test.start); got != test.want {
				t.Fatalf("DirFrom(%q) = %q, want %q", test.start, got, test.want)
			}
		})
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

func writePackage(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"private":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
}
