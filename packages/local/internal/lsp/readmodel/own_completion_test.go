package readmodel

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	staticcompiler "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/compiler"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestOwnCompletionPinsSnapshotGenerationAndDefinitionCatalogue(t *testing.T) {
	compiler := &recordingCompletionCompiler{response: staticprotocol.CompletionResponse{
		Items: []staticprotocol.CompletionItem{{
			ID: "prompt:writer", Kind: "prompt", Label: "writer", InsertText: "writer",
		}},
	}}
	generation := uint64(7)
	snapshot := Snapshot{
		ProjectRoot: "/repo",
		Generation:  &generation,
		Definitions: []api.ProjectDefinition{
			{
				ID: "prompt:writer", Kind: "prompt", Name: "writer", Description: "Writes replies.",
				Source:   &api.SourceLoc{File: "src/agent.ts", Line: 3, Column: intPointer(14)},
				Metadata: json.RawMessage(`{"exportName":"writer"}`),
			},
			{
				ID: "prompt:default", Kind: "prompt", Name: "default prompt",
				Source:   &api.SourceLoc{File: "src/default.ts", Line: 1},
				Metadata: json.RawMessage(`{"exportName":"default"}`),
			},
		},
	}

	result, err := completeOwn(context.Background(), compiler, snapshot, CompletionRequest{
		File: "/repo/src/agent.ts", LanguageID: "typescript",
		Text:     "const support = agent({ prompt: wr",
		Position: CompletionPosition{Line: 0, Character: 34}, Limit: 100,
	})
	if err != nil {
		t.Fatalf("completeOwn() error = %v", err)
	}
	if result.Generation != 7 || len(result.Items) != 1 {
		t.Fatalf("result = %+v, want generation 7 and one item", result)
	}
	if len(compiler.query.Candidates) != 1 {
		t.Fatalf("candidates = %+v, want one compact definition", compiler.query.Candidates)
	}
	candidate := compiler.query.Candidates[0]
	if candidate.Binding != "writer" || candidate.File != "/repo/src/agent.ts" || candidate.Kind != "prompt" ||
		candidate.Line != 3 || candidate.Character != 14 {
		t.Fatalf("candidate = %+v, want compiler-neutral writer fields", candidate)
	}
}

func intPointer(value int) *int { return &value }

func TestOwnCompletionAgainstRealPersistentWorker(t *testing.T) {
	workerPath := os.Getenv("CRUX_STATIC_INDEX_WORKER")
	if workerPath == "" {
		t.Skip("set CRUX_STATIC_INDEX_WORKER to a built native worker")
	}
	workerPath, err := filepath.Abs(workerPath)
	if err != nil {
		t.Fatal(err)
	}
	compiler := staticcompiler.NewPool(1, workerPath, "serve")
	defer compiler.Close()
	root := t.TempDir()
	cacheFile := filepath.Join(root, ".crux", "cache", "index", "index.json")
	if err := os.MkdirAll(filepath.Dir(cacheFile), 0o755); err != nil {
		t.Fatal(err)
	}
	wantCache := []byte(`{"sentinel":"unchanged"}`)
	if err := os.WriteFile(cacheFile, wantCache, 0o600); err != nil {
		t.Fatal(err)
	}
	generation := uint64(11)
	file := filepath.Join(root, "src", "agent.ts")
	snapshot := Snapshot{ProjectRoot: root, Generation: &generation, Definitions: []api.ProjectDefinition{
		{
			ID: "prompt:writer", Kind: "prompt", Name: "writer", Source: &api.SourceLoc{File: file, Line: 1},
			Metadata: json.RawMessage(`{"exportName":"writer"}`),
		},
		{
			ID: "tool:lookup", Kind: "tool", Name: "lookup", Source: &api.SourceLoc{File: file, Line: 2},
			Metadata: json.RawMessage(`{"exportName":"lookup"}`),
		},
	}}
	request := CompletionRequest{
		File: file, LanguageID: "typescript",
		Text: strings.Join([]string{
			"const writer = prompt({ id: 'writer' })",
			"const lookup = tool({ id: 'lookup' })",
			"const support = agent({ prompt: wr",
		}, "\n"),
		Position: CompletionPosition{Line: 2, Character: 34}, Limit: 100,
	}
	store := NewStore()
	store.ApplySnapshot("scope", snapshot)
	before := store.PublicationSnapshot("scope")

	result, err := completeOwn(context.Background(), compiler, snapshot, request)
	if err != nil {
		t.Fatalf("real completeOwn() error = %v", err)
	}
	if result.Generation != 11 || len(result.Items) != 1 || result.Items[0].ID != "prompt:writer" {
		t.Fatalf("real result = %+v, want only pinned writer prompt", result)
	}
	if generation != 11 {
		t.Fatalf("completion mutated snapshot generation to %d", generation)
	}
	after := store.PublicationSnapshot("scope")
	if !reflect.DeepEqual(before, after) {
		t.Fatalf("completion mutated store publication: before=%+v after=%+v", before, after)
	}
	gotCache, err := os.ReadFile(cacheFile)
	if err != nil {
		t.Fatal(err)
	}
	if string(gotCache) != string(wantCache) {
		t.Fatalf("completion mutated cache bytes: got %q want %q", gotCache, wantCache)
	}
}

type recordingCompletionCompiler struct {
	query    staticprotocol.CompletionQuery
	response staticprotocol.CompletionResponse
}

func (c *recordingCompletionCompiler) Completion(_ context.Context, query staticprotocol.CompletionQuery) (staticprotocol.CompletionResponse, error) {
	c.query = query
	return c.response, nil
}
