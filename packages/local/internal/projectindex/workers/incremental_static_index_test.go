package workers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestWorkerIndexProjectIncrementalUsesStaticIndexCompiler(t *testing.T) {
	root := t.TempDir()
	sourceFile := filepath.Join(root, "src", "writer.ts")
	if err := os.MkdirAll(filepath.Dir(sourceFile), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	if err := os.WriteFile(sourceFile, []byte("export const writer = prompt({ id: 'writer' })\n"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}

	script := writeShellScript(t, "incremental-node-should-not-run.sh", `#!/bin/sh
while IFS= read -r line; do
  printf '{"protocolVersion":2,"type":"phase:error","transactionId":"node","phase":"ast","error":{"message":"node incremental worker should not run"}}\n'
done
`)
	compiler := &incrementalStaticCompiler{root: root, sourceFile: sourceFile}
	worker := newTestWorkerWithProjectScript(t, script)
	worker.WithSyntaxParser(compiler)
	defer worker.Close()

	result, err := worker.IndexProjectIncremental(
		context.Background(),
		root,
		"",
		"project",
		incrementalPreviousIndex(root, sourceFile),
		[]string{sourceFile},
		nil,
		"ast",
	)
	if err != nil {
		t.Fatalf("IndexProjectIncremental error = %v", err)
	}
	if compiler.compileCalls != 1 {
		t.Fatalf("compile calls = %d, want 1", compiler.compileCalls)
	}
	if result.Report.PlanKind != "source-file-reindex" {
		t.Fatalf("plan kind = %q, want source-file-reindex", result.Report.PlanKind)
	}
	if len(result.Patches) != 1 || result.Patches[0].Invalidates == nil {
		t.Fatalf("patches = %+v, want one file-invalidating AST patch", result.Patches)
	}
	if got := result.Patches[0].Invalidates.Files; len(got) != 1 || got[0] != sourceFile {
		t.Fatalf("invalidated files = %v, want %s", got, sourceFile)
	}
	if len(result.Report.StaticParsedFiles) != 1 || result.Report.StaticParsedFiles[0] != sourceFile {
		t.Fatalf("static parsed files = %v, want %s", result.Report.StaticParsedFiles, sourceFile)
	}
}

type incrementalStaticCompiler struct {
	root         string
	sourceFile   string
	compileCalls int
}

func (c *incrementalStaticCompiler) ParseFile(context.Context, frontend.Request) (json.RawMessage, error) {
	return nil, fmt.Errorf("syntax record parsing should not run for Static Index incremental compile")
}

func (c *incrementalStaticCompiler) Concurrency() int {
	return 1
}

func (c *incrementalStaticCompiler) Close() error {
	return nil
}

func (c *incrementalStaticCompiler) StaticIndexPrepare(_ context.Context, request protocol.PrepareRequest) (protocol.PrepareResponse, error) {
	return protocol.PrepareResponse{
		ProtocolVersion: protocol.Version,
		Method:          protocol.PrepareMethod,
		Plan: protocol.Plan{
			Root:         request.Root,
			ProjectName:  request.ProjectName,
			Files:        append([]protocol.SourceFile(nil), request.Files...),
			PrimaryFiles: append([]protocol.SourceFile(nil), request.PrimaryFiles...),
			CacheMisses:  append([]protocol.SourceFile(nil), request.Files...),
		},
	}, nil
}

func (c *incrementalStaticCompiler) StaticIndexAnalyzeStream(context.Context, protocol.AnalyzeRequest, protocol.AnalyzeStreamHandler) (protocol.AnalyzeResponse, error) {
	return protocol.AnalyzeResponse{}, fmt.Errorf("analyze should not run for native-only incremental compile")
}

func (c *incrementalStaticCompiler) StaticIndexFinalizeStream(context.Context, protocol.FinalizeRequest, protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error) {
	return protocol.FinalizeResponse{}, fmt.Errorf("finalize should not run for native-only incremental compile")
}

func (c *incrementalStaticCompiler) StaticIndexFinalize(context.Context, protocol.FinalizeRequest) (protocol.FinalizeResponse, error) {
	return protocol.FinalizeResponse{}, fmt.Errorf("finalize should not run for native-only incremental compile")
}

func (c *incrementalStaticCompiler) StaticIndexCompileStream(_ context.Context, request protocol.CompileRequest, handle protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error) {
	c.compileCalls++
	if !bytes.Contains(request.PatchInvalidates, []byte(c.sourceFile)) {
		return protocol.FinalizeResponse{}, fmt.Errorf("patch invalidates = %s, want %s", request.PatchInvalidates, c.sourceFile)
	}
	events := incrementalStaticPatchEvents(c.root, c.sourceFile, request.PatchInvalidates)
	for _, event := range events {
		if err := handle(protocol.FinalizeStreamEvent{OK: true, Type: "event", Event: event}); err != nil {
			return protocol.FinalizeResponse{}, err
		}
	}
	return protocol.FinalizeResponse{ProtocolVersion: protocol.Version, Method: protocol.CompileMethod, Events: events}, nil
}

func incrementalPreviousIndex(root string, sourceFile string) store.IndexData {
	return store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: "project"},
		Definitions: []store.ProjectDefinition{{
			ID:       "prompt:writer",
			Kind:     "prompt",
			Name:     "writer",
			Fidelity: "resolved",
			Status:   "active",
			Source:   &store.SourceLoc{File: sourceFile, Line: 1, Column: intPtr(1)},
		}},
		Sources: []store.IndexSourceFile{{
			File:          sourceFile,
			Status:        "indexed",
			ShardID:       ".",
			DefinitionIDs: []string{"prompt:writer"},
		}},
		SourceGraph: &store.ProjectIndexSourceGraph{
			SchemaVersion: 1,
			ProducedBy:    "@use-crux/indexer",
			Capabilities:  []string{"source-dependencies", "source-dependents", "definition-ownership", "diagnostic-ownership", "project-shards"},
			Shards:        []store.ProjectIndexShard{{ID: ".", Root: root}},
		},
	}
}

func intPtr(value int) *int {
	return &value
}

func incrementalStaticPatchEvents(root string, sourceFile string, invalidates json.RawMessage) []json.RawMessage {
	patch := map[string]any{
		"schemaVersion": 1,
		"phase":         "ast",
		"project":       map[string]any{"root": root, "name": "project"},
		"startedAt":     "1970-01-01T00:00:00.000Z",
		"finishedAt":    "1970-01-01T00:00:00.000Z",
		"status":        "ok",
		"invalidates":   json.RawMessage(invalidates),
		"facts": map[string]any{
			"definitions": []map[string]any{{
				"id":       "prompt:writer",
				"kind":     "prompt",
				"name":     "writer",
				"fidelity": "resolved",
				"status":   "active",
				"source":   map[string]any{"file": sourceFile, "line": 1, "column": 1},
			}},
			"sources": []map[string]any{{
				"file":          sourceFile,
				"status":        "indexed",
				"shardId":       ".",
				"definitionIds": []string{"prompt:writer"},
			}},
		},
	}
	patchJSON, _ := json.Marshal(patch)
	return []json.RawMessage{
		json.RawMessage(fmt.Sprintf(`{"protocolVersion":2,"type":"phase:start","transactionId":"incremental-static","phase":"ast","root":%q,"startedAt":"1970-01-01T00:00:00.000Z"}`, root)),
		json.RawMessage(fmt.Sprintf(`{"protocolVersion":2,"type":"phase:done","transactionId":"incremental-static","phase":"ast","patch":%s,"summary":{"factCount":0,"decision":{"staticIndexComplete":true}}}`, patchJSON)),
	}
}
