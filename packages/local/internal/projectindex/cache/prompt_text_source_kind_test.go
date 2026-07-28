package cache

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestPromptTextSourceKindAndLegacyMarkerSurviveSnapshotRestart(
	t *testing.T,
) {
	t.Parallel()

	root := t.TempDir()
	ast := IndexPatch{
		SchemaVersion: 1,
		Phase:         PhaseAST,
		Project:       store.ProjectIdentity{Root: root, Name: "project"},
		FinishedAt:    "2026-07-28T20:00:00Z",
		Status:        "ok",
		Invalidates:   &IndexPatchInvalidation{All: true},
		Facts: IndexPatchFacts{
			Definitions: []store.ProjectDefinition{{
				ID: "prompt:writer", Kind: "prompt", Name: "writer",
				Fidelity: "resolved",
			}},
		},
	}
	facts := NewSQLiteIndexFactStore()
	if err := facts.CommitPhase(
		context.Background(),
		FactTransactionFromPatch(ast),
	); err != nil {
		t.Fatalf("commit AST definition: %v", err)
	}
	semantic := IndexPatch{
		SchemaVersion: 1,
		Phase:         PhaseSemantic,
		Project:       ast.Project,
		FinishedAt:    "2026-07-28T20:00:01Z",
		Status:        "ok",
		Facts: IndexPatchFacts{
			SourceRefs: []IndexSourceRefFact{
				promptTextSourceKindFact(
					"system-owner",
					"system",
					"",
					`{"fragment":true,"promptText":{"tag":"md","language":"markdown","lifecycle":"static","sourceKind":"owner"}}`,
				),
				promptTextSourceKindFact(
					"prompt-fragment",
					"prompt",
					"shared",
					`{"promptText":{"tag":"md","language":"markdown","lifecycle":"static","sourceKind":"named-fragment"}}`,
				),
			},
		},
	}
	if err := facts.CommitPhase(
		context.Background(),
		FactTransactionFromPatch(semantic),
	); err != nil {
		t.Fatalf("commit semantic source refs: %v", err)
	}

	reloaded, ok, err := NewSQLiteIndexFactStore().ProjectSnapshot(
		context.Background(),
		root,
		"project",
	)
	if err != nil || !ok {
		t.Fatalf("restart snapshot = (%#v, %v, %v)", reloaded, ok, err)
	}
	definition := findTestDefinition(reloaded.Definitions, "prompt:writer")
	if definition == nil || len(definition.SourceRefs) != 2 {
		t.Fatalf("reloaded definition = %#v", definition)
	}
	var system, prompt json.RawMessage
	for _, ref := range definition.SourceRefs {
		switch ref.ID {
		case "system-owner":
			system = ref.Metadata
		case "prompt-fragment":
			prompt = ref.Metadata
		}
	}
	if !bytes.Contains(system, []byte(`"fragment":true`)) ||
		!bytes.Contains(system, []byte(`"sourceKind":"owner"`)) ||
		bytes.Contains(prompt, []byte(`"fragment"`)) ||
		!bytes.Contains(prompt, []byte(`"sourceKind":"named-fragment"`)) {
		t.Fatalf("reloaded PromptText metadata = %s / %s", system, prompt)
	}
}

func promptTextSourceKindFact(
	id, role, symbol, metadata string,
) IndexSourceRefFact {
	return IndexSourceRefFact{
		DefinitionID: "prompt:writer",
		Ref: store.ProjectSourceRef{
			ID: id, Role: role, Property: role, Symbol: symbol,
			Source:   store.SourceLoc{File: "src/writer.ts", Line: 1},
			Fidelity: "resolved", Metadata: json.RawMessage(metadata),
		},
	}
}
