package host

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/cache"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/planner"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/syntax"
)

func TestWorkerNativeStaticWritesWarmStaticCacheManifest(t *testing.T) {
	t.Setenv(cache.StatusEnv, "1")

	root := t.TempDir()
	sourceFile := writeNativeStaticPlanCacheFixtureFile(
		t,
		root,
		"src/writer.ts",
		"export const writer = prompt({ id: 'cache-write' })\n",
	)
	writeNativeStaticEnabledConfig(t, root)

	compiler := &nativeStaticCacheWriteCompiler{root: root, sourceFile: sourceFile}
	worker := newTestWorker(t)
	worker.WithSyntaxParser(compiler)
	defer worker.Close()

	patch, err := worker.IndexProjectAstPatch(context.Background(), root, "", "native-static-cache-write")
	if err != nil {
		t.Fatalf("IndexProjectAstPatch error = %v", err)
	}
	if len(patch.Facts.Definitions) != 1 || patch.Facts.Definitions[0].ID != "prompt:cache-write" {
		t.Fatalf("definitions = %+v, want cache-write definition", patch.Facts.Definitions)
	}
	if !slices.Contains(compiler.analyzeFiles, sourceFile) {
		t.Fatalf("analyze files = %v, want cold source analyzed", compiler.analyzeFiles)
	}

	status := cache.ManifestStatus(root, []string{sourceFile}, planner.DefaultCacheCompilerInputs())
	if !slices.Equal(status.CacheHits, []string{sourceFile}) {
		t.Fatalf("cache hits = %v misses = %v, want written source hit", status.CacheHits, status.CacheMisses)
	}
	data, err := os.ReadFile(cache.FileForIdentity(root, status.CacheEntries[0].CacheKey))
	if err != nil {
		t.Fatalf("read written cache file: %v", err)
	}
	if !json.Valid(data) {
		t.Fatalf("written cache file is not valid JSON: %s", data)
	}
	if !bytes.Contains(data, []byte("prompt:cache-write")) {
		t.Fatalf("written cache file = %s, want cache-write definition", data)
	}
	var extraction cache.Extraction
	if err := json.Unmarshal(data, &extraction); err != nil {
		t.Fatalf("decode written cache file: %v", err)
	}
	if extraction.SemanticProfile == nil {
		t.Fatalf("written cache semantic profile was nil")
	}
	if extraction.SemanticProfile.File != sourceFile ||
		extraction.SemanticProfile.SourceHash != status.CacheEntries[0].SourceHash {
		t.Fatalf("written cache semantic profile = %+v, want source file and manifest hash", extraction.SemanticProfile)
	}
}

type nativeStaticCacheWriteCompiler struct {
	root         string
	sourceFile   string
	analyzeFiles []string
}

func (c *nativeStaticCacheWriteCompiler) NativeStaticPrepare(_ context.Context, request protocol.PrepareRequest) (protocol.PrepareResponse, error) {
	return protocol.PrepareResponse{
		ProtocolVersion: protocol.Version,
		Method:          protocol.PrepareMethod,
		Plan: protocol.Plan{
			Root:                     request.Root,
			ProjectName:              request.ProjectName,
			Files:                    append([]protocol.SourceFile(nil), request.Files...),
			PrimaryFiles:             append([]protocol.SourceFile(nil), request.PrimaryFiles...),
			CacheHits:                []protocol.SourceFile{},
			CacheMisses:              append([]protocol.SourceFile(nil), request.Files...),
			CallNames:                append([]string(nil), request.CallNames...),
			CallInterests:            append([]syntax.CallInterest(nil), request.CallInterests...),
			ConstructorNames:         append([]string(nil), request.ConstructorNames...),
			ConstructorInterests:     append([]syntax.ConstructorInterest(nil), request.ConstructorInterests...),
			PruneNativeFactCallNames: append([]string(nil), request.PruneNativeFactCallNames...),
		},
		Diagnostics: []json.RawMessage{},
		Telemetry:   nativeStaticTestTelemetry(len(request.Files), 0, len(request.Files), 0),
	}, nil
}

