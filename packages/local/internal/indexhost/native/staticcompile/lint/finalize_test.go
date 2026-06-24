package lint

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/indexhost/native/protocol"
	"github.com/use-crux/crux/packages/local/internal/indexhost/native/staticcompile/patch"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestFinalizePatchBuildsQualityFinalizeRequest(t *testing.T) {
	compiler := &recordingCompiler{root: "/repo"}

	patch, usedNativeStatic, err := FinalizePatch(context.Background(), compiler, FinalizeOptions{
		Root:        "/repo",
		ProjectName: "project",
		Index: store.IndexData{
			Definitions: []store.ProjectDefinition{{ID: "prompt:writer", Kind: "prompt", Name: "writer", Fidelity: "resolved"}},
		},
		PatchOptions: testPatchOptions(),
	})

	if err != nil {
		t.Fatalf("FinalizePatch error = %v", err)
	}
	if !usedNativeStatic {
		t.Fatal("usedNativeStatic = false, want complete native lint patch")
	}
	if compiler.calls != 1 {
		t.Fatalf("finalize calls = %d, want 1", compiler.calls)
	}
	if patch.Phase != projectindex.PhaseQuality {
		t.Fatalf("patch phase = %q, want quality", patch.Phase)
	}
	if compiler.request.PatchPhase != string(projectindex.PhaseQuality) {
		t.Fatalf("request patch phase = %q, want quality", compiler.request.PatchPhase)
	}
	if compiler.request.EmitBuiltinLints == nil || !*compiler.request.EmitBuiltinLints {
		t.Fatalf("emitBuiltinLints = %v, want true", compiler.request.EmitBuiltinLints)
	}
	if compiler.request.ExtensionFacts == nil {
		t.Fatal("extension facts = nil, want empty JSON slice")
	}
	if len(compiler.request.NativeFacts) != 0 {
		t.Fatalf("native facts = %s, want lint-only finalize", compiler.request.NativeFacts)
	}
	lintFacts := []byte{}
	for _, fact := range compiler.request.LintFacts {
		lintFacts = append(lintFacts, fact...)
	}
	if !bytes.Contains(lintFacts, []byte(`"definitions"`)) {
		t.Fatalf("lint facts = %s, want definitions", compiler.request.LintFacts)
	}
}

func TestFinalizePatchSkipsEmptyLintFacts(t *testing.T) {
	compiler := &recordingCompiler{root: "/repo"}

	patch, usedNativeStatic, err := FinalizePatch(context.Background(), compiler, FinalizeOptions{
		Root:         "/repo",
		ProjectName:  "project",
		Index:        store.IndexData{},
		PatchOptions: testPatchOptions(),
	})

	if err != nil {
		t.Fatalf("FinalizePatch error = %v", err)
	}
	if usedNativeStatic || patch.Phase != "" {
		t.Fatalf("patch = %+v usedNativeStatic = %v, want skipped lint finalize", patch, usedNativeStatic)
	}
	if compiler.calls != 0 {
		t.Fatalf("finalize calls = %d, want none", compiler.calls)
	}
}

func TestGraphPatchCopiesDefinitionsAndRelations(t *testing.T) {
	index := store.IndexData{
		Definitions: []store.ProjectDefinition{{ID: "prompt:writer", Kind: "prompt"}},
		Relations:   []store.ProjectRelation{{ID: "relation:one", Type: "uses"}},
	}

	patch := GraphPatch(index)
	index.Definitions[0].ID = "mutated"
	index.Relations[0].ID = "mutated"

	if patch.Facts.Definitions[0].ID != "prompt:writer" || patch.Facts.Relations[0].ID != "relation:one" {
		t.Fatalf("graph patch = %+v, want copied definitions and relations", patch.Facts)
	}
}

type recordingCompiler struct {
	root    string
	calls   int
	request protocol.FinalizeRequest
}

func (c *recordingCompiler) NativeStaticFinalize(_ context.Context, request protocol.FinalizeRequest) (protocol.FinalizeResponse, error) {
	c.calls++
	c.request = request
	events, err := completeLintEvents(c.root)
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return protocol.FinalizeResponse{
		ProtocolVersion: protocol.Version,
		Method:          protocol.FinalizeMethod,
		Events:          events,
	}, nil
}

func completeLintEvents(root string) ([]json.RawMessage, error) {
	tx := "tx-static-lint"
	values := []any{
		map[string]any{
			"protocolVersion": 2,
			"type":            "phase:start",
			"transactionId":   tx,
			"phase":           "quality",
			"root":            root,
			"startedAt":       "1970-01-01T00:00:00.000Z",
		},
		map[string]any{
			"protocolVersion": 2,
			"type":            "phase:done",
			"transactionId":   tx,
			"phase":           "quality",
			"patch": map[string]any{
				"schemaVersion": 1,
				"phase":         "quality",
				"project":       map[string]any{"root": root, "name": "project"},
				"startedAt":     "1970-01-01T00:00:00.000Z",
				"finishedAt":    "1970-01-01T00:00:00.000Z",
				"status":        "ok",
			},
			"summary": map[string]any{
				"factCount": 0,
				"decision":  map[string]any{"nativeStaticComplete": true},
			},
		},
	}
	events := make([]json.RawMessage, 0, len(values))
	for _, value := range values {
		data, err := json.Marshal(value)
		if err != nil {
			return nil, fmt.Errorf("marshal lint event: %w", err)
		}
		events = append(events, data)
	}
	return events, nil
}

func testPatchOptions() patch.Options {
	return patch.Options{
		Root:             "/repo",
		MaxBytes:         16 * 1024 * 1024,
		MaxFactsPerBatch: 200,
		Producer:         "test",
	}
}
