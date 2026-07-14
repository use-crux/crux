package oneshot

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	projectservice "github.com/use-crux/crux/packages/local/internal/projectindex/service"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestRunnerMatchesDaemonServicePipeline(t *testing.T) {
	for _, tc := range []struct {
		name        string
		semanticErr error
	}{
		{name: "static-semantic-suppressed-lint"},
		{name: "partial-semantic", semanticErr: errors.New("semantic unavailable")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			daemonIndexer := &parityIndexer{root: root, semanticErr: tc.semanticErr}
			daemon := devtools.NewService(store.NewStore(), nil).
				WithFactStore(noCacheStore{}).
				WithProjectIndexer(daemonIndexer)
			t.Cleanup(daemon.Shutdown)
			daemonIndex, err := daemon.ReindexProjectWithOptions(
				context.Background(), root, "crux.config.ts", "fixture",
				devtools.ProjectReindexOptions{Semantic: devtools.ProjectSemanticInline},
			)
			if err != nil {
				t.Fatal(err)
			}

			runner := New(&parityIndexer{root: root, semanticErr: tc.semanticErr}, noCacheStore{})
			result, err := runner.Run(context.Background(), Options{
				Root: root, ConfigPath: "crux.config.ts", ProjectID: "fixture",
			})
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(normalizedIndex(t, daemonIndex), normalizedIndex(t, result.Index)) {
				t.Fatalf("daemon and one-shot normalized indexes differ\ndaemon=%#v\none-shot=%#v", normalizedIndex(t, daemonIndex), normalizedIndex(t, result.Index))
			}
			if tc.semanticErr == nil && (len(result.Index.LintFindings) != 2 || !result.Index.LintFindings[1].Suppressed) {
				t.Fatalf("lint findings = %#v, want suppressed finding preserved", result.Index.LintFindings)
			}
			wantStatus := "complete"
			if tc.semanticErr != nil {
				wantStatus = "partial"
			}
			if result.Execution.Status != wantStatus {
				t.Fatalf("execution status = %q, want %q", result.Execution.Status, wantStatus)
			}
		})
	}
}

func TestRunnerMatchesDaemonConfigFailure(t *testing.T) {
	root := t.TempDir()
	indexer := &parityIndexer{root: root, configErr: errors.New("invalid crux config")}
	daemon := devtools.NewService(store.NewStore(), nil).
		WithFactStore(noCacheStore{}).
		WithProjectIndexer(indexer)
	t.Cleanup(daemon.Shutdown)
	_, daemonErr := daemon.ReindexProject(context.Background(), root, "broken.ts", "fixture")

	_, oneShotErr := New(&parityIndexer{root: root, configErr: indexer.configErr}, noCacheStore{}).
		Run(context.Background(), Options{Root: root, ConfigPath: "broken.ts", ProjectID: "fixture"})
	if daemonErr == nil || oneShotErr == nil || daemonErr.Error() != oneShotErr.Error() {
		t.Fatalf("daemon error = %v; one-shot error = %v", daemonErr, oneShotErr)
	}
}