func (c *nativeStaticCacheWriteCompiler) NativeStaticAnalyzeStream(_ context.Context, request protocol.AnalyzeRequest, handle protocol.AnalyzeStreamHandler) (protocol.AnalyzeResponse, error) {
	c.analyzeFiles = c.analyzeFiles[:0]
	if !request.Stream {
		return protocol.AnalyzeResponse{}, fmt.Errorf("analyze stream flag = false, want true")
	}
	for _, file := range request.Files {
		c.analyzeFiles = append(c.analyzeFiles, file.File)
	}
	if !slices.Contains(c.analyzeFiles, c.sourceFile) {
		return protocol.AnalyzeResponse{}, fmt.Errorf("source %s was not analyzed", c.sourceFile)
	}
	return nativeStaticTestAnalyzeStream(protocol.AnalyzeResponse{
		ProtocolVersion:       protocol.Version,
		Method:                protocol.AnalyzeMethod,
		Facts:                 []json.RawMessage{json.RawMessage(`{"kind":"definition","fact":{"id":"prompt:cache-write"}}`)},
		Diagnostics:           []json.RawMessage{},
		ExtensionEvidenceJobs: []json.RawMessage{},
		Telemetry:             nativeStaticTestTelemetry(len(request.Plan.Files), 0, len(request.Files), len(request.Files)),
	}, handle)
}

func (c *nativeStaticCacheWriteCompiler) NativeStaticFinalize(_ context.Context, request protocol.FinalizeRequest) (protocol.FinalizeResponse, error) {
	events, err := nativeStaticCacheWriteEvents(c.root, c.sourceFile)
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return protocol.FinalizeResponse{
		ProtocolVersion: protocol.Version,
		Method:          protocol.FinalizeMethod,
		Events:          events,
		Telemetry:       nativeStaticTestTelemetry(len(request.NativeFacts), 0, 0, 0),
	}, nil
}

func (c *nativeStaticCacheWriteCompiler) NativeStaticFinalizeStream(ctx context.Context, request protocol.FinalizeRequest, handle protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error) {
	if !request.Stream {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize stream flag = false, want true")
	}
	response, err := c.NativeStaticFinalize(ctx, request)
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return nativeStaticTestFinalizeStream(response, handle)
}

func (c *nativeStaticCacheWriteCompiler) ParseFile(context.Context, syntax.Request) (json.RawMessage, error) {
	return nil, fmt.Errorf("ParseFile should not be called by native static cache write")
}

func (c *nativeStaticCacheWriteCompiler) Concurrency() int { return 1 }

func (c *nativeStaticCacheWriteCompiler) Close() error { return nil }

func nativeStaticCacheWriteEvents(root, sourceFile string) ([]json.RawMessage, error) {
	tx := "tx-native-static-cache-write"
	values := []any{
		map[string]any{
			"protocolVersion": 2,
			"type":            "phase:start",
			"transactionId":   tx,
			"phase":           "ast",
			"root":            root,
			"startedAt":       "1970-01-01T00:00:00.000Z",
		},
		map[string]any{
			"protocolVersion": 2,
			"type":            "fact:batch",
			"transactionId":   tx,
			"sequence":        0,
			"facts": []any{
				map[string]any{
					"schemaVersion": 1,
					"factId":        "definitions:prompt:cache-write",
					"kind":          "definitions",
					"phase":         "ast",
					"projectRoot":   root,
					"producer":      map[string]any{"name": workerProducer, "version": "test"},
					"fidelity":      "authoritative",
					"provenance":    map[string]any{"kind": "runtime", "attribute": "test.nativeStaticCacheWrite"},
					"fact": map[string]any{
						"id":       "prompt:cache-write",
						"kind":     "prompt",
						"name":     "cache-write",
						"fidelity": "resolved",
						"status":   "active",
						"source":   map[string]any{"file": sourceFile, "line": 1},
					},
				},
				map[string]any{
					"schemaVersion": 1,
					"factId":        "sources:" + sourceFile,
					"kind":          "sources",
					"phase":         "ast",
					"projectRoot":   root,
					"producer":      map[string]any{"name": workerProducer, "version": "test"},
					"fidelity":      "authoritative",
					"provenance":    map[string]any{"kind": "runtime", "attribute": "test.nativeStaticCacheWrite"},
					"fact": map[string]any{
						"file":          sourceFile,
						"status":        "indexed",
						"definitionIds": []string{"prompt:cache-write"},
						"dependencies":  []string{},
					},
				},
			},
		},
		map[string]any{
			"protocolVersion": 2,
			"type":            "phase:done",
			"transactionId":   tx,
			"phase":           "ast",
			"patch": map[string]any{
				"schemaVersion": 1,
				"phase":         "ast",
				"project":       map[string]any{"root": root, "name": "native-static-cache-write"},
				"startedAt":     "1970-01-01T00:00:00.000Z",
				"finishedAt":    "1970-01-01T00:00:00.000Z",
				"status":        "ok",
				"invalidates":   map[string]any{"all": true},
			},
			"summary": map[string]any{
				"factCount": 2,
				"decision":  map[string]any{"nativeStaticComplete": true},
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

var _ syntax.Parser = (*nativeStaticCacheWriteCompiler)(nil)
var _ StaticCompiler = (*nativeStaticCacheWriteCompiler)(nil)
