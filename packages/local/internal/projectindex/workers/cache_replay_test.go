package workers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/cache"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestWorkerStaticIndexReplaysWarmStaticCacheFacts(t *testing.T) {
	t.Setenv(cache.StatusEnv, "1")

	root := t.TempDir()
	sourceFile := writeStaticIndexPlanCacheFixtureFile(
		t,
		root,
		"src/writer.ts",
		"import { support } from './support'\nexport const writer = prompt({ id: support })\n",
	)
	supportFile := writeStaticIndexPlanCacheFixtureFile(t, root, "src/support.ts", "export const support = 'cached-writer'\n")
	configFile := writeStaticIndexConfig(t, root)

	cacheKey := "static-cache-key:cached-writer"
	writeStaticIndexReplayCacheFile(t, root, cacheKey, map[string]any{
		"file": sourceFile,
		"definitions": []map[string]any{{
			"id":       "prompt:cached-writer",
			"kind":     "prompt",
			"name":     "cached-writer",
			"fidelity": "resolved",
			"status":   "active",
			"source":   map[string]any{"file": sourceFile, "line": 1},
		}},
		"relations":    []map[string]any{},
		"dependencies": []string{supportFile},
		"diagnostics":  []map[string]any{},
	})
	configCacheKey := "static-cache-key:crux-config"
	writeStaticIndexReplayCacheFile(t, root, configCacheKey, map[string]any{
		"file":         configFile,
		"definitions":  []map[string]any{},
		"relations":    []map[string]any{},
		"dependencies": []string{},
		"diagnostics":  []map[string]any{},
	})
	writeStaticIndexPlanCacheManifest(t, root, map[string]any{
		"version":    cache.Epoch,
		"root":       root,
		"file":       "src/writer.ts",
		"sourceHash": staticIndexPlanCacheFixtureHash(t, sourceFile),
		"dependencies": []map[string]string{{
			"file":       "src/support.ts",
			"sourceHash": staticIndexPlanCacheFixtureHash(t, supportFile),
		}},
		"configFiles":    []map[string]string{},
		"compilerInputs": staticIndexPlanCacheCompilerInputsFixture(t),
		"cacheKey":       cacheKey,
	})
	writeStaticIndexPlanCacheManifest(t, root, map[string]any{
		"version":        cache.Epoch,
		"root":           root,
		"file":           "crux.config.ts",
		"sourceHash":     staticIndexPlanCacheFixtureHash(t, configFile),
		"dependencies":   []map[string]string{},
		"configFiles":    []map[string]string{},
		"compilerInputs": staticIndexPlanCacheCompilerInputsFixture(t),
		"cacheKey":       configCacheKey,
	})

	compiler := &staticIndexCacheReplayCompiler{root: root}
	worker := newTestWorker(t)
	worker.WithSyntaxParser(compiler)
	defer worker.Close()

	patch, err := worker.IndexProjectAstPatch(context.Background(), root, "", "static-index-cache-replay")
	if err != nil {
		t.Fatalf("IndexProjectAstPatch error = %v", err)
	}
	if len(patch.Facts.Definitions) != 1 || patch.Facts.Definitions[0].ID != "prompt:cached-writer" {
		t.Fatalf("definitions = %+v, want cached writer definition", patch.Facts.Definitions)
	}
	if len(compiler.analyzeFiles) != 0 {
		t.Fatalf("analyze files = %+v, want full warm cache hit to skip Rust analyze inputs", compiler.analyzeFiles)
	}
	if !compiler.finalizeSawCachedWriter {
		t.Fatalf("finalize native facts = %s, want cached writer fact replayed", compiler.finalizeNativeFacts)
	}
}

type staticIndexCacheReplayCompiler struct {
	root                    string
	analyzeFiles            []protocol.AnalyzeFile
	finalizeNativeFacts     []json.RawMessage
	finalizeSawCachedWriter bool
}

func (c *staticIndexCacheReplayCompiler) StaticIndexPrepare(_ context.Context, request protocol.PrepareRequest) (protocol.PrepareResponse, error) {
	hits := []protocol.SourceFile{}
	misses := []protocol.SourceFile{}
	for _, file := range request.Files {
		if file.CacheKey != "" {
			hits = append(hits, file)
		} else {
			misses = append(misses, file)
		}
	}
	return protocol.PrepareResponse{
		ProtocolVersion: protocol.Version,
		Method:          protocol.PrepareMethod,
		Plan: protocol.Plan{
			Root:                     request.Root,
			ProjectName:              request.ProjectName,
			Files:                    append([]protocol.SourceFile(nil), request.Files...),
			PrimaryFiles:             append([]protocol.SourceFile(nil), request.PrimaryFiles...),
			CacheHits:                hits,
			CacheMisses:              misses,
			CallNames:                append([]string(nil), request.CallNames...),
			CallInterests:            append([]frontend.CallInterest(nil), request.CallInterests...),
			ConstructorNames:         append([]string(nil), request.ConstructorNames...),
			ConstructorInterests:     append([]frontend.ConstructorInterest(nil), request.ConstructorInterests...),
			PruneNativeFactCallNames: append([]string(nil), request.PruneNativeFactCallNames...),
		},
		Diagnostics: []json.RawMessage{},
		Telemetry:   staticIndexTestTelemetry(len(request.Files), len(hits), len(misses), 0),
	}, nil
}

