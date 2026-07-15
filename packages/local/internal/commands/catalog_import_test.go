package commands

import (
	"bytes"
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/projectindex/manifeststore"
)

func TestRunCatalogImportReportsImportedAndAlreadyPresent(t *testing.T) {
	store := manifeststore.New(t.TempDir())
	path := filepath.Join(t.TempDir(), "manifest.json")
	if err := writeFileAtomically(path, deploymentManifestGolden(t)); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"imported", "already-present"} {
		var stdout, stderr bytes.Buffer
		io := output.NewTestIO(&stdout, &stderr, output.TestIOOptions{})
		if err := runCatalogImport(context.Background(), io, store, path, true); err != nil {
			t.Fatalf("import: %v\nstderr: %s", err, stderr.String())
		}
		if !strings.Contains(stdout.String(), `"status": "`+want+`"`) {
			t.Fatalf("summary = %s, want %s", stdout.String(), want)
		}
	}
}

func TestRunCatalogImportRejectsInvalidArtifact(t *testing.T) {
	path := filepath.Join(t.TempDir(), "invalid.json")
	if err := writeFileAtomically(path, []byte(`{"schemaVersion":1}`)); err != nil {
		t.Fatal(err)
	}
	io := output.NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, output.TestIOOptions{})
	err := runCatalogImport(context.Background(), io, manifeststore.New(t.TempDir()), path, true)
	assertExitCode(t, err, 2)
}
