package commands

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
)

func TestRunManifestWritesVerifiedArtifactAndStableJSONSummary(t *testing.T) {
	artifact := deploymentManifestGolden(t)
	outPath := filepath.Join(t.TempDir(), "nested", "manifest.json")
	var stdout, stderr bytes.Buffer
	io := output.NewTestIO(&stdout, &stderr, output.TestIOOptions{})
	err := runManifest(context.Background(), io, manifestOptions{
		root: t.TempDir(), projectID: "manifest-fixture", out: outPath, json: true,
	}, func(context.Context, manifestOptions) ([]byte, error) {
		return artifact, nil
	})
	if err != nil {
		t.Fatalf("runManifest: %v\nstderr: %s", err, stderr.String())
	}
	written, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(bytes.TrimSpace(written), bytes.TrimSpace(artifact)) {
		t.Fatal("written artifact differs from TypeScript artifact")
	}
	for _, want := range []string{`"schemaVersion": 1`, `"projectId": "manifest-fixture"`, `"manifestId": "pim_`} {
		if !strings.Contains(stdout.String(), want) {
			t.Fatalf("summary = %s, want %s", stdout.String(), want)
		}
	}
}

func TestRunManifestDoesNotReplaceValidArtifactAfterFailure(t *testing.T) {
	outPath := filepath.Join(t.TempDir(), "manifest.json")
	if err := os.WriteFile(outPath, []byte("previous-valid-artifact\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	io := output.NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, output.TestIOOptions{})
	err := runManifest(context.Background(), io, manifestOptions{
		root: t.TempDir(), projectID: "fixture", out: outPath,
	}, func(context.Context, manifestOptions) ([]byte, error) {
		return nil, errors.New("compiler failed")
	})
	assertExitCode(t, err, 2)
	written, readErr := os.ReadFile(outPath)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(written) != "previous-valid-artifact\n" {
		t.Fatalf("artifact = %q", written)
	}
}

func TestRunManifestRejectsInvalidArtifactBeforeReplacement(t *testing.T) {
	outPath := filepath.Join(t.TempDir(), "manifest.json")
	io := output.NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, output.TestIOOptions{})
	err := runManifest(context.Background(), io, manifestOptions{
		root: t.TempDir(), projectID: "fixture", out: outPath,
	}, func(context.Context, manifestOptions) ([]byte, error) {
		return []byte(`{"schemaVersion":1,"secret":"unsafe"}`), nil
	})
	assertExitCode(t, err, 2)
	if _, statErr := os.Stat(outPath); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("invalid artifact was written: %v", statErr)
	}
}

func assertExitCode(t *testing.T, err error, want int) {
	t.Helper()
	var exit domain.ExitError
	if !errors.As(err, &exit) || exit.Code != want {
		t.Fatalf("error = %v, want exit %d", err, want)
	}
}

func deploymentManifestGolden(t *testing.T) []byte {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate manifest test")
	}
	path := filepath.Join(filepath.Dir(filename), "..", "..", "..", "indexer", "__tests__", "fixtures", "deployment-manifest-project", "manifest.golden.json")
	artifact, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return artifact
}
