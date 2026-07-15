package observability

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/manifeststore"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestHistoricalManifestResolutionStatesAndRollback(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	manifests := manifeststore.New(root)
	v1 := readResolutionFixture(t, "testdata", "manifest-v1.json")
	v2 := bytes.Replace(
		readResolutionFixture(t, "..", "..", "..", "indexer", "__tests__", "fixtures", "deployment-manifest-project", "manifest.golden.json"),
		[]byte(`"projectId": "manifest-fixture"`), []byte(`"projectId": "fixture"`), 1,
	)
	for _, artifact := range [][]byte{v1, v2} {
		if _, err := manifests.Import(ctx, artifact); err != nil {
			t.Fatal(err)
		}
	}

	service := newTestService(t).WithManifestStore(manifests)
	runs := []struct {
		id, manifestID, definitionID string
		want                         ManifestResolutionState
	}{
		{"run-v1", "pim_15b48ab7fa9b323034d77aec99352109ae2a5ad1185b1f8adbd5821a7bb9c866", "prompt:writer", ManifestResolved},
		{"run-v2", "pim_2ef1edd97de11a9af98749673d3e44fb90e28bc8ae61df42d6b7ba26dbc52329", "context:資料", ManifestResolved},
		{"run-definition-missing", "pim_15b48ab7fa9b323034d77aec99352109ae2a5ad1185b1f8adbd5821a7bb9c866", "prompt:missing", ManifestDefinitionUnresolved},
		{"run-manifest-missing", "pim_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "prompt:writer", ManifestUnresolved},
	}
	for index, row := range runs {
		mustIngest(t, service, runStartDeploymentJSON(row.id, index+1, "fixture", row.manifestID, row.definitionID))
		resolution, err := service.ResolveRunManifest(ctx, row.id, "fixture")
		if err != nil {
			t.Fatal(err)
		}
		if resolution.Resolution != row.want {
			t.Fatalf("%s resolution = %q, want %q", row.id, resolution.Resolution, row.want)
		}
	}

	mustIngest(t, service, runStartWithRefsJSON("record-unspecified", "run-unspecified", "segment-unspecified", 1, "2026-01-01T00:00:00.000Z", definitionRefJSON("prompt:writer", "prompt", "resolved-prompt")))
	unspecified, err := service.ResolveRunManifest(ctx, "run-unspecified", "fixture")
	if err != nil || unspecified.Resolution != ManifestUnspecified {
		t.Fatalf("unspecified = %#v, %v", unspecified, err)
	}
	mismatch, err := service.ResolveRunManifest(ctx, "run-v1", "another-project")
	if err != nil || mismatch.Resolution != ManifestProjectMismatch {
		t.Fatalf("mismatch = %#v, %v", mismatch, err)
	}

	detail, err := service.RunDetail(ctx, "run-v2")
	if err != nil {
		t.Fatal(err)
	}
	if detail.Manifest == nil || detail.Manifest.Resolution != ManifestResolved || detail.Manifest.ManifestID != runs[1].manifestID {
		t.Fatalf("run detail manifest = %#v", detail.Manifest)
	}
}

func TestHistoricalManifestResolutionSurvivesServiceRestart(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	manifests := manifeststore.New(root)
	artifacts := [][]byte{
		readResolutionFixture(t, "testdata", "manifest-v1.json"),
		bytes.Replace(
			readResolutionFixture(t, "..", "..", "..", "indexer", "__tests__", "fixtures", "deployment-manifest-project", "manifest.golden.json"),
			[]byte(`"projectId": "manifest-fixture"`), []byte(`"projectId": "fixture"`), 1,
		),
	}
	for _, artifact := range artifacts {
		if _, err := manifests.Import(ctx, artifact); err != nil {
			t.Fatal(err)
		}
	}

	databasePath := filepath.Join(root, ".crux", "observability.sqlite")
	service, err := OpenService(ctx, databasePath)
	if err != nil {
		t.Fatal(err)
	}
	service.WithManifestStore(manifests)
	mustIngest(t, service, runStartDeploymentJSON("run-before-restart", 1, "fixture", "pim_15b48ab7fa9b323034d77aec99352109ae2a5ad1185b1f8adbd5821a7bb9c866", "prompt:writer"))
	mustIngest(t, service, runStartDeploymentJSON("run-unknown-before-restart", 2, "fixture", "pim_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "prompt:writer"))
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenService(ctx, databasePath)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	reopened.WithManifestStore(manifeststore.New(root))

	resolved, err := reopened.ResolveRunManifest(ctx, "run-before-restart", "fixture")
	if err != nil || resolved.Resolution != ManifestResolved {
		t.Fatalf("resolved after restart = %#v, %v", resolved, err)
	}
	unknown, err := reopened.ResolveRunManifest(ctx, "run-unknown-before-restart", "fixture")
	if err != nil || unknown.Resolution != ManifestUnresolved {
		t.Fatalf("unknown after restart = %#v, %v", unknown, err)
	}
}

func TestCurrentCatalogComparisonIsSeparatelyLabeled(t *testing.T) {
	comparison := CompareCurrentCatalog(
		[]DefinitionRef{{ID: "prompt:writer"}, {ID: "prompt:deleted"}},
		store.IndexData{
			Project:     &store.ProjectIdentity{Name: "workspace-display-name"},
			Definitions: []store.ProjectDefinition{{ID: "prompt:writer"}},
		},
	)
	if comparison.Label != "current-catalog" || comparison.Resolution != ManifestDefinitionUnresolved {
		t.Fatalf("comparison = %#v", comparison)
	}
	if comparison.ProjectID != "" {
		t.Fatalf("comparison inferred stable project ID from display name: %#v", comparison)
	}
	if len(comparison.Definitions) != 2 || !comparison.Definitions[0].Matched || comparison.Definitions[1].Matched {
		t.Fatalf("definitions = %#v", comparison.Definitions)
	}
}

func runStartDeploymentJSON(runID string, seq int, projectID, manifestID, definitionID string) string {
	return fmt.Sprintf(`{"schemaVersion":3,"recordId":"record-%s","type":"run:start","runId":%q,"segmentId":"segment-%d","segmentSeq":1,"name":"manifest","rootPrimitive":"run","startedAt":"2026-01-01T00:00:00.000Z","status":"running","deployment":{"projectId":%q,"manifestId":%q},"definitionRefs":[{"id":%q,"kind":"prompt","role":"resolved-prompt"}]}`,
		runID, runID, seq, projectID, manifestID, definitionID)
}

func readResolutionFixture(t *testing.T, parts ...string) []byte {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate manifest resolution fixture")
	}
	artifact, err := os.ReadFile(filepath.Join(append([]string{filepath.Dir(filename)}, parts...)...))
	if err != nil {
		t.Fatal(err)
	}
	return artifact
}