func TestRunnerReportsWarmCacheHit(t *testing.T) {
	root := t.TempDir()
	cached := store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: "fixture"},
		IndexedAt:     "2026-07-14T00:00:00Z",
		Indexing:      store.ReadyIndexIndexingStatus("2026-07-14T00:00:00Z", 0, 1, 0, false),
	}
	result, err := New(&parityIndexer{root: root}, snapshotCacheStore{index: cached}).
		Run(context.Background(), Options{Root: root, ProjectID: "fixture"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Execution.Cache != "hit" {
		t.Fatalf("cache = %q, want hit", result.Execution.Cache)
	}
}

func TestRunnerRejectsCacheIntegrityFailureBeforeCompiling(t *testing.T) {
	indexer := &parityIndexer{root: t.TempDir()}
	_, err := New(indexer, failingCacheStore{err: errors.New("cache integrity mismatch")}).
		Run(context.Background(), Options{Root: indexer.root, ProjectID: "fixture"})
	if err == nil || !strings.Contains(err.Error(), "cache integrity mismatch") {
		t.Fatalf("error = %v, want cache integrity failure", err)
	}
}

type parityIndexer struct {
	root        string
	semanticErr error
	configErr   error
}

func (i *parityIndexer) IndexProjectAstPatch(_ context.Context, root, configPath, projectName string) (projectindex.IndexPatch, error) {
	if i.configErr != nil {
		return projectindex.IndexPatch{}, i.configErr
	}
	return parityPatch(root, configPath, projectName, projectindex.PhaseAST, projectindex.IndexPatchFacts{
		Definitions: []store.ProjectDefinition{{ID: "prompt:writer", Kind: "prompt", Name: "writer", Fidelity: "partial", Status: "active"}},
		Diagnostics: []store.IndexDiagnostic{{ID: "diagnostic:static", Severity: "info", Code: "static.partial", Message: "static evidence"}},
	}), nil
}

func (i *parityIndexer) IndexProjectSemanticPatch(_ context.Context, request projectindex.ProjectSemanticIndexRequest) (projectindex.IndexPatch, error) {
	if i.semanticErr != nil {
		return projectindex.IndexPatch{}, i.semanticErr
	}
	return parityPatch(request.Root, request.ConfigPath, request.ProjectName, projectindex.PhaseSemantic, projectindex.IndexPatchFacts{
		Definitions: []store.ProjectDefinition{{ID: "prompt:writer", Kind: "prompt", Name: "writer", Fidelity: "resolved", Status: "active"}},
		Relations:   []store.ProjectRelation{{ID: "prompt:writer:uses:tool:search", Type: "uses", From: "prompt:writer", To: "tool:search", Fidelity: "resolved"}},
	}), nil
}

func (i *parityIndexer) IndexProjectLintPatch(_ context.Context, request projectindex.ProjectLintIndexRequest) (projectindex.IndexPatch, error) {
	return parityPatch(request.Root, request.ConfigPath, request.ProjectName, projectindex.PhaseQuality, projectindex.IndexPatchFacts{
		LintFindings: []store.IndexLintFinding{
			{ID: "lint:visible", Severity: "warning", RuleID: "fixture.visible", Category: "fixture", Profiles: []string{"recommended"}},
			{ID: "lint:suppressed", Severity: "info", RuleID: "fixture.suppressed", Category: "fixture", Profiles: []string{"recommended"}, Suppressed: true},
		},
	}), nil
}

func parityPatch(root, configPath, projectName string, phase projectindex.IndexPatchPhase, facts projectindex.IndexPatchFacts) projectindex.IndexPatch {
	return projectindex.IndexPatch{SchemaVersion: 1, Phase: phase, Project: store.ProjectIdentity{Root: root, Name: projectName, ConfigFile: configPath}, Status: "ok", FinishedAt: "2026-07-14T00:00:00Z", Facts: facts}
}

type noCacheStore struct{}

func (noCacheStore) LoadSnapshot(context.Context, string, string, time.Time) (store.IndexData, bool, error) {
	return store.IndexData{}, false, nil
}
func (noCacheStore) CommitPhase(context.Context, projectindex.IndexFactTransaction) error { return nil }
func (noCacheStore) ProjectSnapshot(context.Context, string, string) (store.IndexData, bool, error) {
	return store.IndexData{}, false, nil
}

type snapshotCacheStore struct{ index store.IndexData }

func (s snapshotCacheStore) LoadSnapshot(context.Context, string, string, time.Time) (store.IndexData, bool, error) {
	return s.index, true, nil
}
func (snapshotCacheStore) CommitPhase(context.Context, projectindex.IndexFactTransaction) error {
	return nil
}
func (s snapshotCacheStore) ProjectSnapshot(context.Context, string, string) (store.IndexData, bool, error) {
	return s.index, true, nil
}

type failingCacheStore struct{ err error }

func (s failingCacheStore) LoadSnapshot(context.Context, string, string, time.Time) (store.IndexData, bool, error) {
	return store.IndexData{}, false, s.err
}
func (failingCacheStore) CommitPhase(context.Context, projectindex.IndexFactTransaction) error {
	return nil
}
func (failingCacheStore) ProjectSnapshot(context.Context, string, string) (store.IndexData, bool, error) {
	return store.IndexData{}, false, nil
}

func normalizedIndex(t *testing.T, index store.IndexData) any {
	t.Helper()
	data, err := json.Marshal(index)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatal(err)
	}
	delete(value, "indexedAt")
	if findings, ok := value["lintFindings"].([]any); ok {
		selected := findings[:0]
		for _, finding := range findings {
			fields, _ := finding.(map[string]any)
			if suppressed, _ := fields["suppressed"].(bool); !suppressed {
				selected = append(selected, finding)
			}
		}
		value["lintFindings"] = selected
	}
	if indexing, ok := value["indexing"].(map[string]any); ok {
		delete(indexing, "cache")
		for _, phase := range []string{"ast", "semantic"} {
			if status, ok := indexing[phase].(map[string]any); ok {
				delete(status, "indexedAt")
				delete(status, "durationMs")
			}
		}
	}
	return value
}

var _ projectservice.CacheStore = noCacheStore{}
