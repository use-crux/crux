package server

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestWorkspaceCompletionUsesMostSpecificScope(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	nested := filepath.Join(root, "nested")
	uri := protocol.DocumentURI(
		"file://" + filepath.ToSlash(filepath.Join(nested, "src", "agent.ts")),
	)
	generation := uint64(7)
	store := readmodel.NewStore()
	store.ApplySnapshot("outer", readmodel.Snapshot{Generation: &generation})
	store.ApplySnapshot("nested", readmodel.Snapshot{Generation: &generation})

	outer := &controlledCompletionSource{result: readmodel.CompletionResult{
		DocumentVersion: 1,
		Generation:      generation,
		Items: []readmodel.CompletionItem{{
			ID: "prompt:outer",
		}},
	}}
	child := &controlledCompletionSource{result: readmodel.CompletionResult{
		DocumentVersion: 1,
		Generation:      generation,
		Items: []readmodel.CompletionItem{{
			ID: "prompt:nested",
		}},
	}}
	workspace := &workspaceRuntime{
		store: store,
		sessions: []*scopeSession{
			{
				scope: readmodel.Scope{ID: "outer", Root: root},
				mode:  readmodel.ModeOwn, transient: outer,
			},
			{
				scope: readmodel.Scope{ID: "nested", Root: nested},
				mode:  readmodel.ModeOwn, transient: child,
			},
		},
	}

	outcome := workspace.Completion(
		context.Background(),
		uri,
		readmodel.CompletionRequest{DocumentVersion: 1},
	)
	if outcome.Kind != completionOutcomeCurrent ||
		len(outcome.Result.Items) != 1 ||
		outcome.Result.Items[0].ID != "prompt:nested" {
		t.Fatalf("nested completion = %#v, want child scope only", outcome)
	}
}
