package workers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	indexcache "github.com/use-crux/crux/packages/local/internal/projectindex/cache"
	projectservice "github.com/use-crux/crux/packages/local/internal/projectindex/service"
	staticcache "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/cache"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestProjectIndexRestartEvictsSourceDeletedWhileStopped(t *testing.T) {
	t.Setenv(staticcache.StatusEnv, "1")
	ctx := context.Background()
	root := t.TempDir()
	entryFile := writeStaticIndexPlanCacheFixtureFile(
		t, root, "src/entry.ts",
		"import './deleted'\nexport const stable = prompt({ id: 'offline-stable' })\n",
	)
	deletedFile := writeStaticIndexPlanCacheFixtureFile(
		t, root, "src/deleted.ts",
		"export const stale = prompt({ id: 'offline-deleted' })\n",
	)

	firstWorker := newTestWorker(t)
	firstWorker.WithSyntaxParser(&offlineDeletionCompiler{
		root: root, entryFile: entryFile, deletedFile: deletedFile,
	})
	firstService := newOfflineDeletionService(firstWorker, indexcache.NewSQLiteIndexFactStore())
	indexed, err := firstService.ReindexProjectWithOptions(
		ctx, root, "", "offline-deletion",
		projectservice.ProjectReindexOptions{Semantic: projectservice.ProjectSemanticDisabled},
	)
	if err != nil {
		t.Fatalf("initial ReindexProject error = %v", err)
	}
	assertOfflineDeletionFact(t, indexed, "prompt:offline-stable", entryFile, true)
	assertOfflineDeletionFact(t, indexed, "prompt:offline-deleted", deletedFile, true)
	if err := firstWorker.Close(); err != nil {
		t.Fatalf("close initial worker: %v", err)
	}

	if err := os.Remove(deletedFile); err != nil {
		t.Fatalf("remove indexed source %s: %v", deletedFile, err)
	}
	restartedWorker := newTestWorker(t)
	t.Cleanup(func() { _ = restartedWorker.Close() })
	restartedCompiler := &offlineDeletionCompiler{
		root: root, entryFile: entryFile, deletedFile: deletedFile,
	}
	restartedWorker.WithSyntaxParser(restartedCompiler)
	restartedService := newOfflineDeletionService(restartedWorker, indexcache.NewSQLiteIndexFactStore())
	refreshed, err := restartedService.ReindexProjectWithOptions(
		ctx, root, "", "offline-deletion",
		projectservice.ProjectReindexOptions{Semantic: projectservice.ProjectSemanticDisabled},
	)
	if err != nil {
		t.Fatalf("restarted ReindexProject error = %v", err)
	}
	assertOfflineDeletionFact(t, refreshed, "prompt:offline-stable", entryFile, true)
	assertOfflineDeletionFact(t, refreshed, "prompt:offline-deleted", deletedFile, false)
	if !slices.ContainsFunc(restartedCompiler.preparedFiles, func(file protocol.SourceFile) bool {
		return file.File == entryFile && file.CacheKey != ""
	}) {
		t.Fatalf("restarted prepared files = %+v, want surviving entry cache hit", restartedCompiler.preparedFiles)
	}
	if slices.ContainsFunc(restartedCompiler.preparedFiles, func(file protocol.SourceFile) bool {
		return file.File == deletedFile
	}) {
		t.Fatalf("restarted prepared files = %+v, want deleted source evicted", restartedCompiler.preparedFiles)
	}

	reloaded, ok, err := indexcache.NewSQLiteIndexFactStore().LoadSnapshot(
		ctx, root, "offline-deletion", time.Now(),
	)
	if err != nil || !ok {
		t.Fatalf("reload restarted snapshot = ok %v, error %v", ok, err)
	}
	assertOfflineDeletionFact(t, reloaded, "prompt:offline-stable", entryFile, true)
	assertOfflineDeletionFact(t, reloaded, "prompt:offline-deleted", deletedFile, false)
}

func newOfflineDeletionService(worker *Bundle, facts *indexcache.SQLiteIndexFactStore) *projectservice.Service {
	return projectservice.New(projectservice.Options{
		Store: store.NewStore(), Indexer: offlineDeletionASTIndexer{worker: worker},
		FactStore: facts, StrictCache: true,
	})
}

