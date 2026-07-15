package manifeststore

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestImportIsImmutableIdempotentAndRestartSafe(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	artifact := manifestGolden(t)
	first, err := New(root).Import(ctx, artifact)
	if err != nil {
		t.Fatal(err)
	}
	if first.Status != "imported" {
		t.Fatalf("status = %q", first.Status)
	}
	second, err := New(root).Import(ctx, artifact)
	if err != nil {
		t.Fatal(err)
	}
	if second.Status != "already-present" {
		t.Fatalf("status = %q", second.Status)
	}
	manifest, found, err := New(root).Get(ctx, first.Manifest.ProjectID, first.Manifest.ManifestID)
	if err != nil || !found {
		t.Fatalf("Get() = found %v, error %v", found, err)
	}
	if manifest.ManifestID != first.Manifest.ManifestID {
		t.Fatalf("manifest = %#v", manifest)
	}
}

func TestImportRejectsTupleCollision(t *testing.T) {
	ctx := context.Background()
	store := New(t.TempDir())
	artifact := manifestGolden(t)
	parsed, err := store.parseVerified(artifact)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.insertFixture(ctx, parsed.ProjectID, parsed.ManifestID, []byte(`{"schemaVersion":1}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Import(ctx, artifact); err == nil {
		t.Fatal("tuple collision unexpectedly imported")
	}
}

func TestCurrentEpochDoesNotReuseLegacyStore(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, ".crux", "catalog", "manifests-v0.sqlite")
	if err := os.MkdirAll(filepath.Dir(legacy), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacy, []byte("stale"), 0o600); err != nil {
		t.Fatal(err)
	}
	count, err := New(root).Count(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("count = %d, want zero", count)
	}
}

func TestSoleIdentityIsCurrentOnlyWhileUnambiguous(t *testing.T) {
	ctx := context.Background()
	store := New(t.TempDir())
	if _, found, err := store.SoleIdentity(ctx); err != nil || found {
		t.Fatalf("empty sole identity = found:%v err:%v", found, err)
	}
	artifact := manifestGolden(t)
	first, err := store.Import(ctx, artifact)
	if err != nil {
		t.Fatal(err)
	}
	identity, found, err := store.SoleIdentity(ctx)
	if err != nil || !found || identity.ProjectID != first.Manifest.ProjectID || identity.ManifestID != first.Manifest.ManifestID {
		t.Fatalf("sole identity = %+v found:%v err:%v", identity, found, err)
	}
	second := first.Manifest
	second.ProjectID = "another-project"
	secondArtifact, err := json.Marshal(second)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Import(ctx, secondArtifact); err != nil {
		t.Fatal(err)
	}
	if _, found, err := store.SoleIdentity(ctx); err != nil || found {
		t.Fatalf("ambiguous sole identity = found:%v err:%v", found, err)
	}
}

func TestStoreRejectsUnexpectedSchemaEpoch(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	store := New(root)
	if _, err := store.Count(ctx); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(root, ".crux", "catalog", "manifests-v1.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `PRAGMA user_version = 99`); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	if _, err := store.Count(ctx); err == nil {
		t.Fatal("future manifest-store epoch unexpectedly opened")
	}
}

func manifestGolden(t *testing.T) []byte {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate manifest store test")
	}
	path := filepath.Join(filepath.Dir(filename), "..", "..", "..", "..", "indexer", "__tests__", "fixtures", "deployment-manifest-project", "manifest.golden.json")
	artifact, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return artifact
}
