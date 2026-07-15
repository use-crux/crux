package devtools

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestGeneratedCatalogManifestIdentityReadsVerifiedDefaultArtifact(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, ".crux", "project-index.manifest.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, catalogManifestGolden(t), 0o644); err != nil {
		t.Fatal(err)
	}

	identity := generatedCatalogManifestIdentity(root)
	if identity == nil || identity.ProjectID != "manifest-fixture" || identity.ManifestID == "" {
		t.Fatalf("generated manifest identity = %+v", identity)
	}
	if err := os.WriteFile(path, []byte(`{"schemaVersion":1}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if identity := generatedCatalogManifestIdentity(root); identity != nil {
		t.Fatalf("invalid generated manifest became current: %+v", identity)
	}
}

func catalogManifestGolden(t *testing.T) []byte {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate devtools Catalog test")
	}
	path := filepath.Join(filepath.Dir(filename), "..", "..", "..", "indexer", "__tests__", "fixtures", "deployment-manifest-project", "manifest.golden.json")
	artifact, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return artifact
}