type offlineDeletionASTIndexer struct{ worker *Bundle }

func (i offlineDeletionASTIndexer) IndexProjectAstPatch(
	ctx context.Context, root, configPath, projectName string,
) (projectindex.IndexPatch, error) {
	return i.worker.IndexProjectAstPatch(ctx, root, configPath, projectName)
}

type offlineDeletionCompiler struct {
	root          string
	entryFile     string
	deletedFile   string
	preparedFiles []protocol.SourceFile
}

func (c *offlineDeletionCompiler) StaticIndexPrepare(
	_ context.Context, request protocol.PrepareRequest,
) (protocol.PrepareResponse, error) {
	c.preparedFiles = append([]protocol.SourceFile(nil), request.Files...)
	hits := []protocol.SourceFile{}
	misses := []protocol.SourceFile{}
	for _, file := range request.Files {
		if file.CacheKey == "" {
			misses = append(misses, file)
		} else {
			hits = append(hits, file)
		}
	}
	return protocol.PrepareResponse{
		ProtocolVersion: protocol.Version, Method: protocol.PrepareMethod,
		Plan: protocol.Plan{
			Root: request.Root, ProjectName: request.ProjectName,
			Files:        append([]protocol.SourceFile(nil), request.Files...),
			PrimaryFiles: append([]protocol.SourceFile(nil), request.PrimaryFiles...),
			CacheHits:    hits, CacheMisses: misses,
		},
		Diagnostics: []json.RawMessage{},
		Telemetry:   staticIndexTestTelemetry(len(request.Files), len(hits), len(misses), 0),
	}, nil
}

func (c *offlineDeletionCompiler) StaticIndexAnalyzeStream(
	_ context.Context, request protocol.AnalyzeRequest, handle protocol.AnalyzeStreamHandler,
) (protocol.AnalyzeResponse, error) {
	if !request.Stream {
		return protocol.AnalyzeResponse{}, fmt.Errorf("analyze stream flag = false, want true")
	}
	facts := []json.RawMessage{}
	for _, file := range request.Files {
		switch file.File {
		case c.entryFile:
			facts = append(facts, json.RawMessage(`{"kind":"definition","fact":{"id":"prompt:offline-stable"}}`))
		case c.deletedFile:
			facts = append(facts, json.RawMessage(`{"kind":"definition","fact":{"id":"prompt:offline-deleted"}}`))
		}
	}
	return staticIndexTestAnalyzeStream(protocol.AnalyzeResponse{
		ProtocolVersion: protocol.Version, Method: protocol.AnalyzeMethod,
		Facts: facts, Diagnostics: []json.RawMessage{}, ExtensionEvidenceJobs: []json.RawMessage{},
		Telemetry: staticIndexTestTelemetry(len(request.Plan.Files), len(request.Plan.CacheHits), len(request.Plan.CacheMisses), len(request.Files)),
	}, handle)
}

func (c *offlineDeletionCompiler) StaticIndexFinalize(
	_ context.Context, request protocol.FinalizeRequest,
) (protocol.FinalizeResponse, error) {
	includeEntry := false
	includeDeleted := false
	for _, fact := range request.NativeFacts {
		includeEntry = includeEntry || bytes.Contains(fact, []byte("prompt:offline-stable"))
		includeDeleted = includeDeleted || bytes.Contains(fact, []byte("prompt:offline-deleted"))
	}
	events, err := offlineDeletionEvents(
		c.root, c.entryFile, c.deletedFile, includeEntry, includeDeleted,
	)
	return protocol.FinalizeResponse{
		ProtocolVersion: protocol.Version, Method: protocol.FinalizeMethod,
		Events: events, Telemetry: staticIndexTestTelemetry(len(request.NativeFacts), 0, 0, 0),
	}, err
}

func (c *offlineDeletionCompiler) StaticIndexFinalizeStream(
	ctx context.Context, request protocol.FinalizeRequest, handle protocol.FinalizeStreamHandler,
) (protocol.FinalizeResponse, error) {
	if !request.Stream {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize stream flag = false, want true")
	}
	response, err := c.StaticIndexFinalize(ctx, request)
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return staticIndexTestFinalizeStream(response, handle)
}