func (c *staticIndexCacheReplayCompiler) StaticIndexAnalyzeStream(_ context.Context, request protocol.AnalyzeRequest, handle protocol.AnalyzeStreamHandler) (protocol.AnalyzeResponse, error) {
	c.analyzeFiles = append([]protocol.AnalyzeFile(nil), request.Files...)
	if !request.Stream {
		return protocol.AnalyzeResponse{}, fmt.Errorf("analyze stream flag = false, want true")
	}
	if len(request.Files) != 0 {
		return protocol.AnalyzeResponse{}, fmt.Errorf("full warm cache hit should not analyze files: %+v", request.Files)
	}
	return staticIndexTestAnalyzeStream(protocol.AnalyzeResponse{
		ProtocolVersion:       protocol.Version,
		Method:                protocol.AnalyzeMethod,
		Facts:                 []json.RawMessage{},
		Diagnostics:           []json.RawMessage{},
		ExtensionEvidenceJobs: []json.RawMessage{},
		Telemetry:             staticIndexTestTelemetry(len(request.Plan.Files), len(request.Plan.CacheHits), len(request.Plan.CacheMisses), len(request.Files)),
	}, handle)
}

func (c *staticIndexCacheReplayCompiler) StaticIndexFinalize(_ context.Context, request protocol.FinalizeRequest) (protocol.FinalizeResponse, error) {
	c.finalizeNativeFacts = append([]json.RawMessage(nil), request.NativeFacts...)
	for _, fact := range request.NativeFacts {
		if bytes.Contains(fact, []byte("prompt:cached-writer")) {
			c.finalizeSawCachedWriter = true
			break
		}
	}
	if !c.finalizeSawCachedWriter {
		return protocol.FinalizeResponse{}, fmt.Errorf("missing cached writer fact in native finalize input")
	}
	events, err := staticIndexCacheReplayEvents(c.root, "static-index-cache-replay")
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return protocol.FinalizeResponse{
		ProtocolVersion: protocol.Version,
		Method:          protocol.FinalizeMethod,
		Events:          events,
		Telemetry:       staticIndexTestTelemetry(len(request.NativeFacts), 1, 0, 0),
	}, nil
}

func (c *staticIndexCacheReplayCompiler) StaticIndexFinalizeStream(ctx context.Context, request protocol.FinalizeRequest, handle protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error) {
	if !request.Stream {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize stream flag = false, want true")
	}
	response, err := c.StaticIndexFinalize(ctx, request)
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return staticIndexTestFinalizeStream(response, handle)
}

func (c *staticIndexCacheReplayCompiler) ParseFile(context.Context, frontend.Request) (json.RawMessage, error) {
	return nil, fmt.Errorf("ParseFile should not be called by Static Index cache replay")
}

func (c *staticIndexCacheReplayCompiler) Concurrency() int { return 1 }

func (c *staticIndexCacheReplayCompiler) Close() error { return nil }

func writeStaticIndexReplayCacheFile(t testing.TB, root, cacheKey string, value any) {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal replay cache file: %v", err)
	}
	file := cache.FileForIdentity(root, cacheKey)
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatalf("mkdir cache: %v", err)
	}
	if err := os.WriteFile(file, data, 0o600); err != nil {
		t.Fatalf("write cache file: %v", err)
	}
}

func staticIndexCacheReplayEvents(root, projectName string) ([]json.RawMessage, error) {
	tx := "tx-static-index-cache-replay"
	values := []any{
		map[string]any{
			"protocolVersion": 3,
			"type":            "phase:start",
			"transactionId":   tx,
			"phase":           "ast",
			"root":            root,
			"startedAt":       "1970-01-01T00:00:00.000Z",
		},
		map[string]any{
			"protocolVersion": 3,
			"type":            "fact:batch",
			"transactionId":   tx,
			"sequence":        0,
			"facts": []any{
				map[string]any{
					"schemaVersion": 1,
					"factId":        "definitions:prompt:cached-writer",
					"kind":          "definitions",
					"phase":         "ast",
					"projectRoot":   root,
					"producer":      map[string]any{"name": workerProducer, "version": "test"},
					"fidelity":      "authoritative",
					"provenance":    map[string]any{"kind": "runtime", "attribute": "test.staticIndexCacheReplay"},
					"fact": map[string]any{
						"id":       "prompt:cached-writer",
						"kind":     "prompt",
						"name":     "cached-writer",
						"fidelity": "resolved",
						"status":   "active",
					},
				},
			},
		},
		map[string]any{
			"protocolVersion": 3,
			"type":            "phase:done",
			"transactionId":   tx,
			"phase":           "ast",
			"patch": map[string]any{
				"schemaVersion": 1,
				"phase":         "ast",
				"project":       map[string]any{"root": root, "name": projectName},
				"startedAt":     "1970-01-01T00:00:00.000Z",
				"finishedAt":    "1970-01-01T00:00:00.000Z",
				"status":        "ok",
				"invalidates":   map[string]any{"all": true},
			},
			"summary": map[string]any{
				"factCount": 1,
				"decision":  map[string]any{"staticIndexComplete": true},
			},
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

var _ frontend.Parser = (*staticIndexCacheReplayCompiler)(nil)
var _ StaticCompiler = (*staticIndexCacheReplayCompiler)(nil)
