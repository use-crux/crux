package editorcmd

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDownloadOnlyNeverOverwritesDifferentBytes(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "crux-vscode-1.2.3.vsix")
	if err := os.WriteFile(path, []byte("existing"), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := writeDownloadedAsset(
		directory,
		"crux-vscode-1.2.3.vsix",
		[]byte("replacement"),
	)
	if err == nil || !strings.Contains(err.Error(), "refusing to overwrite") {
		t.Fatalf("error = %v", err)
	}
	actual, readErr := os.ReadFile(path)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(actual) != "existing" {
		t.Fatalf("existing bytes changed to %q", actual)
	}
}