func (c *offlineDeletionCompiler) ParseFile(context.Context, frontend.Request) (json.RawMessage, error) {
	return nil, fmt.Errorf("ParseFile should not be called by offline deletion regression")
}

func (c *offlineDeletionCompiler) Concurrency() int { return 1 }
func (c *offlineDeletionCompiler) Close() error     { return nil }

func offlineDeletionEvents(
	root, entryFile, deletedFile string, includeEntry, includeDeleted bool,
) ([]json.RawMessage, error) {
	facts := []any{}
	if includeEntry {
		facts = appendOfflineDeletionFacts(facts, root, entryFile, "prompt:offline-stable", "offline-stable")
	}
	if includeDeleted {
		facts = appendOfflineDeletionFacts(facts, root, deletedFile, "prompt:offline-deleted", "offline-deleted")
	}
	values := []any{
		map[string]any{"protocolVersion": 3, "type": "phase:start", "transactionId": "tx-offline-deletion", "phase": "ast", "root": root, "startedAt": "1970-01-01T00:00:00.000Z"},
		map[string]any{"protocolVersion": 3, "type": "fact:batch", "transactionId": "tx-offline-deletion", "sequence": 0, "facts": facts},
		map[string]any{
			"protocolVersion": 3, "type": "phase:done", "transactionId": "tx-offline-deletion", "phase": "ast",
			"patch":   map[string]any{"schemaVersion": 1, "phase": "ast", "project": map[string]any{"root": root, "name": "offline-deletion"}, "startedAt": "1970-01-01T00:00:00.000Z", "finishedAt": "1970-01-01T00:00:00.000Z", "status": "ok", "invalidates": map[string]any{"all": true}},
			"summary": map[string]any{"factCount": len(facts), "decision": map[string]any{"staticIndexComplete": true}},
		},
	}
	events := make([]json.RawMessage, 0, len(values))
	for _, value := range values {
		data, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		events = append(events, data)
	}
	return events, nil
}

func appendOfflineDeletionFacts(facts []any, root, file, definitionID, name string) []any {
	return append(facts,
		map[string]any{
			"schemaVersion": 1, "factId": "definitions:" + definitionID, "kind": "definitions", "phase": "ast", "projectRoot": root,
			"producer": map[string]any{"name": workerProducer, "version": "test"}, "fidelity": "authoritative",
			"provenance": map[string]any{"kind": "runtime", "attribute": "test.offlineDeletion"},
			"fact":       map[string]any{"id": definitionID, "kind": "prompt", "name": name, "fidelity": "resolved", "status": "active", "source": map[string]any{"file": file, "line": 1}},
		},
		map[string]any{
			"schemaVersion": 1, "factId": "sources:" + file, "kind": "sources", "phase": "ast", "projectRoot": root,
			"producer": map[string]any{"name": workerProducer, "version": "test"}, "fidelity": "authoritative",
			"provenance": map[string]any{"kind": "runtime", "attribute": "test.offlineDeletion"},
			"fact":       map[string]any{"file": file, "status": "indexed", "definitionIds": []string{definitionID}, "dependencies": []string{}},
		},
	)
}

func assertOfflineDeletionFact(
	t testing.TB, index store.IndexData, definitionID, sourceFile string, want bool,
) {
	t.Helper()
	hasDefinition := slices.ContainsFunc(index.Definitions, func(definition store.ProjectDefinition) bool {
		return definition.ID == definitionID
	})
	hasSource := slices.ContainsFunc(index.Sources, func(source store.IndexSourceFile) bool {
		return source.File == sourceFile
	})
	if hasDefinition != want || hasSource != want {
		t.Fatalf("%s definition=%v source=%v, want both %v", definitionID, hasDefinition, hasSource, want)
	}
}

var _ projectindex.ProjectIndexer = offlineDeletionASTIndexer{}
var _ frontend.Parser = (*offlineDeletionCompiler)(nil)
var _ StaticCompiler = (*offlineDeletionCompiler)(nil)
